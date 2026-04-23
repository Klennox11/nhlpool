/**
 * NHL Playoff Pool — Auto Stats Fetcher
 * Single API call gets all 33 players at once.
 * Run: node fetch_stats.js
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
  Konecny:    8479550,
  Schmaltz:   8476882,
  Dahlin:     8480787,
  Hutson:     8484967,
  Johnston:   8482749,
  Guentzel:   8476924,
};

const SEASON    = '20252026';
const GAME_TYPE = 3; // playoffs

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'NHLPoolBot/1.0' } }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('JSON parse failed: ' + e.message)); }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('=== NHL Playoff Pool Stats Fetcher ===');
  console.log(`Season: ${SEASON} | Playoffs (gameType=${GAME_TYPE})\n`);

  // Build one big cayenne filter with all player IDs
  const idFilter = Object.values(PLAYER_IDS)
    .map(id => `playerId=${id}`)
    .join(' or ');
  const cayenne = `(${idFilter}) and seasonId=${SEASON} and gameTypeId=${GAME_TYPE}`;

  const params = new URLSearchParams({
    isAggregate: 'false',
    isGame:      'false',
    start:       '0',
    limit:       '50',
    cayenneExp:  cayenne,
  });

  const url = `https://api.nhle.com/stats/rest/en/skater/summary?${params}`;
  console.log('Fetching all players in one API call...\n');

  const data = await fetchUrl(url);
  const rows = data.data || [];

  // Build lookup by player ID
  const byId = {};
  for (const row of rows) {
    byId[row.playerId] = row;
  }

  // Build results
  const players = {};
  for (const [name, pid] of Object.entries(PLAYER_IDS)) {
    const row  = byId[pid] || {};
    const pts  = row.points   || 0;
    const otPts = row.otGoals || 0;
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
