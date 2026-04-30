'use strict';

/**
 * US-7.2 — Unit tests for playersService
 *
 * Tests are pure (no DB, no filesystem I/O) because they operate directly
 * on buildPlayersQuery() and applyPlayersQuery() with in-memory fixtures.
 * loadPlayers() is intentionally NOT tested here — it has DB/FS side-effects
 * and is covered by integration tests (US-7.4).
 */

const {
  buildPlayersQuery,
  applyPlayersQuery,
  getPlayerFilterOptions,
  parseListParam,
} = require('../src/services/playersService');

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makePlayer(overrides = {}) {
  return {
    playerId:    'mlb-100001',
    name:        'Test Player',
    playerName:  'Test Player',
    positions:   ['1B'],
    position:    '1B',
    mlbTeam:     'NYY',
    mlbTeamId:   'mlb-147',
    status:      'active',
    isAvailable: true,
    fpts: 50,
    ab:   400,  r:  60,  h:  110,  hr:  20,  rbi: 70,
    bb:    40,  k:  90,  sb:   5,
    avg: 0.275, obp: 0.340, slg: 0.450,
    era: null, whip: null, w: null, sv: null, ip: null, k9: null,
    ...overrides,
  };
}

const PLAYERS = [
  makePlayer({ playerId: 'mlb-100001', name: 'Aaron Judge',  positions: ['OF'],       mlbTeam: 'NYY', fpts: 200, ab: 550, hr: 45, rbi: 110, sb: 5,  avg: 0.310 }),
  makePlayer({ playerId: 'mlb-100002', name: 'Mookie Betts', positions: ['OF', '2B'], mlbTeam: 'LAD', fpts: 180, ab: 530, hr: 35, rbi:  90, sb: 15, avg: 0.295 }),
  makePlayer({ playerId: 'mlb-100003', name: 'Freddie Freeman', positions: ['1B'],    mlbTeam: 'LAD', fpts: 170, ab: 540, hr: 22, rbi:  95, sb:  3, avg: 0.310 }),
  makePlayer({ playerId: 'mlb-100004', name: 'Trea Turner',  positions: ['SS'],       mlbTeam: 'PHI', fpts: 160, ab: 520, hr: 18, rbi:  80, sb: 30, avg: 0.285 }),
  makePlayer({ playerId: 'mlb-100005', name: 'Pete Alonso',  positions: ['1B'],       mlbTeam: 'NYM', fpts: 150, ab: 510, hr: 38, rbi: 105, sb:  1, avg: 0.250 }),
  makePlayer({ playerId: 'mlb-100006', name: 'Jose Ramirez', positions: ['3B', '2B'], mlbTeam: 'CLE', fpts: 195, ab: 545, hr: 28, rbi:  90, sb: 25, avg: 0.295 }),
  makePlayer({ playerId: 'mlb-100007', name: 'Francisco Lindor', positions: ['SS'],   mlbTeam: 'NYM', fpts: 155, ab: 500, hr: 22, rbi:  80, sb: 20, avg: 0.270 }),
  makePlayer({ playerId: 'mlb-100008', name: 'Rafael Devers',   positions: ['3B'],    mlbTeam: 'BOS', fpts: 145, ab: 490, hr: 25, rbi:  85, sb:  2, avg: 0.260 }),
];

// ── parseListParam ────────────────────────────────────────────────────────────

describe('parseListParam', () => {
  test('returns [] for undefined', () => {
    expect(parseListParam(undefined)).toEqual([]);
  });

  test('returns [] for null', () => {
    expect(parseListParam(null)).toEqual([]);
  });

  test('parses a comma-separated string into uppercase tokens', () => {
    expect(parseListParam('lad,nyy')).toEqual(['LAD', 'NYY']);
  });

  test('parses an array of strings', () => {
    expect(parseListParam(['OF', 'ss'])).toEqual(['OF', 'SS']);
  });

  test('handles mixed array + comma-separated values', () => {
    expect(parseListParam(['OF,1B', 'SS'])).toEqual(['OF', '1B', 'SS']);
  });

  test('deduplicates entries', () => {
    expect(parseListParam('NYY,NYY,LAD')).toEqual(['NYY', 'LAD']);
  });

  test('strips whitespace around tokens', () => {
    expect(parseListParam(' LAD , NYY ')).toEqual(['LAD', 'NYY']);
  });
});

