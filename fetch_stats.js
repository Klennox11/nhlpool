/**
 * NHL Playoff Pool — Auto Stats Fetcher
 * - Player points + OT goals (existing)
 * - Playoff series scores (new — auto updates series tab)
 * - Eliminated teams (new — auto greys out players)
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
  Bouchard:   8480803,
  Marner:     8478483,
  Crosby:     8471675,
  Stone:      8475913,
  Eichel:     8478403,
  Thompson:   8479420,
  Stutzle:    8482116,
  Batherson:  8480208,
  Guenther:   8482699,
  Savoie:     8483512,
  Slafkovsky: 8483515,
  Ehlers:     8477940,
  Konecny:    8478439,
  Schmaltz:   8477951,
  Dahlin:     8480839,
  Hutson:     8483457,
  Johnston:   8482740,
  Guentzel:   8477404,
};

// Which team each player plays for (used for elimination detection)
const PLAYER_TEAMS = {
  McDavid:'EDM', MacKinnon:'COL', Rantanen:'DAL', Makar:'COL',
  Kaprizov:'MIN', Kucherov:'TBL', Necas:'CAR', Suzuki:'MTL',
  Caufield:'MTL', Robertson:'DAL', Aho:'CAR', Hyman:'EDM',
  Hagel:'TBL', Svechnikov:'CAR', Demidov:'MTL', Bouchard:'EDM',
  Marner:'TOR', Crosby:'PIT', Stone:'VGK', Eichel:'VGK',
  Thompson:'BUF', Stutzle:'OTT', Batherson:'OTT', Guenther:'UTA',
  Savoie:'EDM', Slafkovsky:'MTL', Ehlers:'CAR', Konecny:'PHI',
  Schmaltz:'UTA', Dahlin:'BUF', Hutson:'MTL', Johnston:'DAL',
  Guentzel:'TBL',
};

const SEASON         = '20252026';
const GAME_TYPE      = 3;
const PLAYOFFS_START = '2026-04-18';

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'NHLPoolBot/1.0' } }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('JSON parse failed: ' + url)); }
      });
    }).on('error', reject);
  });
}

// Fetch playoff series from NHL API
async function fetchSeriesData() {
  try {
    const data = await fetchUrl(`https://api-web.nhle.com/v1/playoff-series/carousel/${SEASON}/`);
    const series = [];
    const eliminatedTeams = new Set();

    for (const round of data.rounds || []) {
      const roundNum = round.roundNumber;
      for (const s of round.series || []) {
        const topTeam    = s.topSeedTeam?.abbrev || '?';
        const bottomTeam = s.bottomSeedTeam?.abbrev || '?';
        const topWins    = s.topSeedTeamWins || 0;
        const bottomWins = s.bottomSeedTeamWins || 0;
        const topName    = s.topSeedTeam?.commonName?.default || topTeam;
        const bottomName = s.bottomSeedTeam?.commonName?.default || bottomTeam;

        let status = `Series tied ${topWins}-${bottomWins}`;
        let over = false;
        let winner = null;

        if (topWins === 4) {
          status = `${topName} wins 4-${bottomWins}`;
          over = true;
          winner = topTeam;
          eliminatedTeams.add(bottomTeam);
        } else if (bottomWins === 4) {
          status = `${bottomName} wins 4-${topWins}`;
          over = true;
          winner = bottomTeam;
          eliminatedTeams.add(topTeam);
        } else if (topWins > bottomWins) {
          status = `${topName} leads ${topWins}-${bottomWins}`;
        } else if (bottomWins > topWins) {
          status = `${bottomName} leads ${bottomWins}-${topWins}`;
        }

        series.push({
          round: roundNum,
          away: topName,
          awayAbbrev: topTeam,
          home: bottomName,
          homeAbbrev: bottomTeam,
          awayW: topWins,
          homeW: bottomWins,
          status,
          over,
          winner,
        });
      }
    }

    return { series, eliminatedTeams };
  } catch(e) {
    console.error('Failed to fetch series data:', e.message);
    return { series: [], eliminatedTeams: new Set() };
  }
}

// Get all completed playoff game IDs
async function getPlayoffGameIds() {
  const gameIds = [];
  const start = new Date(PLAYOFFS_START);
  const today = new Date();
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    try {
      const data = await fetchUrl(`https://api-web.nhle.com/v1/schedule/${dateStr}`);
      for (const week of data.gameWeek || []) {
        for (const game of week.games || []) {
          if (game.gameType === GAME_TYPE && game.gameState === 'OFF') {
            gameIds.push({ id: game.id, date: dateStr });
          }
        }
      }
    } catch(e) {}
  }
  return [...new Map(gameIds.map(g => [g.id, g])).values()];
}

// Get OT goal counts from play-by-play
async function getOtGoalCounts(gameId) {
  const counts = {};
  try {
    const data = await fetchUrl(`https://api-web.nhle.com/v1/gamecenter/${gameId}/play-by-play`);
    for (const play of data.plays || []) {
      if (play.typeDescKey !== 'goal') continue;
      if ((play.periodDescriptor || {}).periodType !== 'OT') continue;
      const details = play.details || {};
      for (const key of ['scoringPlayerId', 'assist1PlayerId', 'assist2PlayerId']) {
        const pid = details[key];
        if (pid) counts[pid] = (counts[pid] || 0) + 1;
      }
    }
  } catch(e) {}
  return counts;
}

// Get recent points (since yesterday)
async function fetchRecentPoints() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const cutoffStr = yesterday.toISOString().split('T')[0];
  const recentByName = {};
  for (const [name, pid] of Object.entries(PLAYER_IDS)) {
    try {
      const data = await fetchUrl(
        `https://api-web.nhle.com/v1/player/${pid}/game-log/${SEASON}/${GAME_TYPE}`
      );
      let recentPts = 0;
      for (const game of data.gameLog || []) {
        if ((game.gameDate || '').slice(0, 10) >= cutoffStr) {
          recentPts += (game.goals || 0) + (game.assists || 0);
        }
      }
      recentByName[name] = recentPts;
    } catch(e) { recentByName[name] = 0; }
  }
  return recentByName;
}

// Get total playoff points
async function fetchRegularPoints() {
  const idFilter = Object.values(PLAYER_IDS).map(id => `playerId=${id}`).join(' or ');
  const cayenne  = `(${idFilter}) and seasonId=${SEASON} and gameTypeId=${GAME_TYPE}`;
  const params   = new URLSearchParams({
    isAggregate: 'false', isGame: 'false', start: '0', limit: '50', cayenneExp: cayenne,
  });
  const data = await fetchUrl(`https://api.nhle.com/stats/rest/en/skater/summary?${params}`);
  const byId = {};
  for (const row of data.data || []) byId[row.playerId] = row.points || 0;
  return byId;
}

async function main() {
  console.log('=== NHL Playoff Pool Stats Fetcher ===\n');

  // Step 1: Series data + eliminated teams
  console.log('Fetching playoff series data...');
  const { series, eliminatedTeams } = await fetchSeriesData();
  console.log(`Found ${series.length} series. Eliminated teams: ${[...eliminatedTeams].join(', ') || 'none'}`);

  // Step 2: Total points
  console.log('Fetching total playoff points...');
  const ptsByid = await fetchRegularPoints();

  // Step 3: Recent points
  console.log('Fetching recent points (last 24 hrs)...');
  const recentByName = await fetchRecentPoints();

  // Step 4: OT goal counts
  console.log('Checking play-by-play for OT goals...');
  const games = await getPlayoffGameIds();
  console.log(`Found ${games.length} completed games.`);

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const cutoffStr = yesterday.toISOString().split('T')[0];

  const otGoalCounts   = {};
  const recentOtCounts = {};
  for (const game of games) {
    const counts = await getOtGoalCounts(game.id);
    for (const [pid, count] of Object.entries(counts)) {
      const pidNum = parseInt(pid);
      otGoalCounts[pidNum]   = (otGoalCounts[pidNum] || 0) + count;
      if (game.date >= cutoffStr) {
        recentOtCounts[pidNum] = (recentOtCounts[pidNum] || 0) + count;
      }
    }
  }

  // Step 5: Build player results + elimination flags
  const players = {};
  for (const [name, pid] of Object.entries(PLAYER_IDS)) {
    const team      = PLAYER_TEAMS[name] || '';
    const eliminated = eliminatedTeams.has(team);
    const pts        = ptsByid[pid] || 0;
    const otPts      = otGoalCounts[pid] || 0;
    const recentPts  = recentByName[name] || 0;
    const recentOtPts = recentOtCounts[pid] || 0;
    players[name] = { pts, otPts, recentPts, recentOtPts, eliminated, team };
    console.log(`  ${name.padEnd(15)} ${pts}pts ${otPts}OT ${eliminated ? '❌ ELIM' : '✅'}`);
  }

  const output = {
    season:      SEASON,
    gameType:    GAME_TYPE,
    lastUpdated: new Date().toISOString(),
    players,
    series,
    eliminatedTeams: [...eliminatedTeams],
  };

  fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
  console.log(`\nDone — data.json written with ${Object.keys(players).length} players and ${series.length} series.`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
