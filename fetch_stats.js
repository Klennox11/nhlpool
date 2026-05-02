/**
 * NHL Playoff Pool — Auto Stats Fetcher
 * - Player points + OT goals
 * - Playoff series scores (auto)
 * - Eliminated teams (auto)
 */

const https = require('https');
const fs    = require('fs');

const PLAYER_IDS = {
  McDavid:    8478402, MacKinnon:  8477492, Rantanen:   8478420,
  Makar:      8480069, Kaprizov:   8478864, Kucherov:   8476453,
  Necas:      8480039, Suzuki:     8480018, Caufield:   8481540,
  Robertson:  8480027, Aho:        8478427, Hyman:      8475786,
  Hagel:      8479542, Svechnikov: 8480830, Demidov:    8484984,
  Bouchard:   8480803, Marner:     8478483, Crosby:     8471675,
  Stone:      8475913, Eichel:     8478403, Thompson:   8479420,
  Stutzle:    8482116, Batherson:  8480208, Guenther:   8482699,
  Savoie:     8483512, Slafkovsky: 8483515, Ehlers:     8477940,
  Konecny:    8478439, Schmaltz:   8477951, Dahlin:     8480839,
  Hutson:     8483457, Johnston:   8482740, Guentzel:   8477404,
};

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
        catch (e) { reject(new Error('JSON parse failed: ' + url + ' body: ' + raw.slice(0,200))); }
      });
    }).on('error', reject);
  });
}

async function fetchSeriesData() {
  try {
    // Try carousel endpoint
    const url = `https://api-web.nhle.com/v1/playoff-series/carousel/${SEASON}/`;
    console.log('Fetching series from:', url);
    const data = await fetchUrl(url);
    console.log('Series API top-level keys:', Object.keys(data).join(', '));

    const series = [];
    const eliminatedTeams = new Set();
    const rounds = data.rounds || [];
    console.log('Rounds found:', rounds.length);

    for (const round of rounds) {
      const roundNum = round.roundNumber || round.round || 1;
      const roundSeries = round.series || [];
      console.log(`Round ${roundNum}: ${roundSeries.length} series`);

      for (const s of roundSeries) {
        console.log('Series keys:', Object.keys(s).join(', '));
        const topTeamObj = s.topSeedTeam || {};
        const botTeamObj = s.bottomSeedTeam || {};
        const topAbbrev  = topTeamObj.abbrev || topTeamObj.triCode || '?';
        const botAbbrev  = botTeamObj.abbrev || botTeamObj.triCode || '?';
        const topName    = topTeamObj.commonName?.default || topTeamObj.name?.default || topAbbrev;
        const botName    = botTeamObj.commonName?.default || botTeamObj.name?.default || botAbbrev;
        const topWins    = s.topSeedTeamWins ?? 0;
        const botWins    = s.bottomSeedTeamWins ?? 0;

        let status = topWins === 0 && botWins === 0 ? 'Series starting' : `Series tied ${topWins}-${botWins}`;
        let over = false;

        if (topWins === 4) {
          status = `${topName} wins 4-${botWins}`;
          over = true;
          eliminatedTeams.add(botAbbrev);
        } else if (botWins === 4) {
          status = `${botName} wins 4-${topWins}`;
          over = true;
          eliminatedTeams.add(topAbbrev);
        } else if (topWins > botWins) {
          status = `${topName} leads ${topWins}-${botWins}`;
        } else if (botWins > topWins) {
          status = `${botName} leads ${botWins}-${topWins}`;
        }

        series.push({ round: roundNum, away: topName, awayAbbrev: topAbbrev, awayW: topWins, home: botName, homeAbbrev: botAbbrev, homeW: botWins, status, over });
      }
    }

    console.log(`Series parsed: ${series.length}, Eliminated: ${[...eliminatedTeams].join(', ') || 'none'}`);
    return { series, eliminatedTeams };
  } catch(e) {
    console.error('Series fetch failed:', e.message);
    return { series: [], eliminatedTeams: new Set() };
  }
}

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

async function fetchRecentPoints() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const cutoffStr = yesterday.toISOString().split('T')[0];
  const recentByName = {};
  for (const [name, pid] of Object.entries(PLAYER_IDS)) {
    try {
      const data = await fetchUrl(`https://api-web.nhle.com/v1/player/${pid}/game-log/${SEASON}/${GAME_TYPE}`);
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

async function fetchRegularPoints() {
  const idFilter = Object.values(PLAYER_IDS).map(id => `playerId=${id}`).join(' or ');
  const cayenne  = `(${idFilter}) and seasonId=${SEASON} and gameTypeId=${GAME_TYPE}`;
  const params   = new URLSearchParams({ isAggregate:'false', isGame:'false', start:'0', limit:'50', cayenneExp:cayenne });
  const data = await fetchUrl(`https://api.nhle.com/stats/rest/en/skater/summary?${params}`);
  const byId = {};
  for (const row of data.data || []) byId[row.playerId] = row.points || 0;
  return byId;
}

async function main() {
  console.log('=== NHL Playoff Pool Stats Fetcher ===\n');

  console.log('Step 1: Fetching series data...');
  const { series, eliminatedTeams } = await fetchSeriesData();

  console.log('\nStep 2: Fetching total points...');
  const ptsByid = await fetchRegularPoints();

  console.log('\nStep 3: Fetching recent points...');
  const recentByName = await fetchRecentPoints();

  console.log('\nStep 4: Fetching OT goals...');
  const games = await getPlayoffGameIds();
  console.log(`Found ${games.length} completed games.`);

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const cutoffStr = yesterday.toISOString().split('T')[0];
  const otGoalCounts = {}, recentOtCounts = {};

  for (const game of games) {
    const counts = await getOtGoalCounts(game.id);
    for (const [pid, count] of Object.entries(counts)) {
      const pidNum = parseInt(pid);
      otGoalCounts[pidNum]   = (otGoalCounts[pidNum] || 0) + count;
      if (game.date >= cutoffStr) recentOtCounts[pidNum] = (recentOtCounts[pidNum] || 0) + count;
    }
  }

  const players = {};
  for (const [name, pid] of Object.entries(PLAYER_IDS)) {
    const team        = PLAYER_TEAMS[name] || '';
    const eliminated  = eliminatedTeams.has(team);
    const pts         = ptsByid[pid] || 0;
    const otPts       = otGoalCounts[pid] || 0;
    const recentPts   = recentByName[name] || 0;
    const recentOtPts = recentOtCounts[pid] || 0;
    players[name] = { pts, otPts, recentPts, recentOtPts, eliminated, team };
    console.log(`  ${name.padEnd(15)} ${pts}pts ${otPts}OT ${eliminated ? '❌' : '✅'} (${team})`);
  }

  const output = {
    season: SEASON, gameType: GAME_TYPE,
    lastUpdated: new Date().toISOString(),
    players, series,
    eliminatedTeams: [...eliminatedTeams],
  };

  fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
  console.log(`\nDone — ${Object.keys(players).length} players, ${series.length} series.`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