// ── buildPlayersQuery ─────────────────────────────────────────────────────────

describe('buildPlayersQuery', () => {
  test('returns defaults for an empty query', () => {
    const q = buildPlayersQuery({});
    expect(q.search).toBe('');
    expect(q.teams).toEqual([]);
    expect(q.positions).toEqual([]);
    expect(q.sortBy).toBe('fpts');
    expect(q.sortOrder).toBe('desc');
    expect(q.limit).toBe(50);
    expect(q.offset).toBe(0);
    expect(q.ranges).toEqual({});
  });

  test('normalises search to lowercase', () => {
    const q = buildPlayersQuery({ search: 'Judge' });
    expect(q.search).toBe('judge');
  });

  test('parses team filter', () => {
    const q = buildPlayersQuery({ team: 'lad' });
    expect(q.teams).toEqual(['LAD']);
  });

  test('parses multiple teams from comma-separated value', () => {
    const q = buildPlayersQuery({ team: 'LAD,NYY' });
    expect(q.teams).toEqual(['LAD', 'NYY']);
  });

  test('parses position filter', () => {
    const q = buildPlayersQuery({ position: 'OF' });
    expect(q.positions).toEqual(['OF']);
  });

  test('parses limit and clamps to MAX_LIMIT (200)', () => {
    expect(buildPlayersQuery({ limit: '10' }).limit).toBe(10);
    expect(buildPlayersQuery({ limit: '999' }).limit).toBe(200);
    expect(buildPlayersQuery({ limit: '0' }).limit).toBe(1);
  });

  test('parses offset and floors at 0', () => {
    expect(buildPlayersQuery({ offset: '5' }).offset).toBe(5);
    expect(buildPlayersQuery({ offset: '-1' }).offset).toBe(0);
  });

  test('uses fpts as default sortBy for unknown fields', () => {
    const q = buildPlayersQuery({ sortBy: 'notafield' });
    expect(q.sortBy).toBe('fpts');
  });

  test('accepts a valid sortBy field', () => {
    expect(buildPlayersQuery({ sortBy: 'hr' }).sortBy).toBe('hr');
  });

  test('parseSortOrder defaults to desc for unknown values', () => {
    expect(buildPlayersQuery({ sortOrder: 'sideways' }).sortOrder).toBe('desc');
  });

  test('accepts asc sort order', () => {
    expect(buildPlayersQuery({ sortOrder: 'asc' }).sortOrder).toBe('asc');
  });

  test('builds numeric range from minHr / maxHr params', () => {
    const q = buildPlayersQuery({ minHr: '10', maxHr: '40' });
    expect(q.ranges.hr).toEqual({ min: 10, max: 40 });
  });

  test('accepts only a lower bound', () => {
    const q = buildPlayersQuery({ minAb: '400' });
    expect(q.ranges.ab).toEqual({ min: 400, max: null });
  });

  test('ignores non-numeric range values', () => {
    const q = buildPlayersQuery({ minHr: 'abc' });
    expect(q.ranges.hr).toBeUndefined();
  });

  test('first array element wins when a param appears multiple times', () => {
    const q = buildPlayersQuery({ sortBy: ['hr', 'rbi'] });
    expect(q.sortBy).toBe('hr');
  });
});

// ── applyPlayersQuery — search matching ──────────────────────────────────────

describe('applyPlayersQuery — search matching', () => {
  function run(searchStr) {
    const q = buildPlayersQuery({ search: searchStr });
    return applyPlayersQuery(PLAYERS, q).players;
  }

  test('empty search returns all players', () => {
    const q = buildPlayersQuery({});
    const { players, total } = applyPlayersQuery(PLAYERS, q);
    expect(total).toBe(PLAYERS.length);
    expect(players.length).toBeGreaterThan(0);
  });

  test('matches by player name (case-insensitive)', () => {
    const results = run('judge');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Aaron Judge');
  });

  test('matches by partial name', () => {
    const results = run('free');
    expect(results.map((p) => p.name)).toContain('Freddie Freeman');
  });

  test('matches by team abbreviation', () => {
    const results = run('lad');
    expect(results.length).toBe(2); // Mookie + Freddie
    expect(results.every((p) => p.mlbTeam === 'LAD')).toBe(true);
  });

  test('returns empty array for no match', () => {
    const results = run('zzzzz');
    expect(results).toHaveLength(0);
  });

  test('matches by playerId', () => {
    const results = run('mlb-100004');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Trea Turner');
  });
});

