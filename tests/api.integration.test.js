'use strict';

process.env.API_LICENSE_KEY = process.env.API_LICENSE_KEY || 'test-license-key';

const request = require('supertest');
const app = require('../src/app');

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
        expect(body.players[0]).toEqual(expect.objectContaining({
          playerId: expect.any(String),
          name: expect.any(String),
          mlbTeam: expect.any(String),
        }));
      }
    }

    expect(legacy.headers.deprecation).toBe('true');
    expect(legacy.headers.sunset).toBeTruthy();

    expect(versioned.headers.deprecation).toBeUndefined();
    expect(versioned.headers.sunset).toBeUndefined();

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
});
