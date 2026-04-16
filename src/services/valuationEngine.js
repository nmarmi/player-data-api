/**
 * Fantasy baseball auction dollar-value model — US-5.1 (baseline).
 *
 * Algorithm: z-score above replacement (SGP-style)
 * ─────────────────────────────────────────────────
 * 1. Load qualifying players + prior-season stats from player_stats.
 * 2. For each scoring category, compute a z-score across the pool.
 *    - Counting stats (HR, R, RBI, SB, W, K, SV): raw z-score.
 *    - Rate stats (AVG, ERA, WHIP): volume-weighted before z-scoring.
 *      z_avg(p)  = (p.avg  - poolMean_avg)  * p.ab / std(contributions)
 *      z_era(p)  = -(p.era  - poolMean_era)  * p.ip / std(contributions)
 *      z_whip(p) = -(p.whip - poolMean_whip) * p.ip / std(contributions)
 *    This prevents a player with 10 AB and .400 AVG from outranking
 *    a full-season .310 hitter.
 * 3. Sum all category z-scores per player into a total z-score.
 *    ERA/WHIP are negated (lower is better).
 * 4. Sort by total z-score descending. The player at rank N+1 — where N
 *    equals the total roster slots to be filled — defines replacement level.
 * 5. Value above replacement (VAR) = player z_total − replacement z_total.
 * 6. Players with VAR > 0 share the allocated salary pool proportionally:
 *      dollarValue = $1 + round((VAR / sumAllPositiveVAR) × freeSalaryPool)
 *    Everyone else receives $1 (minimum bid).
 *    freeSalaryPool = totalSalary − (poolSize × $1)
 *
 * This is the project's own model (required by Activity 7 / US-5.1).
 */

'use strict';

let _getDb = null;
function tryGetDb() {
  if (!_getDb) {
    try { _getDb = require('../db/connection').getDb; } catch (_) {}
  }
  try { return _getDb ? _getDb() : null; } catch (_) { return null; }
}

// ── Default league settings ───────────────────────────────────────────────────

const DEFAULTS = {
  numTeams:       10,
  budget:         260,
  // Salary split: hitters receive 67.5 %, pitchers 32.5 %
  hitterBudgetPct: 0.675,
  // Roster slots per team (US-5.2 / US-5.3 may override these)
  hitterSlotsPerTeam:  9,   // C, 1B, 2B, 3B, SS, OF×3, UTIL
  pitcherSlotsPerTeam: 5,   // SP×2, RP×2, P (flex)
  // Minimum qualification thresholds
  minAB: 100,
  minIP:  40,
  // Season to use for stats (defaults to last calendar year)
  statSeason: null,
  // Scoring categories
  hittingCategories:  ['hr', 'r', 'rbi', 'sb', 'avg'],
  pitchingCategories: ['w', 'k', 'sv', 'era', 'whip'],
  // Categories where LOWER is better — z-scores are negated
  negativeCategories: new Set(['era', 'whip']),
  // Rate stats that must be volume-weighted before z-scoring
  rateStats: new Set(['avg', 'era', 'whip']),
  // Which volume field to use when weighting a rate stat
  rateStatVolume: { avg: 'ab', era: 'ip', whip: 'ip' },
};

// ── Math helpers ──────────────────────────────────────────────────────────────

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/** Population standard deviation — returns 1 if fewer than 2 values to avoid ÷0. */
function std(arr) {
  if (arr.length < 2) return 1;
  const m = mean(arr);
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length;
  return Math.sqrt(variance) || 1;
}

// ── DB loader ─────────────────────────────────────────────────────────────────

/**
 * Loads rows from player_stats joined to players for a given season + group.
 * Returns [] if the DB is unavailable or no rows exist.
 *
 * @param {number} season
 * @param {'hitting'|'pitching'} group
 * @returns {Array<object>}
 */
function loadStatRows(season, group) {
  const db = tryGetDb();
  if (!db) return [];
  try {
    return db.prepare(`
      SELECT
        p.player_id, p.name, p.positions, p.mlb_team, p.status, p.is_available,
        ps.games_played, ps.ab, ps.r,  ps.h,  ps.hr, ps.rbi, ps.bb,
        ps.k,  ps.sb, ps.avg, ps.obp, ps.slg, ps.ops,
        ps.w,  ps.l,  ps.era, ps.whip, ps.k9, ps.ip, ps.sv, ps.hld
      FROM players p
      JOIN player_stats ps ON p.player_id = ps.player_id
      WHERE ps.season = ? AND ps.stat_group = ?
    `).all(season, group);
  } catch (_) { return []; }
}

// ── Core computation ──────────────────────────────────────────────────────────