// ── applyPlayersQuery — team filtering ───────────────────────────────────────

describe('applyPlayersQuery — team filtering', () => {
  test('filters to a single team', () => {
    const q = buildPlayersQuery({ team: 'NYM' });
    const { players } = applyPlayersQuery(PLAYERS, q);
    expect(players.every((p) => p.mlbTeam === 'NYM')).toBe(true);
    expect(players.length).toBe(2);
  });

  test('filters to multiple teams', () => {
    const q = buildPlayersQuery({ team: 'NYM,BOS' });
    const { players } = applyPlayersQuery(PLAYERS, q);
    expect(players.every((p) => ['NYM', 'BOS'].includes(p.mlbTeam))).toBe(true);
    expect(players.length).toBe(3);
  });

  test('no team filter returns all players', () => {
    const q = buildPlayersQuery({});
    const { total } = applyPlayersQuery(PLAYERS, q);
    expect(total).toBe(PLAYERS.length);
  });

  test('unknown team returns no players', () => {
    const q = buildPlayersQuery({ team: 'XYZ' });
    const { players } = applyPlayersQuery(PLAYERS, q);
    expect(players).toHaveLength(0);
  });
});

// ── applyPlayersQuery — position filtering ───────────────────────────────────

describe('applyPlayersQuery — position filtering', () => {
  test('filters to a single position', () => {
    const q = buildPlayersQuery({ position: 'SS' });
    const { players } = applyPlayersQuery(PLAYERS, q);
    expect(players.every((p) => p.positions.includes('SS'))).toBe(true);
    expect(players.length).toBe(2);
  });

  test('filters to multiple positions (OR logic)', () => {
    const q = buildPlayersQuery({ position: '1B,3B' });
    const { players } = applyPlayersQuery(PLAYERS, q);
    const eligible = PLAYERS.filter((p) =>
      p.positions.includes('1B') || p.positions.includes('3B')
    );
    expect(players.length).toBe(eligible.length);
  });

  test('multi-eligible player appears in results for any of their positions', () => {
    // Mookie Betts: ['OF', '2B']
    const qOF = buildPlayersQuery({ position: 'OF' });
    const q2B = buildPlayersQuery({ position: '2B' });
    const resOF = applyPlayersQuery(PLAYERS, qOF).players.map((p) => p.playerId);
    const res2B = applyPlayersQuery(PLAYERS, q2B).players.map((p) => p.playerId);
    expect(resOF).toContain('mlb-100002');
    expect(res2B).toContain('mlb-100002');
  });

  test('unknown position returns no players', () => {
    const q = buildPlayersQuery({ position: 'DH' });
    const { players } = applyPlayersQuery(PLAYERS, q);
    expect(players).toHaveLength(0);
  });
});

// ── applyPlayersQuery — numeric range filtering ───────────────────────────────

describe('applyPlayersQuery — numeric range filtering', () => {
  test('minHr filters out players below the threshold', () => {
    const q = buildPlayersQuery({ minHr: '30' });
    const { players } = applyPlayersQuery(PLAYERS, q);
    expect(players.every((p) => p.hr >= 30)).toBe(true);
  });

  test('maxHr filters out players above the threshold', () => {
    const q = buildPlayersQuery({ maxHr: '25' });
    const { players } = applyPlayersQuery(PLAYERS, q);
    expect(players.every((p) => p.hr <= 25)).toBe(true);
  });

  test('minHr + maxHr together create an inclusive range', () => {
    const q = buildPlayersQuery({ minHr: '20', maxHr: '28' });
    const { players } = applyPlayersQuery(PLAYERS, q);
    expect(players.every((p) => p.hr >= 20 && p.hr <= 28)).toBe(true);
    expect(players.length).toBeGreaterThan(0);
  });

  test('range that matches no player returns empty list', () => {
    const q = buildPlayersQuery({ minHr: '99' });
    const { players } = applyPlayersQuery(PLAYERS, q);
    expect(players).toHaveLength(0);
  });

  test('minSb + minAb combined filters work', () => {
    const q = buildPlayersQuery({ minSb: '15', minAb: '520' });
    const { players } = applyPlayersQuery(PLAYERS, q);
    expect(players.every((p) => p.sb >= 15 && p.ab >= 520)).toBe(true);
  });
});

