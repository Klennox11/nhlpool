/**
 * NHL Playoff Pool — Auto Stats Fetcher
 * - Regular points: from stats summary API (one bulk call)
 * - OT bonus: checks play-by-play of every playoff game since Apr 18
 *   Anyone who got a point (goal or assist) on an OT goal gets +1 bonus
 */

const https = require('https');
const fs    = require('fs');

const PLAYER_IDS = {
  McDavid:    8478402,
  MacKinnon:  8477492,
  Rantanen:   8478420,
  Makar:      8480069,
  Kaprizov:   8478864,
  Kucherov:   8476453,
  Necas:      8480039,
  Suzuki:     8480018,
  Caufield:   8481540,
  Robertson:  8480027,
  Aho:        8478427,
  Hyman:      8475786,
  Hagel:      8479542,
  Svechnikov: 8480830,
  Demidov:    8484984,
  Bouchard:   8480932,
  Marner:     8478483,
  Crosby:     8471675,
  Stone:      8475913,
  Eichel:     8478403,
  Thompson:   8479420,
  Stutzle:    8482116,
  Batherson:  8480208,
  Guenther:   8482699,
  Savoie:     8484149,
  Slafkovsky: 8483515,
  Ehlers:     8477940,
  Konecny:    8478439,
  Schmaltz:   8476882,
  Dahlin:     8480787,
  Hutson:     8483457,
  Johnston:   8482740,
  Guentzel:   8477404,
};

const SEASON    = '20252026';
const GAME_TYPE = 3;
const PLAYOFFS_START = '2026-04-18';

// Reverse lookup: playerId -> name
const ID_TO_NAME = {};
for (const [name, id] of Object.entries(PLAYER_IDS)) {
  ID_TO_NAME[id] = name;
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'NHLPoolBot/1.0' } }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('JSON parse failed for: ' + url)); }
      });
    }).on('error', reject);
  });
}

// Get all playoff game IDs since playoffs started
async function getPlayoffGameIds() {
  const gameIds = [];
  // Check each day from Apr 18 to today
  const start = new Date(PLAYOFFS_START);
  const today = new Date();
  
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    try {
      const data = await fetchUrl(`https://api-web.nhle.com/v1/schedule/${dateStr}`);
      for (const week of data.gameWeek || []) {
        for (const game of week.games || []) {
          if (game.gameType === GAME_TYPE && game.gameState === 'OFF') {
            gameIds.push(game.id);
          }
        }
      }
    } catch(e) {
      // skip days with no games
    }
  }
  return [...new Set(gameIds)]; // dedupe
}

// Check play-by-play for OT goals and return pool player IDs who got points
async function getOtPointScorers(gameId) {
  const scorers = new Set();
  try {
    const data = await fetchUrl(`https://api-web.nhle.com/v1/gamecenter/${gameId}/play-by-play`);
    for (const play of data.plays || []) {
      if (play.typeDescKey !== 'goal') continue;
      const periodType = (play.periodDescriptor || {}).periodType;
      if (periodType !== 'OT') continue;
      
      // Add scorer and assisters
      const details = play.details || {};
      if (details.scoringPlayerId)  scorers.add(details.scoringPlayerId);
      if (details.assist1PlayerId)  scorers.add(details.assist1PlayerId);
      if (details.assist2PlayerId)  scorers.add(details.assist2PlayerId);
    }
  } catch(e) {
    // skip on error
  }
  return scorers;
}

// Get all regular playoff points from stats API (one bulk call)
async function fetchRegularPoints() {
  const idFilter = Object.values(PLAYER_IDS).map(id => `playerId=${id}`).join(' or ');
  const cayenne  = `(${idFilter}) and seasonId=${SEASON} and gameTypeId=${GAME_TYPE}`;
  const params   = new URLSearchParams({
    isAggregate: 'false',
    isGame:      'false',
    start:       '0',
    limit:       '50',
    cayenneExp:  cayenne,
  });
  const data = await fetchUrl(`https://api.nhle.com/stats/rest/en/skater/summary?${params}`);
  const byId = {};
  for (const row of data.data || []) {
    byId[row.playerId] = row.points || 0;
  }
  return byId;
}

async function main() {
  console.log('=== NHL Playoff Pool Stats Fetcher ===\n');

  // Step 1: Regular points
  console.log('Fetching regular playoff points...');
  const ptsByid = await fetchRegularPoints();

  // Step 2: Find all OT goal point-getters across all playoff games
  console.log('Finding playoff game IDs...');
  const gameIds = await getPlayoffGameIds();
  console.log(`Found ${gameIds.length} completed playoff games. Checking for OT goals...`);

  const otPlayerIds = new Set();
  for (const gameId of gameIds) {
    const scorers = await getOtPointScorers(gameId);
    for (const id of scorers) otPlayerIds.add(id);
  }

  // Step 3: Build results
  const players = {};
  for (const [name, pid] of Object.entries(PLAYER_IDS)) {
    const pts   = ptsByid[pid] || 0;
    const otPts = otPlayerIds.has(pid) ? 1 : 0;
    players[name] = { pts, otPts };
    console.log(`  ${name.padEnd(15)} ${pts} pts, ${otPts} OT pts`);
  }

  const output = {
    season:      SEASON,
    gameType:    GAME_TYPE,
    lastUpdated: new Date().toISOString(),
    players,
  };

  fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
  console.log(`\nDone — data.json written with ${Object.keys(players).length} players.`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