/**
 * Computes per-category z-scores for a pool of players.
 *
 * For rate stats the "contribution" compared is:
 *   (playerRate − poolMean) × volume
 * i.e. a player's marginal contribution in raw units (extra hits, saved runs…).
 *
 * Returns an array of { ...player, zScores: {cat: z, …}, zTotal: number }
 *
 * @param {Array}    pool       - player stat rows
 * @param {string[]} categories - category names matching row fields
 * @param {object}   settings   - merged league settings
 */
function computeZScores(pool, categories, settings) {
  const { negativeCategories, rateStats, rateStatVolume } = settings;

  // Pre-compute pool means for each category
  const poolMeans = {};
  for (const cat of categories) {
    poolMeans[cat] = mean(pool.map((p) => p[cat] ?? 0));
  }

  // Pre-compute std of contributions (volume-weighted for rate stats)
  const poolStds = {};
  for (const cat of categories) {
    let contributions;
    if (rateStats.has(cat)) {
      const volField = rateStatVolume[cat];
      contributions = pool.map((p) => ((p[cat] ?? 0) - poolMeans[cat]) * (p[volField] ?? 0));
    } else {
      contributions = pool.map((p) => (p[cat] ?? 0));
    }
    poolStds[cat] = std(contributions);
  }

  return pool.map((player) => {
    const zScores = {};
    let zTotal = 0;

    for (const cat of categories) {
      let z;
      if (rateStats.has(cat)) {
        const volField = rateStatVolume[cat];
        const contribution = ((player[cat] ?? 0) - poolMeans[cat]) * (player[volField] ?? 0);
        z = contribution / poolStds[cat];
      } else {
        z = ((player[cat] ?? 0) - poolMeans[cat]) / poolStds[cat];
      }

      // Negate ERA/WHIP — lower is better in fantasy
      if (negativeCategories.has(cat)) z = -z;

      zScores[cat] = z;
      zTotal += z;
    }

    return { ...player, zScores, zTotal };
  });
}

/**
 * Assigns dollar values to a scored player pool.
 *
 * @param {Array}  scoredPool      - output of computeZScores
 * @param {number} replacementRank - the 1-based rank of the replacement player
 * @param {number} totalSalary     - total dollars available for this group
 * @returns {Array<{playerId, name, dollarValue, projectedValue, rank, zScore, zScores, statGroup}>}
 */
function assignDollarValues(scoredPool, replacementRank, totalSalary, statGroup) {
  // Sort descending by z-score total
  const sorted = [...scoredPool].sort((a, b) => b.zTotal - a.zTotal);

  // Replacement level z-score
  const replacementIdx = Math.min(replacementRank, sorted.length) - 1;
  const replacementZ   = sorted[replacementIdx]?.zTotal ?? 0;

  // VAR for every player
  const withVAR = sorted.map((p, i) => ({
    ...p,
    rank: i + 1,
    var:  p.zTotal - replacementZ,
  }));

  const positiveVAR   = withVAR.filter((p) => p.var > 0);
  const sumPositive   = positiveVAR.reduce((s, p) => s + p.var, 0);
  // Every player gets $1 minimum; remaining pool is distributed by VAR share
  const freeSalary    = Math.max(0, totalSalary - withVAR.length);

  return withVAR.map((p) => {
    let dollarValue;
    if (p.var > 0 && sumPositive > 0) {
      dollarValue = Math.max(1, Math.round(1 + (p.var / sumPositive) * freeSalary));
    } else {
      dollarValue = 1;
    }

    return {
      playerId:       p.player_id,
      name:           p.name,
      mlbTeam:        p.mlb_team,
      positions:      safeParsePositions(p.positions),
      dollarValue,
      projectedValue: dollarValue,  // pre-draft: projected = dollar value
      rank:           p.rank,
      zScore:         Math.round(p.zTotal * 1000) / 1000,
      zScores:        roundZScores(p.zScores),
      statGroup,
    };
  });
}

function safeParsePositions(raw) {
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw || '[]'); } catch (_) { return []; }
}