// ── applyPlayersQuery — sorting ───────────────────────────────────────────────

describe('applyPlayersQuery — sorting', () => {
  test('default sort is fpts descending', () => {
    const q = buildPlayersQuery({});
    const { players } = applyPlayersQuery(PLAYERS, q);
    for (let i = 1; i < players.length; i++) {
      expect(players[i - 1].fpts >= players[i].fpts).toBe(true);
    }
  });

  test('sortBy hr descending', () => {
    const q = buildPlayersQuery({ sortBy: 'hr', sortOrder: 'desc' });
    const { players } = applyPlayersQuery(PLAYERS, q);
    for (let i = 1; i < players.length; i++) {
      expect(players[i - 1].hr >= players[i].hr).toBe(true);
    }
  });

  test('sortBy hr ascending', () => {
    const q = buildPlayersQuery({ sortBy: 'hr', sortOrder: 'asc' });
    const { players } = applyPlayersQuery(PLAYERS, q);
    for (let i = 1; i < players.length; i++) {
      expect(players[i - 1].hr <= players[i].hr).toBe(true);
    }
  });

  test('sortBy name ascending is alphabetical', () => {
    const q = buildPlayersQuery({ sortBy: 'name', sortOrder: 'asc' });
    const { players } = applyPlayersQuery(PLAYERS, q);
    for (let i = 1; i < players.length; i++) {
      expect(players[i - 1].name.localeCompare(players[i].name)).toBeLessThanOrEqual(0);
    }
  });

  test('sortBy avg descending', () => {
    const q = buildPlayersQuery({ sortBy: 'avg', sortOrder: 'desc' });
    const { players } = applyPlayersQuery(PLAYERS, q);
    for (let i = 1; i < players.length; i++) {
      expect(players[i - 1].avg >= players[i].avg).toBe(true);
    }
  });

  test('sortBy rbi ascending', () => {
    const q = buildPlayersQuery({ sortBy: 'rbi', sortOrder: 'asc' });
    const { players } = applyPlayersQuery(PLAYERS, q);
    for (let i = 1; i < players.length; i++) {
      expect(players[i - 1].rbi <= players[i].rbi).toBe(true);
    }
  });
});

// ── applyPlayersQuery — pagination ───────────────────────────────────────────

describe('applyPlayersQuery — pagination', () => {
  test('limit restricts the number of returned players', () => {
    const q = buildPlayersQuery({ limit: '3' });
    const { players, total } = applyPlayersQuery(PLAYERS, q);
    expect(players).toHaveLength(3);
    expect(total).toBe(PLAYERS.length);
  });

  test('offset skips the specified number of results', () => {
    const qAll  = buildPlayersQuery({ limit: '200' });
    const qPage = buildPlayersQuery({ limit: '200', offset: '2' });
    const allPlayers  = applyPlayersQuery(PLAYERS, qAll).players;
    const pagePlayers = applyPlayersQuery(PLAYERS, qPage).players;
    expect(pagePlayers[0].playerId).toBe(allPlayers[2].playerId);
  });

  test('offset beyond total returns empty players array but correct total', () => {
    const q = buildPlayersQuery({ offset: '999' });
    const { players, total } = applyPlayersQuery(PLAYERS, q);
    expect(players).toHaveLength(0);
    expect(total).toBe(PLAYERS.length);
  });

  test('limit + offset slices correctly', () => {
    const qAll  = buildPlayersQuery({ limit: '200' });
    const qSlice = buildPlayersQuery({ limit: '2', offset: '1' });
    const allPlayers   = applyPlayersQuery(PLAYERS, qAll).players;
    const slicePlayers = applyPlayersQuery(PLAYERS, qSlice).players;
    expect(slicePlayers).toHaveLength(2);
    expect(slicePlayers[0].playerId).toBe(allPlayers[1].playerId);
    expect(slicePlayers[1].playerId).toBe(allPlayers[2].playerId);
  });

  test('response includes limit and offset metadata', () => {
    const q = buildPlayersQuery({ limit: '5', offset: '1' });
    const result = applyPlayersQuery(PLAYERS, q);
    expect(result.limit).toBe(5);
    expect(result.offset).toBe(1);
  });
});

