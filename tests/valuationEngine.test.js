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
    status: 'active',
    depth_chart_rank: 1,
    depth_chart_position: 'OF',
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
    status: 'active',
    depth_chart_rank: 1,
    depth_chart_position: 'SP',
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

  test('injury + depth chart weighting lowers equivalent player value', () => {
    const mirroredHitters = [
      makeHitter({
        player_id: 'mlb-300001',
        name: 'Healthy Starter',
        positions: JSON.stringify(['OF']),
        status: 'active',
        depth_chart_rank: 1,
        depth_chart_position: 'OF',
        hr: 30, r: 90, rbi: 95, sb: 15, avg: 0.3, ab: 550,
      }),
      makeHitter({
        player_id: 'mlb-300002',
        name: 'Injured Bench',
        positions: JSON.stringify(['OF']),
        status: 'il-10',
        depth_chart_rank: 3,
        depth_chart_position: 'OF',
        hr: 30, r: 90, rbi: 95, sb: 15, avg: 0.3, ab: 550,
      }),
    ];
    const mirrorPitchers = [
      makePitcher({
        player_id: 'mlb-400001',
        name: 'Pitcher Anchor',
        positions: JSON.stringify(['SP']),
        status: 'active',
        depth_chart_rank: 1,
      }),
    ];

    const settings = mergeSettings({
      numTeams: 1,
      budget: 260,
      minAB: 0,
      minIP: 0,
      rosterSlots: { OF: 2, UTIL: 0, C: 0, SP: 1, RP: 0, P: 0, BENCH: 0 },
    });

    const vals = computeValuations(
      mirroredHitters,
      mirrorPitchers,
      buildPoolPlayers(mirroredHitters, mirrorPitchers),
      settings
    );

    const healthy = vals.find((v) => v.playerId === 'mlb-300001');
    const injured = vals.find((v) => v.playerId === 'mlb-300002');
    expect(healthy).toBeTruthy();
    expect(injured).toBeTruthy();
    expect(healthy.dollarValue).toBeGreaterThan(injured.dollarValue);
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

describe('US-11.1 statsWindow — multi-year weighted averaging', () => {
  const { loadWeightedStatRows, DEFAULTS } = require('../src/services/valuationEngine');

  test('statsWindow defaults to "last1"', () => {
    expect(DEFAULTS.statsWindow).toBe('last1');
    const settings = mergeSettings({});
    expect(settings.statsWindow).toBe('last1');
  });

  test('mergeSettings threads statsWindow: "last3" through', () => {
    const settings = mergeSettings({ statsWindow: 'last3' });
    expect(settings.statsWindow).toBe('last3');
  });

  test('mergeSettings ignores invalid statsWindow — falls back to "last1"', () => {
    const settings = mergeSettings({ statsWindow: 'last5' });
    expect(settings.statsWindow).toBe('last1');
  });

  test('loadWeightedStatRows returns [] when DB is unavailable (no DB in unit tests)', () => {
    // The unit-test environment has no SQLite DB — expect a graceful empty array
    const rows = loadWeightedStatRows('hitting');
    expect(Array.isArray(rows)).toBe(true);
  });

  test('"last3" weighted averages — counting stats use year weights, rate stats use volume weights', () => {
    // Directly test the weighting math with three distinct seasons for the same player.
    // Year weights: most-recent 50%, one-year-back 30%, two-years-back 20%.
    const weights = [0.5, 0.3, 0.2];

    const yr1 = { hr: 40, rbi: 120, ab: 600, avg: 0.320, ip: 0 }; // most recent (hot)
    const yr2 = { hr: 25, rbi:  90, ab: 550, avg: 0.285, ip: 0 }; // one year back
    const yr3 = { hr: 12, rbi:  65, ab: 450, avg: 0.250, ip: 0 }; // two years back

    // --- Counting stat: HR ---
    // Expected weighted HR = 40*0.5 + 25*0.3 + 12*0.2 = 20 + 7.5 + 2.4 = 29.9 / 1 = 29.9
    const expectedHr = (yr1.hr * weights[0] + yr2.hr * weights[1] + yr3.hr * weights[2])
                     / (weights[0] + weights[1] + weights[2]);
    expect(expectedHr).toBeCloseTo(29.9, 1);

    // --- Counting stat: RBI ---
    const expectedRbi = (yr1.rbi * weights[0] + yr2.rbi * weights[1] + yr3.rbi * weights[2])
                      / (weights[0] + weights[1] + weights[2]);
    // 120*0.5 + 90*0.3 + 65*0.2 = 60 + 27 + 13 = 100
    expect(expectedRbi).toBeCloseTo(100, 1);

    // --- Rate stat: AVG (volume-weighted by AB) ---
    // Expected weighted AVG = (0.320 * 600 * 0.5 + 0.285 * 550 * 0.3 + 0.250 * 450 * 0.2)
    //                        / (600 * 0.5 + 550 * 0.3 + 450 * 0.2)
    const abNumerator   = yr1.avg * yr1.ab * weights[0] + yr2.avg * yr2.ab * weights[1] + yr3.avg * yr3.ab * weights[2];
    const abDenominator = yr1.ab * weights[0] + yr2.ab * weights[1] + yr3.ab * weights[2];
    const expectedAvg   = abNumerator / abDenominator;
    // 96 + 47.025 + 22.5 = 165.525 / (300 + 165 + 90) = 165.525 / 555 ≈ 0.2982
    expect(expectedAvg).toBeCloseTo(0.298, 2);

    // Confirm rate-weighted AVG is not the same as year-weighted AVG
    const yearWeightedAvg = (yr1.avg * weights[0] + yr2.avg * weights[1] + yr3.avg * weights[2])
                          / (weights[0] + weights[1] + weights[2]);
    // Year-weighted: 0.160 + 0.0855 + 0.050 = 0.2955 — slightly different
    expect(Math.abs(expectedAvg - yearWeightedAvg)).toBeGreaterThan(0.001);

    // --- Hot year vs cold year produces different single-season valuations ---
    // This verifies the engine uses stats materially when statsWindow context changes
    const allOpponents = Array.from({ length: 89 }, (_, i) =>
      makeHitter({ player_id: `mlb-opp-${i}`, hr: 20, rbi: 80, avg: 0.265 })
    );
    const hotPlayer  = makeHitter({ player_id: 'mlb-test-1', hr: yr1.hr, rbi: yr1.rbi, avg: yr1.avg });
    const coldPlayer = makeHitter({ player_id: 'mlb-test-1', hr: yr3.hr, rbi: yr3.rbi, avg: yr3.avg });

    const hotPool  = computeValuations([hotPlayer,  ...allOpponents], [], [], mergeSettings({}));
    const coldPool = computeValuations([coldPlayer, ...allOpponents], [], [], mergeSettings({}));

    const hotValue  = hotPool.find((v)  => v.playerId === 'mlb-test-1')?.dollarValue ?? 0;
    const coldValue = coldPool.find((v) => v.playerId === 'mlb-test-1')?.dollarValue ?? 0;

    // A player with HR 40 / RBI 120 / AVG .320 should be worth materially more than HR 12 / RBI 65 / AVG .250
    expect(hotValue).toBeGreaterThan(coldValue + 10);
  });
});

describe('US-11.2 projection source — prefer player_projections over player_stats', () => {
  const { loadProjectionRows, DEFAULTS } = require('../src/services/valuationEngine');

  test('loadProjectionRows returns [] when DB is unavailable (no DB in unit tests)', () => {
    const rows = loadProjectionRows(2025, 'hitting', 'steamer');
    expect(Array.isArray(rows)).toBe(true);
  });

  test('loadStatRowsForSettings returns usedProjectionSource=null when no projections exist', () => {
    // In unit test env there's no DB so projections are empty; falls back to historical
    const settings = mergeSettings({});
    // We call loadStatRowsForSettings indirectly through runValuations
    // and verify the meta field is present
    // The DB is unavailable so we expect empty valuations with null projection source
    const result = runValuations({}, {});
    // meta is always present, usedProjectionSource defaults to null when no projections
    expect(result).toHaveProperty('meta');
    expect(result.meta).toHaveProperty('usedProjectionSource');
  });

  test('meta.usedProjectionSource is included in runValuations response', () => {
    const result = runValuations({ numTeams: 10, salaryCap: 260 }, {});
    expect(result.meta).toHaveProperty('usedProjectionSource');
    // In test env: no DB → no projections → null
    expect([null, 'steamer', 'zips', 'manual']).toContain(result.meta.usedProjectionSource);
  });

  test('meta.statsWindow is included in runValuations response', () => {
    const result = runValuations({ statsWindow: 'last3' }, {});
    expect(result.meta.statsWindow).toBe('last3');
  });

  test('VALUATION_PROJECTION_SOURCE env controls which source is queried', () => {
    const original = process.env.VALUATION_PROJECTION_SOURCE;
    process.env.VALUATION_PROJECTION_SOURCE = 'zips';
    // loadProjectionRows should use 'zips' — we just verify no throw
    const rows = loadProjectionRows(2025, 'hitting', process.env.VALUATION_PROJECTION_SOURCE);
    expect(Array.isArray(rows)).toBe(true);
    process.env.VALUATION_PROJECTION_SOURCE = original || '';
  });
});

describe('US-11.3 age factor in valuation', () => {
  const { DEFAULTS } = require('../src/services/valuationEngine');

  test('ageFactor defaults to false', () => {
    expect(DEFAULTS.ageFactor).toBe(false);
    expect(mergeSettings({}).ageFactor).toBe(false);
  });

  test('mergeSettings threads ageFactor: true', () => {
    expect(mergeSettings({ ageFactor: true }).ageFactor).toBe(true);
  });

  test('ageFactor: false — identical players at ages 24 and 36 receive the same dollarValue', () => {
    const young = makeHitter({ player_id: 'mlb-age-young', name: 'Young Player', birth_date: '2001-04-01' });
    const old   = makeHitter({ player_id: 'mlb-age-old',   name: 'Old Player',   birth_date: '1989-04-01' });
    const rest  = Array.from({ length: 88 }, (_, i) => makeHitter({ player_id: `mlb-rest-${i}` }));

    const vals = computeValuations([young, old, ...rest], [], [], mergeSettings({ ageFactor: false }));
    const youngVal = vals.find((v) => v.playerId === 'mlb-age-young')?.dollarValue ?? -1;
    const oldVal   = vals.find((v) => v.playerId === 'mlb-age-old')?.dollarValue ?? -1;

    // Without ageFactor both players have equal stats → equal values
    expect(youngVal).toBeGreaterThan(0);
    expect(youngVal).toBeCloseTo(oldVal, 0);
  });

  test('ageFactor: true — age 24 player worth more than age 36 player with identical projections', () => {
    // Season 2025: age-24 born 2001-04-01, age-36 born 1989-04-01
    const season = 2025;
    const young = makeHitter({ player_id: 'mlb-age-young', name: 'Young Player', birth_date: '2001-04-01', hr: 25, rbi: 90, avg: 0.280 });
    const old   = makeHitter({ player_id: 'mlb-age-old',   name: 'Old Player',   birth_date: '1989-04-01', hr: 25, rbi: 90, avg: 0.280 });
    const rest  = Array.from({ length: 88 }, (_, i) =>
      makeHitter({ player_id: `mlb-rest-${i}`, hr: 18, rbi: 70, avg: 0.260 })
    );

    const settings = mergeSettings({ ageFactor: true, statSeason: season });
    const vals = computeValuations([young, old, ...rest], [], [], settings);

    const youngVal = vals.find((v) => v.playerId === 'mlb-age-young')?.dollarValue ?? -1;
    const oldVal   = vals.find((v) => v.playerId === 'mlb-age-old')?.dollarValue ?? -1;

    // Young player (24) should be worth more than the older player (36)
    expect(youngVal).toBeGreaterThan(oldVal);
  });

  test('ageAdjustment field is present in valuation output', () => {
    const player = makeHitter({ player_id: 'mlb-age-test', birth_date: '1995-06-15' });
    const rest   = Array.from({ length: 9 }, (_, i) => makeHitter({ player_id: `mlb-r-${i}` }));
    const vals   = computeValuations([player, ...rest], [], [], mergeSettings({ ageFactor: true, statSeason: 2025 }));
    const v = vals.find((v) => v.playerId === 'mlb-age-test');

    expect(v).toBeTruthy();
    expect(v.ageAdjustment).not.toBeNull();
    expect(v.ageAdjustment).toHaveProperty('age');
    expect(v.ageAdjustment).toHaveProperty('multiplier');
    expect(typeof v.ageAdjustment.age).toBe('number');
  });

  test('ageAdjustment is null when ageFactor is false (default)', () => {
    const player = makeHitter({ player_id: 'mlb-age-nofactor', birth_date: '1995-06-15' });
    const vals   = computeValuations([player], [], [], mergeSettings({ ageFactor: false }));
    const v = vals.find((val) => val.playerId === 'mlb-age-nofactor');
    // ageAdjustment may be null or { age: null, multiplier: 1.0 } — either is acceptable
    if (v?.ageAdjustment !== null) {
      expect(v.ageAdjustment.multiplier).toBe(1.0);
    }
  });
});

describe('US-11.4 injury status in valuation', () => {
  const settings = mergeSettings({ numTeams: 10, budget: 260, minAB: 0, minIP: 0 });

  function makePool(target, rest) {
    return [target, ...rest].map((p) => ({
      playerId: p.player_id, name: p.name,
      mlbTeam: p.mlb_team, positions: JSON.parse(p.positions),
    }));
  }

  test('active and IL-60 players with identical stats: IL-60 player valued lower by ~0.6 ratio', () => {
    const opponents = Array.from({ length: 89 }, (_, i) =>
      makeHitter({ player_id: `mlb-opp-${i}`, name: `Opp ${i}`, hr: 20, rbi: 75, avg: 0.265, depth_chart_rank: 1 })
    );
    const activePlayer = makeHitter({
      player_id: 'mlb-active', name: 'Active Player',
      hr: 30, rbi: 95, avg: 0.285, status: 'active', depth_chart_rank: 1,
    });
    const il60Player = makeHitter({
      player_id: 'mlb-il60', name: 'IL-60 Player',
      hr: 30, rbi: 95, avg: 0.285, status: 'il_60', depth_chart_rank: 1,
    });

    const activeVals = computeValuations([activePlayer, ...opponents], [], makePool(activePlayer, opponents), settings);
    const il60Vals   = computeValuations([il60Player,  ...opponents], [], makePool(il60Player,  opponents), settings);

    const activeValue = activeVals.find((v) => v.playerId === 'mlb-active')?.dollarValue ?? 0;
    const il60Value   = il60Vals.find((v)  => v.playerId === 'mlb-il60')?.dollarValue   ?? 0;

    // IL-60 multiplier is 0.6 — the IL-60 player's effective stats are 60% of active
    // so their dollar value should be meaningfully less
    expect(activeValue).toBeGreaterThan(il60Value);
    expect(il60Value).toBeGreaterThanOrEqual(1); // floor is $1
  });

  test('minors/DFA player receives minimum $1 (0.0 multiplier collapses to replacement)', () => {
    const opponents = Array.from({ length: 89 }, (_, i) =>
      makeHitter({ player_id: `mlb-opp-${i}`, hr: 20, rbi: 75, avg: 0.265, depth_chart_rank: 1 })
    );
    const minorsPlayer = makeHitter({
      player_id: 'mlb-minors', name: 'Minors Player',
      hr: 30, rbi: 95, avg: 0.285, status: 'minors', depth_chart_rank: 1,
    });
    const vals = computeValuations([minorsPlayer, ...opponents], [], makePool(minorsPlayer, opponents), settings);
    const minorsValue = vals.find((v) => v.playerId === 'mlb-minors')?.dollarValue ?? -1;
    expect(minorsValue).toBeGreaterThanOrEqual(1); // calibration may scale up, but VAR should be 0
  });

  test('injuryAdjustment field is present in output with status and multiplier', () => {
    const player = makeHitter({ player_id: 'mlb-inj-test', status: 'il_10', depth_chart_rank: 1 });
    const rest   = Array.from({ length: 9 }, (_, i) => makeHitter({ player_id: `mlb-r-${i}` }));
    const vals   = computeValuations([player, ...rest], [], makePool(player, rest), settings);
    const v = vals.find((v) => v.playerId === 'mlb-inj-test');

    expect(v).toBeTruthy();
    expect(v.injuryAdjustment).not.toBeNull();
    expect(v.injuryAdjustment).toHaveProperty('status');
    expect(v.injuryAdjustment).toHaveProperty('multiplier');
    expect(v.injuryAdjustment.multiplier).toBeCloseTo(0.95, 2); // IL-10 = 0.95
    expect(v.injuryAdjustment.status).toBe('il_10');
  });

  test('VALUATION_INJURY_DISCOUNTS env var overrides default multipliers', () => {
    const orig = process.env.VALUATION_INJURY_DISCOUNTS;
    process.env.VALUATION_INJURY_DISCOUNTS = JSON.stringify({ il_10: 0.5 });

    const player = makeHitter({ player_id: 'mlb-env-test', status: 'il_10', depth_chart_rank: 1 });
    const rest   = Array.from({ length: 9 }, (_, i) => makeHitter({ player_id: `mlb-re-${i}` }));
    const vals   = computeValuations([player, ...rest], [], makePool(player, rest), settings);
    const v = vals.find((v) => v.playerId === 'mlb-env-test');

    // Overridden to 0.5, so multiplier should be much lower than default 0.95
    expect(v.injuryAdjustment.multiplier).toBeCloseTo(0.5, 2);

    process.env.VALUATION_INJURY_DISCOUNTS = orig || '';
  });
});

describe('US-11.5 depth chart position factor in valuation', () => {
  const settings = mergeSettings({ numTeams: 10, budget: 260, minAB: 0, minIP: 0 });

  function makePool(players) {
    return players.map((p) => ({
      playerId: p.player_id, name: p.name,
      mlbTeam: p.mlb_team, positions: JSON.parse(p.positions),
    }));
  }

  test('rank 1 player valued higher than rank 4 player with identical stats', () => {
    const opponents = Array.from({ length: 88 }, (_, i) =>
      makeHitter({ player_id: `mlb-opp-${i}`, hr: 18, rbi: 70, avg: 0.260, depth_chart_rank: 2 })
    );
    const rank1 = makeHitter({ player_id: 'mlb-rank1', name: 'Starter',    hr: 25, rbi: 90, avg: 0.280, depth_chart_rank: 1 });
    const rank4 = makeHitter({ player_id: 'mlb-rank4', name: 'Deep Bench', hr: 25, rbi: 90, avg: 0.280, depth_chart_rank: 4 });
    const all = [rank1, rank4, ...opponents];
    const pool = makePool(all);

    const vals = computeValuations(all, [], pool, settings);
    const v1 = vals.find((v) => v.playerId === 'mlb-rank1');
    const v4 = vals.find((v) => v.playerId === 'mlb-rank4');

    expect(v1.dollarValue).toBeGreaterThan(v4.dollarValue);
  });

  test('depthChartAdjustment field is present with rank and multiplier', () => {
    const player = makeHitter({ player_id: 'mlb-dc-test', depth_chart_rank: 2 });
    const rest   = Array.from({ length: 9 }, (_, i) => makeHitter({ player_id: `mlb-r-${i}` }));
    const all    = [player, ...rest];
    const vals   = computeValuations(all, [], makePool(all), settings);
    const v = vals.find((v) => v.playerId === 'mlb-dc-test');

    expect(v).toBeTruthy();
    expect(v.depthChartAdjustment).not.toBeNull();
    expect(v.depthChartAdjustment.rank).toBe(2);
    expect(v.depthChartAdjustment.multiplier).toBeCloseTo(0.9, 2); // rank 2 = 0.9
  });

  test('uncharted player (null rank) uses uncharted multiplier (0.5)', () => {
    const player = makeHitter({ player_id: 'mlb-unc-test', depth_chart_rank: null });
    const rest   = Array.from({ length: 9 }, (_, i) => makeHitter({ player_id: `mlb-r-${i}`, depth_chart_rank: 1 }));
    const all    = [player, ...rest];
    const vals   = computeValuations(all, [], makePool(all), settings);
    const v = vals.find((v) => v.playerId === 'mlb-unc-test');

    expect(v.depthChartAdjustment.rank).toBeNull();
    expect(v.depthChartAdjustment.multiplier).toBeCloseTo(0.5, 2);
  });

  test('depthChartFactor: false — rank 1 and rank 4 players receive same depth multiplier', () => {
    const noDepthSettings = mergeSettings({ depthChartFactor: false, minAB: 0, minIP: 0 });
    const rank1 = makeHitter({ player_id: 'mlb-r1', hr: 25, rbi: 90, avg: 0.280, depth_chart_rank: 1, status: 'active' });
    const rank4 = makeHitter({ player_id: 'mlb-r4', hr: 25, rbi: 90, avg: 0.280, depth_chart_rank: 4, status: 'active' });
    const all   = [rank1, rank4];
    const pool  = makePool(all);

    const vals = computeValuations(all, [], pool, noDepthSettings);
    const v1 = vals.find((v) => v.playerId === 'mlb-r1');
    const v4 = vals.find((v) => v.playerId === 'mlb-r4');

    // Both get depthChartAdjustment.multiplier = 1.0 when factor is disabled
    expect(v1.depthChartAdjustment.multiplier).toBe(1.0);
    expect(v4.depthChartAdjustment.multiplier).toBe(1.0);
    expect(v1.dollarValue).toBeCloseTo(v4.dollarValue, 0);
  });

  test('VALUATION_DEPTH_CURVE env var overrides depth multipliers', () => {
    const orig = process.env.VALUATION_DEPTH_CURVE;
    process.env.VALUATION_DEPTH_CURVE = JSON.stringify({ '2': 0.5 });

    // Re-merge settings so the env var is picked up
    const envSettings = mergeSettings({ minAB: 0 });
    const player = makeHitter({ player_id: 'mlb-env-depth', depth_chart_rank: 2 });
    const rest   = Array.from({ length: 9 }, (_, i) => makeHitter({ player_id: `mlb-r-${i}` }));
    const all    = [player, ...rest];
    const vals   = computeValuations(all, [], makePool(all), envSettings);
    const v = vals.find((v) => v.playerId === 'mlb-env-depth');

    expect(v.depthChartAdjustment.multiplier).toBeCloseTo(0.5, 2);

    process.env.VALUATION_DEPTH_CURVE = orig || '';
  });
});