function roundZScores(zs) {
  if (!zs) return {};
  const out = {};
  for (const [k, v] of Object.entries(zs)) {
    out[k] = Math.round(v * 1000) / 1000;
  }
  return out;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Merges caller-supplied league settings with defaults.
 * Numeric string values are coerced to numbers.
 */
function mergeSettings(leagueSettings = {}) {
  return {
    ...DEFAULTS,
    numTeams:            Number(leagueSettings.numTeams)            || DEFAULTS.numTeams,
    budget:              Number(leagueSettings.budget)              || DEFAULTS.budget,
    hitterBudgetPct:     Number(leagueSettings.hitterBudgetPct)     || DEFAULTS.hitterBudgetPct,
    hitterSlotsPerTeam:  Number(leagueSettings.hitterSlotsPerTeam)  || DEFAULTS.hitterSlotsPerTeam,
    pitcherSlotsPerTeam: Number(leagueSettings.pitcherSlotsPerTeam) || DEFAULTS.pitcherSlotsPerTeam,
    minAB:               Number(leagueSettings.minAB)               || DEFAULTS.minAB,
    minIP:               Number(leagueSettings.minIP)               || DEFAULTS.minIP,
    statSeason:          Number(leagueSettings.statSeason)          || null,
    hittingCategories:   leagueSettings.hittingCategories  || DEFAULTS.hittingCategories,
    pitchingCategories:  leagueSettings.pitchingCategories || DEFAULTS.pitchingCategories,
    // Keep Set types — don't allow override for now (US-5.3 can extend)
    negativeCategories:  DEFAULTS.negativeCategories,
    rateStats:           DEFAULTS.rateStats,
    rateStatVolume:      DEFAULTS.rateStatVolume,
  };
}

/**
 * Pure computation: given pre-loaded arrays of hitter rows and pitcher rows,
 * compute dollar values for all players using the provided settings.
 *
 * @param {Array}  hitterRows   - rows from player_stats (stat_group='hitting')
 * @param {Array}  pitcherRows  - rows from player_stats (stat_group='pitching')
 * @param {object} settings     - merged league settings (from mergeSettings)
 * @returns {Array}             - combined sorted valuations
 */
function computeValuations(hitterRows, pitcherRows, settings) {
  const {
    numTeams, budget, hitterBudgetPct,
    hitterSlotsPerTeam, pitcherSlotsPerTeam,
    minAB, minIP,
    hittingCategories, pitchingCategories,
  } = settings;

  const totalSalary   = numTeams * budget;
  const hitterSalary  = Math.round(totalSalary * hitterBudgetPct);
  const pitcherSalary = totalSalary - hitterSalary;

  const hitterSlots  = numTeams * hitterSlotsPerTeam;
  const pitcherSlots = numTeams * pitcherSlotsPerTeam;

  // Apply qualification thresholds
  const hitters  = hitterRows.filter((p)  => (p.ab  ?? 0) >= minAB);
  const pitchers = pitcherRows.filter((p) => (p.ip  ?? 0) >= minIP);

  // Compute z-scores
  const scoredHitters  = computeZScores(hitters,  hittingCategories,  settings);
  const scoredPitchers = computeZScores(pitchers, pitchingCategories, settings);

  // Assign dollar values relative to replacement level
  const hitterVals  = assignDollarValues(scoredHitters,  hitterSlots,  hitterSalary,  'hitting');
  const pitcherVals = assignDollarValues(scoredPitchers, pitcherSlots, pitcherSalary, 'pitching');

  // Merge and re-rank by dollar value descending
  return [...hitterVals, ...pitcherVals].sort((a, b) => b.dollarValue - a.dollarValue);
}

/**
 * Full orchestration: load stats from DB then run the valuation model.
 *
 * @param {object} leagueSettings - league configuration (see DEFAULTS)
 * @param {object} draftState     - { availablePlayerIds? }
 * @returns {{ valuations: Array, meta: object }}
 */
function runValuations(leagueSettings = {}, draftState = {}) {
  const settings = mergeSettings(leagueSettings);
  const season   = settings.statSeason || (new Date().getFullYear() - 1);

  const allHitters  = loadStatRows(season, 'hitting');
  const allPitchers = loadStatRows(season, 'pitching');

  if (!allHitters.length && !allPitchers.length) {
    return { valuations: [], meta: { season, note: 'No player stats found — run import-stats first' } };
  }

  // Optionally filter to only the players still available in the draft
  let hitters  = allHitters;
  let pitchers = allPitchers;
  if (Array.isArray(draftState.availablePlayerIds) && draftState.availablePlayerIds.length) {
    const avail = new Set(draftState.availablePlayerIds);
    hitters  = hitters.filter((p)  => avail.has(p.player_id));
    pitchers = pitchers.filter((p) => avail.has(p.player_id));
  }

  const valuations = computeValuations(hitters, pitchers, settings);

  const hitterCount  = valuations.filter((v) => v.statGroup === 'hitting').length;
  const pitcherCount = valuations.filter((v) => v.statGroup === 'pitching').length;
  const totalValue   = valuations.reduce((s, v) => s + v.dollarValue, 0);

  const meta = {
    season,
    numTeams:       settings.numTeams,
    budget:         settings.budget,
    hitterSlots:    settings.numTeams * settings.hitterSlotsPerTeam,
    pitcherSlots:   settings.numTeams * settings.pitcherSlotsPerTeam,
    hitterCount,
    pitcherCount,
    totalValue,
    targetTotalValue: settings.numTeams * settings.budget,
  };

  return { valuations, meta };
}

module.exports = { runValuations, computeValuations, mergeSettings, loadStatRows, DEFAULTS };