// ── applyPlayersQuery — edge cases ───────────────────────────────────────────

describe('applyPlayersQuery — edge cases', () => {
  test('empty player array returns empty result', () => {
    const q = buildPlayersQuery({});
    const { players, total } = applyPlayersQuery([], q);
    expect(players).toHaveLength(0);
    expect(total).toBe(0);
  });

  test('combined filters narrow results correctly', () => {
    const q = buildPlayersQuery({ team: 'NYM', position: 'SS' });
    const { players } = applyPlayersQuery(PLAYERS, q);
    expect(players.every((p) => p.mlbTeam === 'NYM' && p.positions.includes('SS'))).toBe(true);
  });

  test('search + team filter combined', () => {
    const q = buildPlayersQuery({ search: 'lindor', team: 'NYM' });
    const { players } = applyPlayersQuery(PLAYERS, q);
    expect(players).toHaveLength(1);
    expect(players[0].name).toBe('Francisco Lindor');
  });

  test('search that matches team but excluded by team filter returns no results', () => {
    // "lad" in search would match LAD players; but team filter specifies NYY
    const q = buildPlayersQuery({ search: 'lad', team: 'NYY' });
    const { players } = applyPlayersQuery(PLAYERS, q);
    // MLBTeam search "lad" on NYY player won't match because mlbTeam = 'NYY'
    expect(players).toHaveLength(0);
  });

  test('response includes sort metadata', () => {
    const q = buildPlayersQuery({ sortBy: 'hr', sortOrder: 'asc' });
    const result = applyPlayersQuery(PLAYERS, q);
    expect(result.sort).toEqual({ by: 'hr', order: 'asc' });
  });

  test('response includes filter metadata', () => {
    const q = buildPlayersQuery({ team: 'NYY', position: 'OF' });
    const result = applyPlayersQuery(PLAYERS, q);
    expect(result.filters.teams).toContain('NYY');
    expect(result.filters.positions).toContain('OF');
  });

  test('invalid limit string falls back to default (50)', () => {
    const q = buildPlayersQuery({ limit: 'banana' });
    expect(q.limit).toBe(50);
  });

  test('negative offset is clamped to 0', () => {
    const q = buildPlayersQuery({ offset: '-5' });
    expect(q.offset).toBe(0);
  });
});

// ── getPlayerFilterOptions ────────────────────────────────────────────────────

describe('getPlayerFilterOptions', () => {
  test('returns sorted unique team list', () => {
    const opts = getPlayerFilterOptions(PLAYERS);
    const teams = opts.teams;
    expect(Array.isArray(teams)).toBe(true);
    expect(teams).toContain('NYY');
    expect(teams).toContain('LAD');
    expect([...teams].sort().join()).toBe(teams.join()); // already sorted
  });

  test('returns sorted unique position list', () => {
    const opts = getPlayerFilterOptions(PLAYERS);
    expect(opts.positions).toContain('OF');
    expect(opts.positions).toContain('SS');
  });

  test('returns sortFields array', () => {
    const opts = getPlayerFilterOptions(PLAYERS);
    expect(Array.isArray(opts.sortFields)).toBe(true);
    expect(opts.sortFields).toContain('fpts');
    expect(opts.sortFields).toContain('hr');
  });

  test('returns empty teams + positions for empty player array', () => {
    const opts = getPlayerFilterOptions([]);
    expect(opts.teams).toHaveLength(0);
    expect(opts.positions).toHaveLength(0);
  });
});
