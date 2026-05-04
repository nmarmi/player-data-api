'use strict';

const {
  computeValuations,
  mergeSettings,
  normalizeLeagueSettings,
  runValuations,
} = require('../src/services/valuationEngine');
const { getValuations } = require('../src/controllers/valuationsController');

function makeHitter(overrides = {}) {
  return {
    player_id: 'mlb-100001',
    name: 'Hitter One',
    positions: JSON.stringify(['OF']),
    mlb_team: 'NYY',
    ab: 550,
    r: 90,
    h: 165,
    hr: 30,
    rbi: 95,
    bb: 75,
    k: 120,
    sb: 15,
    avg: 0.3,
    obp: 0.38,
    slg: 0.52,
    ...overrides,
  };
}

function makePitcher(overrides = {}) {
  return {
    player_id: 'mlb-200001',
    name: 'Pitcher One',
    positions: JSON.stringify(['SP']),
    mlb_team: 'NYY',
    ip: 180,
    w: 14,
    l: 8,
    era: 3.4,
    whip: 1.15,
    k: 210,
    sv: 0,
    hld: 0,
    ...overrides,
  };
}

function buildPoolPlayers(hitters, pitchers) {
  return [...hitters, ...pitchers].map((p) => ({
    playerId: p.player_id,
    name: p.name,
    mlbTeam: p.mlb_team,
    positions: JSON.parse(p.positions),
  }));
}

