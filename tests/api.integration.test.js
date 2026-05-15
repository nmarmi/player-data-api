'use strict';

process.env.API_LICENSE_KEY = process.env.API_LICENSE_KEY || 'test-license-key';

const request = require('supertest');
const app = require('../src/app');
const { migrate } = require('../src/db/migrate');
const { createAccount, createKey } = require('../src/db/developerAccounts');
const { getDb } = require('../src/db/connection');

const TEST_PLAYER_PREFIX = 'mlb-901';

beforeAll(() => {
  // Ensure all tables (including api_keys) exist in the test DB.
  try { migrate(); } catch (_) {}

  // Seed minimal player + stats rows so /players and /valuations endpoints return data.
  const db = getDb();
  const season = new Date().getFullYear() - 1;
  const insertPlayer = db.prepare(`
    INSERT OR IGNORE INTO players (player_id, mlb_person_id, name, player_name, positions, mlb_team, status)
    VALUES (@player_id, @mlb_person_id, @name, @name, @positions, @mlb_team, 'active')
  `);
  const insertStat = db.prepare(`
    INSERT OR REPLACE INTO player_stats (player_id, mlb_person_id, season, stat_group, games_played, ab, r, h, hr, rbi, bb, k, sb, avg, obp, slg, ip, w, era, whip, sv)
    VALUES (@player_id, @mlb_person_id, @season, @stat_group, 162, @ab, @r, @h, @hr, @rbi, @bb, @k, @sb, @avg, @obp, @slg, @ip, @w, @era, @whip, @sv)
  `);
  const testData = [
    { player_id: 'mlb-901001', mlb_person_id: 901001, name: 'Test Hitter 1', positions: '["OF"]', mlb_team: 'NYY', stat_group: 'hitting', ab: 550, r: 90, h: 165, hr: 30, rbi: 95, bb: 75, k: 120, sb: 15, avg: 0.3, obp: 0.38, slg: 0.52, ip: 0, w: 0, era: 0, whip: 0, sv: 0 },
    { player_id: 'mlb-901002', mlb_person_id: 901002, name: 'Test Hitter 2', positions: '["1B"]', mlb_team: 'LAD', stat_group: 'hitting', ab: 520, r: 80, h: 150, hr: 25, rbi: 85, bb: 65, k: 130, sb: 5, avg: 0.288, obp: 0.36, slg: 0.49, ip: 0, w: 0, era: 0, whip: 0, sv: 0 },
    { player_id: 'mlb-901003', mlb_person_id: 901003, name: 'Test Hitter 3', positions: '["3B"]', mlb_team: 'ATL', stat_group: 'hitting', ab: 500, r: 75, h: 140, hr: 22, rbi: 78, bb: 55, k: 115, sb: 8, avg: 0.28, obp: 0.35, slg: 0.47, ip: 0, w: 0, era: 0, whip: 0, sv: 0 },
    { player_id: 'mlb-901004', mlb_person_id: 901004, name: 'Test Pitcher 1', positions: '["SP"]', mlb_team: 'HOU', stat_group: 'pitching', ab: 0, r: 0, h: 0, hr: 0, rbi: 0, bb: 0, k: 200, sb: 0, avg: 0, obp: 0, slg: 0, ip: 180, w: 15, era: 3.2, whip: 1.1, sv: 0 },
    { player_id: 'mlb-901005', mlb_person_id: 901005, name: 'Test Closer 1', positions: '["RP"]', mlb_team: 'BOS', stat_group: 'pitching', ab: 0, r: 0, h: 0, hr: 0, rbi: 0, bb: 0, k: 80, sb: 0, avg: 0, obp: 0, slg: 0, ip: 65, w: 4, era: 2.8, whip: 1.05, sv: 35 },
  ];
  db.transaction(() => {
    for (const p of testData) {
      insertPlayer.run(p);
      insertStat.run({ ...p, season });
    }
  })();
});

afterAll(() => {
  const db = getDb();
  db.exec(`DELETE FROM player_stats WHERE player_id LIKE '${TEST_PLAYER_PREFIX}%'`);
  db.exec(`DELETE FROM players WHERE player_id LIKE '${TEST_PLAYER_PREFIX}%'`);
});

function buildDraftKitLeagueSettings() {
  return {
    numberOfTeams: 10,
    salaryCap: 260,
    rosterSlots: {
      C: 2,
      '1B': 1,
      '2B': 1,
      '3B': 1,
      SS: 1,
      OF: 5,
      UTIL: 1,
      SP: 5,
      RP: 3,
      BENCH: 4,
    },
    scoringType: '5x5 Roto',
  };
}

