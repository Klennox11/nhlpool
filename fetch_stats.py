"""
NHL Playoff Pool — Auto Stats Fetcher
======================================
Uses the FREE, no-key-required official NHL API (api-web.nhle.com).
Pulls each player's playoff points + OT goals and writes data.json.

Run locally:  python fetch_stats.py
Runs automatically via GitHub Actions (see .github/workflows/update-stats.yml)
"""

import json
import urllib.request
import time

# ─── PLAYER ID MAP ────────────────────────────────────────────────────────────
# IDs sourced from nhl.com player URLs, e.g. nhl.com/player/connor-mcdavid-8478402
PLAYER_IDS = {
    'McDavid':    8478402,   # Connor McDavid        EDM
    'MacKinnon':  8477492,   # Nathan MacKinnon      COL
    'Rantanen':   8478420,   # Mikko Rantanen        COL
    'Makar':      8480069,   # Cale Makar            COL
    'Kaprizov':   8481600,   # Kirill Kaprizov       MIN
    'Kucherov':   8476453,   # Nikita Kucherov       TBL
    'Necas':      8480762,   # Martin Necas          CAR
    'Suzuki':     8481540,   # Nick Suzuki           MTL
    'Caufield':   8482655,   # Cole Caufield         MTL
    'Robertson':  8480024,   # Jason Robertson       DAL
    'Aho':        8478427,   # Sebastian Aho         CAR
    'Hyman':      8475786,   # Zach Hyman            EDM
    'Hagel':      8481533,   # Brandon Hagel         TBL
    'Svechnikov': 8480830,   # Andrei Svechnikov     CAR
    'Demidov':    8484144,   # Ivan Demidov          MTL
    'Bouchard':   8480932,   # Evan Bouchard         EDM
    'Marner':     8478483,   # Mitch Marner          TOR
    'Crosby':     8471675,   # Sidney Crosby         PIT
    'Stone':      8475913,   # Mark Stone            VGK
    'Eichel':     8478403,   # Jack Eichel           VGK
    'Thompson':   8480801,   # Tage Thompson         BUF
    'Stutzle':    8482116,   # Tim Stutzle           OTT
    'Batherson':  8481606,   # Drake Batherson       OTT
    'Guenther':   8483524,   # Dylan Guenther        UTA
    'Savoie':     8484149,   # Matthew Savoie        BUF
    'Slafkovsky': 8484493,   # Juraj Slafkovsky      MTL
    'Ehlers':     8477956,   # Nikolaj Ehlers        WPG
    'Konecny':    8479550,   # Travis Konecny        PHI
    'Schmaltz':   8476882,   # Nick Schmaltz         UTA
    'Dahlin':     8480787,   # Rasmus Dahlin         BUF
    'Hutson':     8484967,   # Lane Hutson           MTL
    'Johnston':   8482749,   # Wyatt Johnston        DAL
    'Guentzel':   8476924,   # Jake Guentzel         CAR
}

SEASON    = '20252026'  # 2025-26 season in YYYYYYYY format
GAME_TYPE = 3           # 3 = playoffs
BASE_URL  = 'https://api-web.nhle.com/v1'


def get_json(url, retries=3):
    """Fetch URL and return parsed JSON, retrying on failure."""
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                url,
                headers={'User-Agent': 'NHLPoolBot/1.0'}
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                return json.loads(resp.read().decode('utf-8'))
        except Exception as e:
            print(f'    Attempt {attempt + 1}/{retries} failed: {e}')
            if attempt < retries - 1:
                time.sleep(2)
    return None


def get_ot_goals_for_game(player_id, game_id):
    """
    Check play-by-play for OT goals by this player in a specific game.
    Only called when the player scored at least one goal that game.
    """
    url = f'{BASE_URL}/gamecenter/{game_id}/play-by-play'
    data = get_json(url)
    if not data:
        return 0

    ot_goals = 0
    for play in data.get('plays', []):
        if play.get('typeDescKey') != 'goal':
            continue
        period_type = play.get('periodDescriptor', {}).get('periodType', '')
        if period_type != 'OT':
            continue
        scorer_id = play.get('details', {}).get('scoringPlayerId')
        if scorer_id == player_id:
            ot_goals += 1

    return ot_goals


def fetch_player_stats(last_name, player_id):
    """
    Returns (playoff_points, ot_goals) for a player this postseason.
    Checks play-by-play for OT goals on any game where the player scored.
    """
    url = f'{BASE_URL}/player/{player_id}/game-log/{SEASON}/{GAME_TYPE}'
    data = get_json(url)

    if not data or not data.get('gameLog'):
        return 0, 0

    total_pts  = 0
    total_ot_g = 0

    for game in data['gameLog']:
        goals   = game.get('goals', 0)
        assists = game.get('assists', 0)
        total_pts += goals + assists

        # Only hit play-by-play endpoint if the player scored a goal that game
        if goals > 0:
            game_id = game.get('gameId')
            if game_id:
                ot = get_ot_goals_for_game(player_id, game_id)
                total_ot_g += ot
                time.sleep(0.15)  # small pause after play-by-play calls

    return total_pts, total_ot_g


def main():
    print('=== NHL Playoff Pool Stats Fetcher ===')
    print(f'Season: {SEASON} | Playoffs (game type {GAME_TYPE})')
    print(f'Fetching {len(PLAYER_IDS)} players...\n')

    results = {}
    for last_name, player_id in PLAYER_IDS.items():
        print(f'  {last_name:<15} (ID {player_id}) ...', end=' ', flush=True)
        pts, ot_goals = fetch_player_stats(last_name, player_id)
        results[last_name] = {'pts': pts, 'otPts': ot_goals}
        print(f'{pts} pts, {ot_goals} OT goals')
        time.sleep(0.3)  # polite rate-limiting between player requests

    output = {
        'season':      SEASON,
        'gameType':    GAME_TYPE,
        'lastUpdated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'players':     results,
    }

    with open('data.json', 'w') as f:
        json.dump(output, f, indent=2)

    print(f'\ndata.json written — {len(results)} players updated.')
    print(f'Last updated: {output["lastUpdated"]}')


if __name__ == '__main__':
    main()