function sumDollarValues(rows) {
  return Math.round(rows.reduce((s, r) => s + (Number(r.dollarValue) || 0), 0) * 100) / 100;
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe('valuationEngine (US-7.3)', () => {
  const hitters = [
    makeHitter({ player_id: 'mlb-100001', name: 'Elite Catcher', positions: JSON.stringify(['C']), mlb_team: 'SEA', hr: 38, rbi: 110, r: 95, sb: 4, avg: 0.29 }),
    makeHitter({ player_id: 'mlb-100002', name: 'Weak Catcher', positions: JSON.stringify(['C']), mlb_team: 'OAK', hr: 8, rbi: 35, r: 30, sb: 1, avg: 0.22, ab: 420 }),
    makeHitter({ player_id: 'mlb-100003', name: 'Elite OF', positions: JSON.stringify(['OF']), mlb_team: 'NYY', hr: 45, rbi: 120, r: 120, sb: 18, avg: 0.31 }),
    makeHitter({ player_id: 'mlb-100004', name: 'Strong OF', positions: JSON.stringify(['OF']), mlb_team: 'LAD', hr: 35, rbi: 100, r: 108, sb: 20, avg: 0.3 }),
    makeHitter({ player_id: 'mlb-100005', name: 'Avg OF', positions: JSON.stringify(['OF']), mlb_team: 'ATL', hr: 24, rbi: 80, r: 85, sb: 12, avg: 0.275 }),
    makeHitter({ player_id: 'mlb-100006', name: 'Low OF', positions: JSON.stringify(['OF']), mlb_team: 'MIA', hr: 12, rbi: 50, r: 55, sb: 8, avg: 0.245, ab: 470 }),
  ];

  const pitchers = [
    makePitcher({ player_id: 'mlb-200001', name: 'Ace SP', positions: JSON.stringify(['SP']), mlb_team: 'NYY', w: 18, era: 2.7, whip: 1.02, k: 250 }),
    makePitcher({ player_id: 'mlb-200002', name: 'SP2', positions: JSON.stringify(['SP']), mlb_team: 'LAD', w: 14, era: 3.3, whip: 1.12, k: 215 }),
    makePitcher({ player_id: 'mlb-200003', name: 'SP3', positions: JSON.stringify(['SP']), mlb_team: 'SEA', w: 11, era: 3.8, whip: 1.22, k: 185 }),
    makePitcher({ player_id: 'mlb-200004', name: 'Closer', positions: JSON.stringify(['RP']), mlb_team: 'HOU', w: 4, sv: 36, era: 2.8, whip: 1.01, k: 95, ip: 65 }),
  ];

  test('values sum approximately to total league salary pool', () => {
    const settings = mergeSettings({
      numTeams: 10,
      budget: 260,
      minAB: 0,
      minIP: 0,
    });

    const vals = computeValuations(
      hitters,
      pitchers,
      buildPoolPlayers(hitters, pitchers),
      settings
    );

    const total = sumDollarValues(vals);
    const target = settings.numTeams * settings.budget;

    expect(total).toBeCloseTo(target, 2);
  });

  test('positional scarcity adjustments affect values', () => {
    const withCatcherScarcity = mergeSettings({
      numTeams: 1,
      budget: 260,
      minAB: 0,
      minIP: 0,
      rosterSlots: { C: 2, OF: 2, UTIL: 0, SP: 2, RP: 1, P: 0, BENCH: 0 },
    });

    const withoutCatcherScarcity = mergeSettings({
      numTeams: 1,
      budget: 260,
      minAB: 0,
      minIP: 0,
      rosterSlots: { C: 0, OF: 4, UTIL: 0, SP: 2, RP: 1, P: 0, BENCH: 0 },
    });

    const valsWith = computeValuations(
      hitters,
      pitchers,
      buildPoolPlayers(hitters, pitchers),
      withCatcherScarcity
    );

    const valsWithout = computeValuations(
      hitters,
      pitchers,
      buildPoolPlayers(hitters, pitchers),
      withoutCatcherScarcity
    );

    const eliteCWith = valsWith.find((v) => v.playerId === 'mlb-100001');
    const eliteCWithout = valsWithout.find((v) => v.playerId === 'mlb-100001');

    expect(eliteCWith).toBeTruthy();
    expect(eliteCWithout).toBeTruthy();
    expect(eliteCWith.scarcityPosition).toBe('C');
    expect(eliteCWith.positionalValueAboveReplacement)
      .toBeGreaterThan(eliteCWithout.positionalValueAboveReplacement);
    expect(eliteCWith.dollarValue).toBeGreaterThanOrEqual(eliteCWithout.dollarValue);
  });

  test('draft-state-aware recalculation changes output vs pre-draft', () => {
    const leagueSettings = {
      numTeams: 2,
      budget: 260,
      rosterSlots: { C: 1, '1B': 1, '2B': 1, '3B': 1, SS: 1, OF: 3, UTIL: 1, SP: 3, RP: 2, BENCH: 3 },
    };

    const pre = runValuations(leagueSettings, {});

    const liveDraft = runValuations(leagueSettings, {
      purchasedPlayers: [{ playerId: 'mlb-649017', price: 42 }],
      teamBudgets: { t1: 180, t2: 170 },
      filledRosterSlots: {
        t1: { OF: 1, SP: 1, C: 1 },
        t2: { SP: 1, RP: 1 },
      },
    });

    expect(pre.valuations.length).toBeGreaterThan(0);
    expect(liveDraft.valuations.length).toBeGreaterThan(0);
    expect(liveDraft.meta.isDraftActive).toBe(true);
    expect(liveDraft.meta.targetTotalValue).not.toBe(pre.meta.targetTotalValue);

    const firstPre = pre.valuations[0];
    const firstLive = liveDraft.valuations.find((v) => v.playerId === firstPre.playerId);
    expect(firstLive).toBeTruthy();
    expect(firstLive.projectedValue).not.toBe(firstPre.projectedValue);
  });

  test('league settings changes affect output', () => {
    const base = runValuations({ numTeams: 10, budget: 260 }, {});
    const changed = runValuations({ numTeams: 12, budget: 300 }, {});

    expect(base.valuations.length).toBeGreaterThan(0);
    expect(changed.valuations.length).toBeGreaterThan(0);
    expect(changed.meta.targetTotalValue).toBe(3600);
    expect(base.meta.targetTotalValue).toBe(2600);

    const player = changed.valuations[0];
    const samePlayerInBase = base.valuations.find((v) => v.playerId === player.playerId);
    expect(samePlayerInBase).toBeTruthy();
    expect(player.projectedValue).not.toBe(samePlayerInBase.projectedValue);
  });

  test('integration-shape: Draft Kit body shape returns non-empty valuations', () => {
    const req = {
      body: {
        leagueSettings: {
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
        },
        draftState: {},
      },
    };
    const res = makeRes();

    getValuations(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.valuations)).toBe(true);
    expect(res.body.valuations.length).toBeGreaterThan(0);
  });

  test('US-5.5: purchased players carry purchasePrice and valueGap; available players are null', () => {
    const leagueSettings = {
      numberOfTeams: 2,
      salaryCap: 260,
      rosterSlots: { C: 1, '1B': 1, '2B': 1, '3B': 1, SS: 1, OF: 3, UTIL: 1, SP: 3, RP: 2, BENCH: 3 },
      scoringType: '5x5 Roto',
    };

    // First pass: find a real available player from the live pool the engine returns,
    // so we can post it back as "purchased" and assert the gap math.
    const baseline = runValuations(leagueSettings, {});
    expect(baseline.valuations.length).toBeGreaterThan(2);

    const purchasedAt = 47;
    const purchasedTarget = baseline.valuations.find((v) => Number(v.projectedValue) > 0);
    expect(purchasedTarget).toBeTruthy();

    const live = runValuations(leagueSettings, {
      purchasedPlayers: [
        { playerId: purchasedTarget.playerId, teamId: 'fantasy-team-1', price: purchasedAt },
      ],
      teamBudgets: { 'fantasy-team-1': 213, 'fantasy-team-2': 260 },
      filledRosterSlots: { 'fantasy-team-1': { OF: 1 } },
    });

    const purchasedRow = live.valuations.find((v) => v.playerId === purchasedTarget.playerId);
    expect(purchasedRow).toBeTruthy();
    expect(purchasedRow.purchasePrice).toBe(purchasedAt);
    expect(typeof purchasedRow.projectedValue).toBe('number');
    // valueGap is computed server-side as projectedValue - purchasePrice.
    expect(purchasedRow.valueGap).toBeCloseTo(purchasedRow.projectedValue - purchasedAt, 4);

    // An available (un-purchased) player must have null purchasePrice / valueGap.
    const availableRow = live.valuations.find((v) => v.playerId !== purchasedTarget.playerId);
    expect(availableRow).toBeTruthy();
    expect(availableRow.purchasePrice).toBeNull();
    expect(availableRow.valueGap).toBeNull();
  });

  test('adapter: normalizeLeagueSettings matches Draft Kit and legacy equivalent inputs', () => {
    const draftKitShape = {
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

    const legacyShape = {
      numTeams: 10,
      budget: 260,
      hitterSlotsPerTeam: 14,
      pitcherSlotsPerTeam: 10,
    };

    const normalizedDraftKit = normalizeLeagueSettings(draftKitShape);
    const normalizedLegacy = normalizeLeagueSettings(legacyShape);

    expect(normalizedDraftKit.numTeams).toBe(normalizedLegacy.numTeams);
    expect(normalizedDraftKit.budget).toBe(normalizedLegacy.budget);
    expect(normalizedDraftKit.hitterSlotsPerTeam).toBe(normalizedLegacy.hitterSlotsPerTeam);
    expect(normalizedDraftKit.pitcherSlotsPerTeam).toBe(normalizedLegacy.pitcherSlotsPerTeam);

    const mergedDraftKit = mergeSettings(normalizedDraftKit);
    const mergedLegacy = mergeSettings(normalizedLegacy);

    expect(mergedDraftKit.numTeams).toBe(mergedLegacy.numTeams);
    expect(mergedDraftKit.budget).toBe(mergedLegacy.budget);
    expect(mergedDraftKit.hitterSlotsPerTeam).toBe(mergedLegacy.hitterSlotsPerTeam);
    expect(mergedDraftKit.pitcherSlotsPerTeam).toBe(mergedLegacy.pitcherSlotsPerTeam);
  });
});