describe('US-7.4 integration tests for API endpoints', () => {
  function auth(req) {
    return req.set('X-API-Key', process.env.API_LICENSE_KEY);
  }

  test('auth middleware rejects unauthenticated requests', async () => {
    const out = await request(app).get('/api/v1/players?limit=1');

    expect(out.status).toBe(401);
    expect(out.body.success).toBe(false);
    expect(out.body.code).toBe('UNAUTHORIZED');
  });

  test('US-8.5: per-key rate limit returns 429 with Retry-After when exceeded', async () => {
    // Reset bucket state and shrink the window so we can hit the limit fast.
    const { _resetBuckets } = require('../src/middleware/rateLimit');
    _resetBuckets();
    const original = { window: process.env.RATE_LIMIT_WINDOW_MS, max: process.env.RATE_LIMIT_MAX_PER_WINDOW };
    process.env.RATE_LIMIT_WINDOW_MS = '60000';
    process.env.RATE_LIMIT_MAX_PER_WINDOW = '3';

    try {
      // Three valid requests should pass.
      for (let i = 0; i < 3; i++) {
        const ok = await auth(request(app).get('/api/v1/players?limit=1'));
        expect(ok.status).toBe(200);
      }
      // Fourth must 429 with Retry-After header and proper code.
      const limited = await auth(request(app).get('/api/v1/players?limit=1'));
      expect(limited.status).toBe(429);
      expect(limited.body.success).toBe(false);
      expect(limited.body.code).toBe('RATE_LIMITED');
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    } finally {
      process.env.RATE_LIMIT_WINDOW_MS = original.window || '';
      process.env.RATE_LIMIT_MAX_PER_WINDOW = original.max || '';
      _resetBuckets();
    }
  });

  test('US-8.5: missing key returns 401 even under rate-limit middleware', async () => {
    const { _resetBuckets } = require('../src/middleware/rateLimit');
    _resetBuckets();
    const out = await request(app).get('/api/v1/players?limit=1'); // no X-API-Key
    expect(out.status).toBe(401);
    expect(out.body.code).toBe('UNAUTHORIZED');
  });

  test('US-8.4: GET /health returns status, database, dataFreshness, uptime — no key required', async () => {
    const out = await request(app).get('/api/v1/health');
    expect(out.status).toBe(200);
    expect(out.body.success).toBe(true);
    expect(out.body.status).toBe('ok');
    expect(out.body.service).toBe('player-data-api');
    expect(out.body.database).toEqual(expect.objectContaining({ connected: true }));
    expect(typeof out.body.dataFreshness).toBe('object');
    expect(typeof out.body.uptimeSeconds).toBe('number');
    expect(out.body.uptimeSeconds).toBeGreaterThanOrEqual(0);

    // /health is exempt from the license requirement — same response with no key.
    const noKey = await request(app).get('/api/v1/health');
    expect(noKey.status).toBe(200);
    expect(noKey.body.success).toBe(true);
  });

  test('GET /players and /api/v1/players return documented response shape', async () => {
    const versioned = await auth(request(app).get('/api/v1/players?limit=3'));
    const legacy = await auth(request(app).get('/players?limit=3'));

    expect(versioned.status).toBe(200);
    expect(legacy.status).toBe(200);

    for (const body of [versioned.body, legacy.body]) {
      expect(body.success).toBe(true);
      expect(Array.isArray(body.players)).toBe(true);
      expect(typeof body.total).toBe('number');
      expect(typeof body.limit).toBe('number');
      expect(typeof body.offset).toBe('number');
      expect(body.sort).toEqual(expect.objectContaining({ by: expect.any(String), order: expect.any(String) }));
      expect(body.filters).toEqual(expect.any(Object));
      expect(body.apiVersion).toBe('v1');

      if (body.players.length > 0) {
        const sample = body.players[0];
        expect(sample).toEqual(expect.objectContaining({
          playerId: expect.any(String),
          name: expect.any(String),
          mlbTeam: expect.any(String),
          mlbTeamId: expect.any(String),
        }));
        // US-1.1 / US-1.2: ID conventions
        expect(sample.playerId).toMatch(/^mlb-\d+$/);
        expect(sample.mlbTeamId).toMatch(/^mlb-\d+$/);
      }
    }

    // US-2.8: legacy routes carry Deprecation, Sunset, and Link headers
    expect(legacy.headers.deprecation).toBe('true');
    expect(legacy.headers.sunset).toBeTruthy();
    expect(legacy.headers.link).toMatch(/rel="deprecation"/);

    expect(versioned.headers.deprecation).toBeUndefined();
    expect(versioned.headers.sunset).toBeUndefined();
    expect(versioned.headers.link).toBeUndefined();

    expect(legacy.body.players.length).toBe(versioned.body.players.length);
    expect(legacy.body.total).toBe(versioned.body.total);
  });

  test('GET /players/:id and /players/pool return documented response shapes', async () => {
    const list = await auth(request(app).get('/api/v1/players?limit=1'));
    const playerId = list.body.players[0].playerId;

    const detail = await auth(request(app).get(`/api/v1/players/${playerId}`));
    expect(detail.status).toBe(200);
    expect(detail.body.success).toBe(true);
    expect(detail.body.player).toEqual(expect.objectContaining({
      playerId,
      name: expect.any(String),
      mlbTeam: expect.any(String),
      mlbTeamId: expect.stringMatching(/^mlb-\d+$/),
    }));

    const pool = await auth(request(app).get('/api/v1/players/pool?position=OF'));
    expect(pool.status).toBe(200);
    expect(pool.body.success).toBe(true);
    expect(Array.isArray(pool.body.players)).toBe(true);
  });

  test('POST /players/valuations returns US-5.3/US-5.4 contract fields', async () => {
    const body = {
      leagueSettings: buildDraftKitLeagueSettings(),
      draftState: {
        availablePlayerIds: [],
        purchasedPlayers: [{ playerId: 'mlb-649017', price: 42 }],
        teamBudgets: { t1: 180, t2: 190 },
        filledRosterSlots: {
          t1: { OF: 1, SP: 1 },
          t2: { RP: 1 },
        },
      },
    };

    const out = await auth(request(app).post('/api/v1/players/valuations').send(body));

    expect(out.status).toBe(200);
    expect(out.body.success).toBe(true);
    expect(Array.isArray(out.body.valuations)).toBe(true);
    expect(out.body.valuations.length).toBeGreaterThan(0);
    expect(out.body.meta).toEqual(expect.objectContaining({
      season: expect.any(Number),
      isDraftActive: expect.any(Boolean),
      valuationCount: expect.any(Number),
      targetTotalValue: expect.any(Number),
      rosterSlotConfig: expect.any(Object),
    }));

    const first = out.body.valuations[0];
    expect(first).toEqual(expect.objectContaining({
      playerId: expect.any(String),
      name: expect.any(String),
      projectedValue: expect.any(Number),
      dollarValue: expect.any(Number),
    }));
    expect(Object.prototype.hasOwnProperty.call(first, 'purchasePrice')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(first, 'valueGap')).toBe(true);
  });

  test('POST /players/recommendations and /players/recommendations/nominations match US-6 contracts', async () => {
    const body = {
      leagueSettings: buildDraftKitLeagueSettings(),
      draftState: {
        teamBudgets: { t1: 200, t2: 190 },
        filledRosterSlots: {
          t1: { OF: 1, SP: 1 },
          t2: { RP: 1 },
        },
      },
      teamId: 't1',
    };

    const recs = await auth(request(app).post('/api/v1/players/recommendations').send(body));
    expect(recs.status).toBe(200);
    expect(recs.body.success).toBe(true);
    expect(Array.isArray(recs.body.recommendations)).toBe(true);
    expect(recs.body.thresholds).toEqual(expect.objectContaining({ buyAbove: expect.any(Number), avoidBelow: expect.any(Number) }));
    expect(recs.body.teamId).toBe('t1');
    if (recs.body.recommendations.length > 0) {
      expect(recs.body.recommendations[0]).toEqual(expect.objectContaining({
        playerId: expect.any(String),
        name: expect.any(String),
        projectedValue: expect.any(Number),
        recommendedBid: expect.any(Number),
        rank: expect.any(Number),
        tier: expect.any(String),
        reason: expect.any(String),
      }));
    }

    const noms = await auth(request(app).post('/api/v1/players/recommendations/nominations').send(body));
    expect(noms.status).toBe(200);
    expect(noms.body.success).toBe(true);
    expect(Array.isArray(noms.body.nominations)).toBe(true);
    expect(noms.body.teamId).toBe('t1');
    if (noms.body.nominations.length > 0) {
      expect(noms.body.nominations[0]).toEqual(expect.objectContaining({
        playerId: expect.any(String),
        name: expect.any(String),
        expectedMarketBid: expect.any(Number),
        myTeamNeedScore: expect.any(Number),
        reason: expect.any(String),
      }));
    }
  });

  test('invalid input: Draft-Kit-shaped body missing rosterSlots returns 400 with fields[] detail', async () => {
    const out = await auth(request(app)
      .post('/api/v1/players/recommendations')
      .send({
        leagueSettings: {
          numberOfTeams: 10,
          salaryCap: 260,
          scoringType: '5x5 Roto',
        },
        draftState: { teamBudgets: { t1: 200 } },
        teamId: 't1',
      }));

    expect(out.status).toBe(400);
    expect(out.body.success).toBe(false);
    expect(out.body.code).toBe('BAD_REQUEST');
    expect(Array.isArray(out.body.fields)).toBe(true);
    expect(out.body.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'leagueSettings.rosterSlots' }),
      ])
    );
  });

  test('invalid input: unknown teamId returns 400 with field-level detail', async () => {
    const out = await auth(request(app)
      .post('/api/v1/players/recommendations')
      .send({
        leagueSettings: buildDraftKitLeagueSettings(),
        draftState: { teamBudgets: { t1: 200 } },
        teamId: 'not-a-team',
      }));

    expect(out.status).toBe(400);
    expect(out.body.success).toBe(false);
    expect(out.body.code).toBe('UNKNOWN_TEAM');
    expect(Array.isArray(out.body.fields)).toBe(true);
    expect(out.body.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'teamId' }),
      ])
    );
  });

  test('versioned and legacy recommendations routes behave identically; legacy includes deprecation headers', async () => {
    const body = {
      leagueSettings: buildDraftKitLeagueSettings(),
      draftState: { teamBudgets: { t1: 200 }, filledRosterSlots: { t1: { OF: 1 } } },
      teamId: 't1',
      limit: 5,
    };

    const versioned = await auth(request(app).post('/api/v1/players/recommendations').send(body));
    const legacy = await auth(request(app).post('/players/recommendations').send(body));

    expect(versioned.status).toBe(200);
    expect(legacy.status).toBe(200);

    expect(legacy.headers.deprecation).toBe('true');
    expect(legacy.headers.sunset).toBeTruthy();
    expect(versioned.headers.deprecation).toBeUndefined();

    expect(legacy.body.success).toBe(versioned.body.success);
    expect(Array.isArray(legacy.body.recommendations)).toBe(true);
    expect(legacy.body.recommendations.length).toBe(versioned.body.recommendations.length);
    expect(legacy.body.thresholds).toEqual(versioned.body.thresholds);
  });

  test('US-7.5: sequential draft-state transitions update valuations and recommendations', async () => {
    const leagueSettings = buildDraftKitLeagueSettings();

    const initialVals = await auth(
      request(app)
        .post('/api/v1/players/valuations')
        .send({
          leagueSettings,
          draftState: {
            teamBudgets: { t1: 260, t2: 260 },
            filledRosterSlots: { t1: {}, t2: {} },
          },
        })
    );
    expect(initialVals.status).toBe(200);
    expect(initialVals.body.success).toBe(true);
    expect(initialVals.body.valuations.length).toBeGreaterThan(20);

    const purchased = initialVals.body.valuations.slice(0, 3).map((v, i) => ({
      playerId: v.playerId,
      price: [45, 35, 30][i] || 25,
    }));
    const purchasedIds = new Set(purchased.map((p) => p.playerId));

    const afterDraftVals = await auth(
      request(app)
        .post('/api/v1/players/valuations')
        .send({
          leagueSettings,
          draftState: {
            purchasedPlayers: purchased,
            teamBudgets: { t1: 180, t2: 170 },
            filledRosterSlots: {
              t1: { OF: 1, SP: 1, C: 1 },
              t2: { OF: 1, RP: 1 },
            },
          },
        })
    );
    expect(afterDraftVals.status).toBe(200);
    expect(afterDraftVals.body.success).toBe(true);

    // US-5.5: purchased players appear in the response with `purchasePrice` set
    // (so the Draft Kit can render value-vs-paid in one call). Available players
    // are flagged with `purchasePrice: null`. Purchased players are still
    // EXCLUDED from the calibration/computation that drives remaining-pool values.
    const byId = new Map(afterDraftVals.body.valuations.map((v) => [v.playerId, v]));
    for (const p of purchased) {
      const row = byId.get(p.playerId);
      expect(row).toBeTruthy();
      expect(row.purchasePrice).toBe(p.price);
      expect(row.valueGap).toBeCloseTo(row.projectedValue - p.price, 4);
    }

    // As pool shrinks and budgets drop, remaining (available) player values should shift.
    const remainingBefore = initialVals.body.valuations.find((v) => !purchasedIds.has(v.playerId));
    const remainingAfter = afterDraftVals.body.valuations.find(
      (v) => v.playerId === remainingBefore.playerId && v.purchasePrice === null
    );
    expect(remainingAfter).toBeTruthy();
    expect(remainingAfter.projectedValue).not.toBe(remainingBefore.projectedValue);

    const recHighBudget = await auth(
      request(app)
        .post('/api/v1/players/recommendations')
        .send({
          leagueSettings,
          draftState: {
            purchasedPlayers: purchased,
            teamBudgets: { t1: 180, t2: 170 },
            filledRosterSlots: {
              t1: { OF: 1, SP: 1, C: 1 },
              t2: { OF: 1, RP: 1 },
            },
          },
          teamId: 't1',
          limit: 10,
        })
    );
    expect(recHighBudget.status).toBe(200);
    expect(recHighBudget.body.success).toBe(true);
    expect(recHighBudget.body.meta).toEqual(expect.objectContaining({
      targetTotalValue: expect.any(Number),
      draftBudget: expect.any(Object),
    }));

    const recLowBudget = await auth(
      request(app)
        .post('/api/v1/players/recommendations')
        .send({
          leagueSettings,
          draftState: {
            purchasedPlayers: purchased,
            teamBudgets: { t1: 120, t2: 110 },
            filledRosterSlots: {
              t1: { OF: 2, SP: 1, C: 1 },
              t2: { OF: 1, RP: 1, SP: 1 },
            },
          },
          teamId: 't1',
          limit: 10,
        })
    );
    expect(recLowBudget.status).toBe(200);
    expect(recLowBudget.body.success).toBe(true);

    // Budget constraints should flow through into lower valuation scale/recommended bids.
    expect(recLowBudget.body.meta.targetTotalValue).toBeLessThan(recHighBudget.body.meta.targetTotalValue);
    const highById = new Map(
      (recHighBudget.body.recommendations || []).map((r) => [r.playerId, Number(r.recommendedBid) || 0])
    );
    const lowById = new Map(
      (recLowBudget.body.recommendations || []).map((r) => [r.playerId, Number(r.recommendedBid) || 0])
    );
    const overlap = [...highById.keys()].filter((id) => lowById.has(id));
    expect(overlap.length).toBeGreaterThan(0);

    const highAvg = overlap.reduce((s, id) => s + highById.get(id), 0) / overlap.length;
    const lowAvg = overlap.reduce((s, id) => s + lowById.get(id), 0) / overlap.length;
    expect(lowAvg).toBeLessThan(highAvg);
  });

  test('US-10.4: last_used_at is bumped after a successful DB-key authed call', async () => {
    // Create a fresh account + key in the test DB
    const accountId = createAccount(`audit-${Date.now()}@example.com`, 'password123', false);
    const { rawKey, id: keyId } = createKey(accountId, 'audit-test');

    // Confirm last_used_at starts null
    const before = getDb().prepare('SELECT last_used_at FROM api_keys WHERE id = ?').get(keyId);
    expect(before.last_used_at).toBeNull();

    // Make an authenticated request with the DB-issued key
    const res = await request(app)
      .get('/api/v1/players?limit=1')
      .set('X-API-Key', rawKey);
    expect(res.status).toBe(200);

    // last_used_at should now be set
    const after = getDb().prepare('SELECT last_used_at FROM api_keys WHERE id = ?').get(keyId);
    expect(after.last_used_at).toBeTruthy();
  });

  test('debug exclusions: valuations can explain why a player is excluded', async () => {
    const out = await auth(
      request(app)
        .post('/api/v1/players/valuations?debugExclusions=true&debugPlayerIds=mlb-592450')
        .send({
          leagueSettings: buildDraftKitLeagueSettings(),
          draftState: {
            purchasedPlayers: [{ playerId: 'mlb-592450', price: 44 }],
            teamBudgets: { t1: 200, t2: 180 },
          },
        })
    );

    expect(out.status).toBe(200);
    expect(out.body.success).toBe(true);
    expect(out.body.debug).toBeTruthy();
    expect(Array.isArray(out.body.debug.players)).toBe(true);
    expect(out.body.debug.players.length).toBe(1);
    expect(out.body.debug.players[0]).toEqual(expect.objectContaining({
      playerId: 'mlb-592450',
      reasons: expect.arrayContaining(['purchased']),
    }));
  });
});
