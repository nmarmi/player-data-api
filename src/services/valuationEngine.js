/**
 *
 * Algorithm: z-score above replacement
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
 */

'use strict';

const log = require('../logger').child({ component: 'valuations' });

// Lazily load the DB connection so the file doesn't crash if SQLite is unavailable
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
  // Hitters get 67.5% of the total salary pool, pitchers get the remaining 32.5%
  hitterBudgetPct: 0.675,
  // Roster slots per team (US-5.2 / US-5.3 may override these)
  hitterSlotsPerTeam:  9,   // C, 1B, 2B, 3B, SS, OF×3, UTIL
  pitcherSlotsPerTeam: 5,   // SP×2, RP×2, P (flex)
  // Players below these thresholds are excluded — too few games to be meaningful
  minAB: 100,
  minIP:  40,
  // Season to use for stats (defaults to last calendar year)
  statSeason: null,
  // US-11.1: 'last1' = use only the most recent season (default); 'last3' = weighted 3-year average
  statsWindow: 'last1',
  // US-11.3: age factor — disabled by default (single-year leagues); set to true for dynasty
  ageFactor: false,
  // Default age multiplier curve anchors. Ages between anchor points are linearly interpolated.
  // Ages below the minimum anchor use the minimum anchor's value; above maximum use that value.
  ageCurve: { 22: 1.05, 24: 1.0, 28: 1.0, 30: 0.94, 32: 0.90, 35: 0.85 },
  // Scoring categories
  hittingCategories:  ['hr', 'r', 'rbi', 'sb', 'avg'],
  pitchingCategories: ['w', 'k', 'sv', 'era', 'whip'],
  // Categories where LOWER is better — z-scores are negated
  negativeCategories: new Set(['era', 'whip']),
  // Rate stats that must be volume-weighted before z-scoring
  rateStats: new Set(['avg', 'era', 'whip']),
  // Which volume field to use when weighting a rate stat
  rateStatVolume: { avg: 'ab', era: 'ip', whip: 'ip' },
  // Reliability regression settings (higher K => stronger pull to league average)
  reliability: {
    hittingK: { hr: 200, r: 180, rbi: 200, sb: 300, avg: 500 },
    pitchingK: { w: 90, k: 70, sv: 70, era: 120, whip: 120 },
    rookieVolumeFallbackPct: 0.6,
  },
  // Availability/role adjustment settings (US rubric: injury + depth chart used).
  availability: {
    // US-11.4: multipliers per injury status. Override via VALUATION_INJURY_DISCOUNTS env var (JSON).
    // minors / dfa are 0.0 — player is not on the active roster; they contribute nothing this season.
    injuryMultipliers: {
      active:      1.0,
      dtd:         0.97,
      day_to_day:  0.97,
      probable:    0.99,
      questionable: 0.9,
      il_7:        0.95,
      il_10:       0.95,
      il_15:       0.93,
      il_60:       0.6,
      out:         0.6,
      suspended:   0.75,
      bereavement: 0.9,
      restricted:  0.75,
      minors:      0.0,
      dfa:         0.0,
    },
    // US-11.5: multipliers per depth-chart rank. Override via VALUATION_DEPTH_CURVE env var (JSON).
    // null (uncharted) = 0.5 — player may be a starter not yet on a depth chart.
    // 4+ (deep bench)  = 0.4 — confirmed low on the depth chart.
    depthRankMultipliers: {
      '1': 1.0,
      '2': 0.9,
      '3': 0.7,
      '4+': 0.4,
      uncharted: 0.5,
    },
  },
  // US-11.5: opt-out of depth-chart factor per league (true = apply, false = skip)
  depthChartFactor: true,
};

const HITTER_POSITION_KEYS = new Set(['C', '1B', '2B', '3B', 'SS', 'OF', 'UTIL', 'DH']);
const PITCHER_POSITION_KEYS = new Set(['SP', 'RP', 'P']);
const DEFAULT_POSITION_SLOT_MAP = {
  C: 1,
  '1B': 1,
  '2B': 1,
  '3B': 1,
  SS: 1,
  OF: 3,
  UTIL: 1,
  SP: 2,
  RP: 2,
  P: 1,
  BENCH: 0,
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

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function reliabilityFactor(sample, k) {
  const s = Math.max(0, Number(sample) || 0);
  const kk = Math.max(1, Number(k) || 1);
  return s / (s + kk);
}

function safeDiv(n, d) {
  const denom = Number(d) || 0;
  if (!denom) return 0;
  return (Number(n) || 0) / denom;
}

function normalizeStatusKey(status) {
  return String(status || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');
}

/**
 * US-11.4: Reads the injury multiplier map — DEFAULTS merged with the
 * VALUATION_INJURY_DISCOUNTS env var (JSON object) and any per-request override.
 */
function resolveInjuryMap(settings) {
  const base = { ...DEFAULTS.availability.injuryMultipliers, ...(settings?.availability?.injuryMultipliers || {}) };
  const env = process.env.VALUATION_INJURY_DISCOUNTS;
  if (env) {
    try { return { ...base, ...JSON.parse(env) }; } catch (_) {}
  }
  return base;
}

/**
 * US-11.4: Returns { multiplier, statusKey } for the player's current injury status.
 * multiplier is 0.0 for minors/DFA (player not on active roster this season).
 * @returns {{ multiplier: number, statusKey: string }}
 */
function injuryMultiplierForStatus(status, settings) {
  const map = resolveInjuryMap(settings);
  const normalized = normalizeStatusKey(status);
  const rawStatus = String(status || '').toLowerCase().trim();

  if (!normalized || normalized === 'active') return { multiplier: 1.0, statusKey: 'active' };

  if (Object.prototype.hasOwnProperty.call(map, normalized)) {
    return { multiplier: Number(map[normalized]), statusKey: normalized };
  }

  // Handle common IL status strings from the ingest layer
  if (normalized.includes('il_60') || normalized.includes('60_day') || rawStatus.includes('60-day')) {
    return { multiplier: Number(map.il_60) ?? 0.6, statusKey: 'il_60' };
  }
  if (normalized.includes('il_15') || normalized.includes('15_day') || rawStatus.includes('15-day')) {
    return { multiplier: Number(map.il_15) ?? 0.93, statusKey: 'il_15' };
  }
  if (normalized.includes('il_10') || normalized.includes('10_day') || rawStatus.includes('10-day')) {
    return { multiplier: Number(map.il_10) ?? 0.95, statusKey: 'il_10' };
  }
  if (normalized.includes('il_7') || normalized.includes('7_day') || rawStatus.includes('7-day')) {
    return { multiplier: Number(map.il_7) ?? 0.95, statusKey: 'il_7' };
  }
  if (normalized.includes('dtd') || normalized.includes('day_to_day')) {
    return { multiplier: Number(map.dtd) ?? 0.97, statusKey: 'dtd' };
  }
  if (normalized.includes('minors') || normalized === 'min') {
    return { multiplier: Number(map.minors) ?? 0.0, statusKey: 'minors' };
  }
  if (normalized.includes('dfa')) {
    return { multiplier: Number(map.dfa) ?? 0.0, statusKey: 'dfa' };
  }
  if (normalized.includes('out')) {
    return { multiplier: Number(map.out) ?? 0.6, statusKey: 'out' };
  }

  return { multiplier: 1.0, statusKey: normalized };
}

/**
 * US-11.5: Returns { multiplier, depthChartAdjustment } for the player's depth-chart rank.
 * Respects leagueSettings.depthChartFactor (default true).
 * Configurable via VALUATION_DEPTH_CURVE env var (merged into settings by mergeSettings).
 * @returns {{ multiplier: number, depthChartAdjustment: { rank: number|null, multiplier: number } }}
 */
function depthChartMultiplier(row, statGroup, settings) {
  // Opt-out: if league disables depth-chart factor return 1.0 with no adjustment
  if (settings?.depthChartFactor === false) {
    return { multiplier: 1.0, depthChartAdjustment: { rank: null, multiplier: 1.0 } };
  }

  const cfg  = settings?.availability?.depthRankMultipliers || DEFAULTS.availability.depthRankMultipliers;
  const rawRank = row.depth_chart_rank ?? row.depthChartRank ?? null;
  const rank = rawRank !== null && rawRank !== undefined ? Number(rawRank) : null;
  const role = String(row.depth_chart_position || row.depthChartPosition || '').toUpperCase();

  let multiplier;
  if (rank === null || rank === 0) {
    // Uncharted player — may be a starter not yet on depth chart
    multiplier = Number(cfg.uncharted ?? cfg.defaultBench ?? 0.5);
  } else if (rank === 1) {
    // Small role-aware boost for locked high-leverage roles
    if (statGroup === 'pitching' && (role.includes('CL') || role.includes('RP'))) {
      multiplier = Math.min(1.1, (Number(cfg['1']) || 1.0) + 0.03);
    } else {
      multiplier = Number(cfg['1']) || 1.0;
    }
  } else if (rank === 2) {
    multiplier = Number(cfg['2']) || 0.9;
  } else if (rank === 3) {
    multiplier = Number(cfg['3']) || 0.7;
  } else {
    // rank 4 and beyond — deep bench
    multiplier = Number(cfg['4+'] ?? cfg.defaultBench ?? 0.4);
  }

  return { multiplier, depthChartAdjustment: { rank, multiplier } };
}

/**
 * US-11.4: Returns combined availability multiplier and the injury breakdown.
 * minors/DFA are 0.0 — they bypass the depth-chart calc and the floor clamp.
 * @returns {{ multiplier: number, injuryAdjustment: { status: string, multiplier: number } }}
 */
/**
 * Returns combined availability multiplier plus both adjustment breakdowns for the response.
 * @returns {{ multiplier: number, injuryAdjustment: object, depthChartAdjustment: object }}
 */
function availabilityMultiplier(row, statGroup, settings) {
  const { multiplier: injuryMult, statusKey } = injuryMultiplierForStatus(row.status, settings);
  const injuryAdjustment = { status: statusKey, multiplier: injuryMult };

  // Players in the minors / DFA / released don't contribute this season — return 0 directly
  if (injuryMult <= 0) {
    return { multiplier: 0.0, injuryAdjustment, depthChartAdjustment: null };
  }

  const { multiplier: depthMult, depthChartAdjustment } = depthChartMultiplier(row, statGroup, settings);
  const combined = Math.max(0.25, Math.min(1.1, injuryMult * depthMult));
  return { multiplier: combined, injuryAdjustment, depthChartAdjustment };
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
  // STEP 1: Try to load stats from SQLite first
  const db = tryGetDb();
  if (db) {
    try {
      const rows = db.prepare(`
        SELECT
          p.player_id, p.name, p.positions, p.mlb_team, p.status, p.is_available,
          p.depth_chart_rank, p.depth_chart_position, p.birth_date,
          ps.games_played, ps.ab, ps.r,  ps.h,  ps.hr, ps.rbi, ps.bb,
          ps.k,  ps.sb, ps.avg, ps.obp, ps.slg, ps.ops,
          ps.w,  ps.l,  ps.era, ps.whip, ps.k9, ps.ip, ps.sv, ps.hld
        FROM players p
        JOIN player_stats ps ON p.player_id = ps.player_id
        WHERE ps.season = ? AND ps.stat_group = ?
      `).all(season, group);
      if (rows.length) return rows;
    } catch (_) {}
  }
  return [];
}

/**
 * Resolves the canonical "stat season" for valuation: explicit override or
 * last-completed calendar year.  Centralised so all call-sites agree.
 * @param {object} settings — merged league settings
 * @returns {number}
 */
function getStatSeason(settings) {
  return Number(settings?.statSeason) || (new Date().getFullYear() - 1);
}

/**
 * US-11.3: Parses the age multiplier curve from leagueSettings or the
 * VALUATION_AGE_CURVE env var.  Falls back to DEFAULTS.ageCurve.
 * @param {object|undefined} inputCurve
 * @returns {object} — { [age: string]: multiplier }
 */
function parseAgeCurve(inputCurve) {
  if (inputCurve && typeof inputCurve === 'object' && !Array.isArray(inputCurve)) {
    return inputCurve;
  }
  const envCurve = process.env.VALUATION_AGE_CURVE;
  if (envCurve) {
    try { return JSON.parse(envCurve); } catch (_) {}
  }
  return DEFAULTS.ageCurve;
}

/**
 * US-11.3: Compute the age multiplier for a player given their birth date and
 * the valuation season.  Age is measured at April 1 of the season (MLB opening day proxy).
 *
 * Uses linear interpolation between anchor points in the curve.
 *
 * @param {string|null} birthDate  — "YYYY-MM-DD"
 * @param {number}      season     — e.g. 2025
 * @param {object}      curve      — merged age curve from settings
 * @returns {{ age: number|null, multiplier: number }}
 */
function computeAgeMultiplier(birthDate, season, curve) {
  if (!birthDate) return { age: null, multiplier: 1.0 };

  const birth   = new Date(birthDate + 'T00:00:00Z');
  const refDate = new Date(`${season}-04-01T00:00:00Z`);
  if (isNaN(birth.getTime())) return { age: null, multiplier: 1.0 };

  // Age in whole years at April 1 of the season
  let age = refDate.getUTCFullYear() - birth.getUTCFullYear();
  const notYetBirthday =
    refDate.getUTCMonth() < birth.getUTCMonth() ||
    (refDate.getUTCMonth() === birth.getUTCMonth() && refDate.getUTCDate() < birth.getUTCDate());
  if (notYetBirthday) age--;

  // Build sorted anchor list from the curve object
  const anchors = Object.entries(curve)
    .map(([a, m]) => [Number(a), Number(m)])
    .sort((a, b) => a[0] - b[0]);

  if (!anchors.length) return { age, multiplier: 1.0 };

  // Clamp to curve range
  if (age <= anchors[0][0]) return { age, multiplier: anchors[0][1] };
  if (age >= anchors[anchors.length - 1][0]) return { age, multiplier: anchors[anchors.length - 1][1] };

  // Linear interpolation between the two surrounding anchors
  for (let i = 0; i < anchors.length - 1; i++) {
    const [a0, m0] = anchors[i];
    const [a1, m1] = anchors[i + 1];
    if (age >= a0 && age <= a1) {
      const t = (age - a0) / (a1 - a0);
      return { age, multiplier: m0 + t * (m1 - m0) };
    }
  }
  return { age, multiplier: 1.0 };
}

/**
 * US-11.1: Loads player stat rows weighted across the N most recent completed seasons.
 *
 * Weights (most-recent → oldest): [0.50, 0.30, 0.20] by default.
 *
 * Counting stats (HR, R, RBI, …) — straight weighted average of season totals.
 * Rate   stats  (AVG, OBP, SLG, ERA, WHIP, K9) — volume-weighted average so
 *   a player with 600 AB in year 1 and 10 AB in year 2 isn't distorted by
 *   the small-sample rate.
 *
 * Returns the same shape as loadStatRows() so callers are interchangeable.
 *
 * @param {'hitting'|'pitching'} group
 * @param {number[]} [weights=[0.5, 0.3, 0.2]]
 * @returns {Array<object>}
 */
function loadWeightedStatRows(group, weights = [0.5, 0.3, 0.2]) {
  const db = tryGetDb();
  if (!db) return [];
  try {
    // Find the N most recent seasons that actually have data for this group
    const seasonRows = db.prepare(
      `SELECT DISTINCT season FROM player_stats WHERE stat_group = ? ORDER BY season DESC LIMIT ?`
    ).all(group, weights.length);
    if (!seasonRows.length) return [];
    const seasons = seasonRows.map((r) => r.season);

    // Load all rows for those seasons in one query
    const placeholders = seasons.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT
        p.player_id, p.name, p.positions, p.mlb_team, p.status, p.is_available,
        p.depth_chart_rank, p.depth_chart_position, p.birth_date,
        ps.season, ps.games_played, ps.ab, ps.r, ps.h, ps.hr, ps.rbi, ps.bb,
        ps.k, ps.sb, ps.avg, ps.obp, ps.slg, ps.ops,
        ps.w, ps.l, ps.era, ps.whip, ps.k9, ps.ip, ps.sv, ps.hld
      FROM players p
      JOIN player_stats ps ON p.player_id = ps.player_id
      WHERE ps.stat_group = ? AND ps.season IN (${placeholders})
    `).all(group, ...seasons);

    if (!rows.length) return [];

    // Group rows by player, sorted newest season first
    const byPlayer = new Map();
    for (const row of rows) {
      if (!byPlayer.has(row.player_id)) byPlayer.set(row.player_id, []);
      byPlayer.get(row.player_id).push(row);
    }

    const COUNTING = ['games_played', 'ab', 'r', 'h', 'hr', 'rbi', 'bb', 'k', 'sb', 'w', 'l', 'ip', 'sv', 'hld'];
    const RATE     = ['avg', 'obp', 'slg', 'ops', 'era', 'whip', 'k9'];
    const RATE_VOL = { avg: 'ab', obp: 'ab', slg: 'ab', ops: 'ab', era: 'ip', whip: 'ip', k9: 'ip' };

    const result = [];
    for (const [, playerRows] of byPlayer) {
      // Newest season first
      playerRows.sort((a, b) => b.season - a.season);

      // Start from the most-recent row for all non-stat metadata fields
      const merged = { ...playerRows[0] };
      delete merged.season;

      // Weighted counting stats
      for (const stat of COUNTING) {
        let sum = 0, totalW = 0;
        for (let i = 0; i < playerRows.length; i++) {
          const w = weights[i] || 0;
          if (w > 0) { sum += (playerRows[i][stat] || 0) * w; totalW += w; }
        }
        merged[stat] = totalW > 0 ? sum / totalW : 0;
      }

      // Volume-weighted rate stats
      for (const stat of RATE) {
        const volField = RATE_VOL[stat];
        let num = 0, den = 0;
        for (let i = 0; i < playerRows.length; i++) {
          const w   = weights[i] || 0;
          const vol = (playerRows[i][volField] || 0) * w;
          if (w > 0 && vol > 0) {
            num += (playerRows[i][stat] || 0) * vol;
            den += vol;
          }
        }
        merged[stat] = den > 0 ? num / den : 0;
      }

      result.push(merged);
    }
    return result;
  } catch (_) {
    return [];
  }
}

/**
 * US-11.2: Load player_projections rows for a given season + group + source.
 * Returns [] when the DB is unavailable or no projection rows exist.
 *
 * @param {number} season
 * @param {'hitting'|'pitching'} group
 * @param {string} source  — 'steamer' | 'zips' | 'manual' (from VALUATION_PROJECTION_SOURCE)
 * @returns {Array<object>}
 */
function loadProjectionRows(season, group, source) {
  const db = tryGetDb();
  if (!db) return [];
  try {
    // player_projections has the same columns as player_stats but also `source`
    const rows = db.prepare(`
      SELECT
        p.player_id, p.name, p.positions, p.mlb_team, p.status, p.is_available,
        p.depth_chart_rank, p.depth_chart_position, p.birth_date,
        pr.games_played, pr.ab, pr.r,  pr.h,  pr.hr, pr.rbi, pr.bb,
        pr.k, pr.sb, pr.avg, pr.obp, pr.slg, pr.ops,
        pr.w, pr.l, pr.era, pr.whip, pr.k9, pr.ip, pr.sv, pr.hld
      FROM player_projections pr
      JOIN players p ON p.player_id = pr.player_id
      WHERE pr.season = ? AND pr.stat_group = ? AND pr.source = ?
    `).all(season, group, source);
    return rows;
  } catch (_) {
    return [];
  }
}

/**
 * US-11.2: Returns the correct stat rows based on settings.statsWindow and
 * whether projections are available for the upcoming season.
 *
 * Priority:
 *   1. player_projections (upcoming season, VALUATION_PROJECTION_SOURCE)
 *   2. player_stats (historical, respecting statsWindow: last1 | last3)
 *
 * @param {object} settings  — merged league settings
 * @param {number} season    — the historical season to use as fallback
 * @param {'hitting'|'pitching'} group
 * @returns {{ rows: Array<object>, usedProjectionSource: string|null }}
 */
function loadStatRowsForSettings(settings, season, group) {
  const projSource    = process.env.VALUATION_PROJECTION_SOURCE || 'steamer';
  const upcomingSeason = new Date().getFullYear(); // projections are for the current/upcoming year

  if (settings.useProjections !== false) {
    const projRows = loadProjectionRows(upcomingSeason, group, projSource);
    if (projRows.length > 0) {
      return { rows: projRows, usedProjectionSource: projSource };
    }
  }

  const rows = settings.statsWindow === 'last3'
    ? loadWeightedStatRows(group)
    : loadStatRows(season, group);
  return { rows, usedProjectionSource: null };
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

  // STEP 3a: Find the average value for each category across the whole player pool
  const poolMeans = {};
  for (const cat of categories) {
    poolMeans[cat] = mean(pool.map((p) => p[cat] ?? 0));
  }

  // STEP 3b: Find how spread out the values are for each category (standard deviation).
  // For rate stats like AVG/ERA/WHIP, weight each player's contribution by playing time
  // so that a .400 hitter in 20 AB doesn't outscore a .310 hitter in 600 AB.
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
      // STEP 3c: Calculate how far above or below average this player is in this category
      let z;
      if (rateStats.has(cat)) {
        // Rate stat: scale by playing time before comparing to the pool
        const volField = rateStatVolume[cat];
        const contribution = ((player[cat] ?? 0) - poolMeans[cat]) * (player[volField] ?? 0);
        z = contribution / poolStds[cat];
      } else {
        // Counting stat: straightforward distance from the pool average
        z = ((player[cat] ?? 0) - poolMeans[cat]) / poolStds[cat];
      }

      // ERA and WHIP are flipped — a lower value is better in fantasy, so we negate the score
      if (negativeCategories.has(cat)) z = -z;

      zScores[cat] = z;
      // STEP 4: Running total — sum all category scores into one overall score per player
      zTotal += z;
    }

    return { ...player, zScores, zTotal };
  });
}

function projectRowsWithReliability(rows, statGroup, settings) {
  const isHitting = statGroup === 'hitting';
  const volumeField = isHitting ? 'ab' : 'ip';
  const reliabilityCfg = settings.reliability || DEFAULTS.reliability;
  const kMap = isHitting ? reliabilityCfg.hittingK : reliabilityCfg.pitchingK;
  const fallbackPct = Math.max(0, Math.min(1, Number(reliabilityCfg.rookieVolumeFallbackPct) || 0.6));

  const volumes = rows.map((r) => Number(r[volumeField]) || 0).filter((v) => v > 0);
  const medianVolume = median(volumes);
  const fallbackVolume = medianVolume > 0 ? medianVolume * fallbackPct : (isHitting ? 350 : 90);

  let leagueRates;
  if (isHitting) {
    const totalAb = rows.reduce((s, r) => s + (Number(r.ab) || 0), 0);
    leagueRates = {
      hr: safeDiv(rows.reduce((s, r) => s + (Number(r.hr) || 0), 0), totalAb),
      r: safeDiv(rows.reduce((s, r) => s + (Number(r.r) || 0), 0), totalAb),
      rbi: safeDiv(rows.reduce((s, r) => s + (Number(r.rbi) || 0), 0), totalAb),
      sb: safeDiv(rows.reduce((s, r) => s + (Number(r.sb) || 0), 0), totalAb),
      avg: safeDiv(rows.reduce((s, r) => s + (Number(r.h) || 0), 0), totalAb),
    };
  } else {
    const totalIp = rows.reduce((s, r) => s + (Number(r.ip) || 0), 0);
    leagueRates = {
      w: safeDiv(rows.reduce((s, r) => s + (Number(r.w) || 0), 0), totalIp),
      k: safeDiv(rows.reduce((s, r) => s + (Number(r.k) || 0), 0), totalIp),
      sv: safeDiv(rows.reduce((s, r) => s + (Number(r.sv) || 0), 0), totalIp),
      era: mean(rows.map((r) => Number(r.era) || 0).filter((v) => v > 0)),
      whip: mean(rows.map((r) => Number(r.whip) || 0).filter((v) => v > 0)),
    };
  }

  return rows.map((row) => {
    const sample = Math.max(0, Number(row[volumeField]) || 0);
    const expectedVolume = sample > 0 ? sample : fallbackVolume;
    const { multiplier: availMult, injuryAdjustment, depthChartAdjustment } = availabilityMultiplier(row, statGroup, settings);

    // US-11.3: age factor — only applied when leagueSettings.ageFactor === true
    const { age, multiplier: ageMult } = settings.ageFactor
      ? computeAgeMultiplier(row.birth_date, getStatSeason(settings), settings.ageCurve)
      : { age: null, multiplier: 1.0 };
    const combinedMult = availMult * ageMult;

    if (isHitting) {
      const relHR = reliabilityFactor(sample, kMap.hr);
      const relR = reliabilityFactor(sample, kMap.r);
      const relRBI = reliabilityFactor(sample, kMap.rbi);
      const relSB = reliabilityFactor(sample, kMap.sb);
      const relAVG = reliabilityFactor(sample, kMap.avg);

      const hrRate = safeDiv(row.hr, sample);
      const rRate = safeDiv(row.r, sample);
      const rbiRate = safeDiv(row.rbi, sample);
      const sbRate = safeDiv(row.sb, sample);
      const avgRate = sample > 0 ? safeDiv(row.h, sample) : (Number(row.avg) || 0);

      const projHrRate = relHR * hrRate + (1 - relHR) * leagueRates.hr;
      const projRRate = relR * rRate + (1 - relR) * leagueRates.r;
      const projRbiRate = relRBI * rbiRate + (1 - relRBI) * leagueRates.rbi;
      const projSbRate = relSB * sbRate + (1 - relSB) * leagueRates.sb;
      const projAvg = relAVG * avgRate + (1 - relAVG) * leagueRates.avg;

      return {
        ...row,
        ab: expectedVolume * combinedMult,
        h: projAvg * expectedVolume * combinedMult,
        hr: projHrRate * expectedVolume * combinedMult,
        r: projRRate * expectedVolume * combinedMult,
        rbi: projRbiRate * expectedVolume * combinedMult,
        sb: projSbRate * expectedVolume * combinedMult,
        bb: (Number(row.bb) || 0) * combinedMult,
        k: (Number(row.k) || 0) * combinedMult,
        avg: projAvg,
        availabilityMultiplier: availMult,
        injuryAdjustment,
        depthChartAdjustment,
        ageAdjustment: { age, multiplier: ageMult },
      };
    }

    const relW = reliabilityFactor(sample, kMap.w);
    const relK = reliabilityFactor(sample, kMap.k);
    const relSV = reliabilityFactor(sample, kMap.sv);
    const relERA = reliabilityFactor(sample, kMap.era);
    const relWHIP = reliabilityFactor(sample, kMap.whip);

    const wRate = safeDiv(row.w, sample);
    const kRate = safeDiv(row.k, sample);
    const svRate = safeDiv(row.sv, sample);
    const eraRate = Number(row.era) || leagueRates.era || 4.2;
    const whipRate = Number(row.whip) || leagueRates.whip || 1.3;

    const projWRate = relW * wRate + (1 - relW) * leagueRates.w;
    const projKRate = relK * kRate + (1 - relK) * leagueRates.k;
    const projSvRate = relSV * svRate + (1 - relSV) * leagueRates.sv;
    const projEra = relERA * eraRate + (1 - relERA) * (leagueRates.era || eraRate);
    const projWhip = relWHIP * whipRate + (1 - relWHIP) * (leagueRates.whip || whipRate);

    return {
      ...row,
      ip: expectedVolume * combinedMult,
      w: projWRate * expectedVolume * combinedMult,
      k: projKRate * expectedVolume * combinedMult,
      sv: projSvRate * expectedVolume * combinedMult,
      era: projEra,
      whip: projWhip,
      availabilityMultiplier: availMult,
      injuryAdjustment,
      depthChartAdjustment,
      ageAdjustment: { age, multiplier: ageMult },
    };
  });
}

function getEligibilityTokens(player, statGroup) {
  const rawTokens = safeParsePositions(player.positions)
    .map((p) => String(p || '').toUpperCase())
    .filter(Boolean);
  const tokens = new Set(rawTokens);

  if (statGroup === 'hitting') {
    const eligible = new Set();
    for (const token of tokens) {
      if (HITTER_POSITION_KEYS.has(token)) eligible.add(token);
    }
    eligible.add('UTIL');
    return eligible;
  }

  const eligible = new Set();
  for (const token of tokens) {
    if (token === 'P') {
      eligible.add('P');
      eligible.add('SP');
      eligible.add('RP');
    } else if (token === 'SP') {
      eligible.add('SP');
      eligible.add('P');
    } else if (token === 'RP') {
      eligible.add('RP');
      eligible.add('P');
    }
  }
  if (!eligible.size) {
    eligible.add('P');
    eligible.add('SP');
    eligible.add('RP');
  }
  return eligible;
}

function buildReplacementByPosition(scoredPool, totalDemandByPosition, statGroup) {
  const replacementByPosition = {};
  for (const [position, totalSlots] of Object.entries(totalDemandByPosition || {})) {
    const demand = Number(totalSlots) || 0;
    if (demand <= 0) continue;

    const candidates = scoredPool.filter((player) =>
      getEligibilityTokens(player, statGroup).has(position)
    );
    if (!candidates.length) {
      replacementByPosition[position] = 0;
      continue;
    }

    const sorted = [...candidates].sort((a, b) => b.zTotal - a.zTotal);
    const replacementIdx = Math.min(demand, sorted.length) - 1;
    replacementByPosition[position] = sorted[replacementIdx]?.zTotal ?? 0;
  }
  return replacementByPosition;
}

function getPositionalScarcityVar(player, statGroup, replacementByPosition) {
  const eligible = getEligibilityTokens(player, statGroup);
  let bestVar = Number.NEGATIVE_INFINITY;
  let bestPosition = null;

  for (const position of eligible) {
    const replacementZ = replacementByPosition[position];
    if (replacementZ === undefined) continue;
    const valueAboveReplacement = (player.zTotal || 0) - replacementZ;
    if (valueAboveReplacement > bestVar) {
      bestVar = valueAboveReplacement;
      bestPosition = position;
    }
  }

  if (!Number.isFinite(bestVar)) {
    return { valueAboveReplacement: Number.NEGATIVE_INFINITY, scarcityPosition: null };
  }
  return { valueAboveReplacement: bestVar, scarcityPosition: bestPosition };
}

/**
 * Assigns dollar values to a scored player pool.
 *
 * @param {Array}  scoredPool      - output of computeZScores
 * @param {number} replacementRank - the 1-based rank of the replacement player
 * @param {number} totalSalary     - total dollars available for this group
 * @returns {Array<{playerId, name, dollarValue, projectedValue, rank, zScore, zScores, statGroup}>}
 */
function assignDollarValues(
  scoredPool,
  replacementRank,
  totalSalary,
  statGroup,
  replacementByPosition = {}
) {
  // STEP 5a: Rank all players best to worst by their total z-score
  const sorted = [...scoredPool].sort((a, b) => b.zTotal - a.zTotal);

  // STEP 5b: Find the "replacement level" — the score of the last rostered player.
  // Anyone ranked below this is freely available off the waiver wire and worth only $1.
  const replacementIdx = Math.min(replacementRank, sorted.length) - 1;
  const replacementZ   = sorted[replacementIdx]?.zTotal ?? 0;

  const withVAR = sorted.map((p, i) => {
    const overallVar = (p.zTotal || 0) - replacementZ;
    const scarcity = getPositionalScarcityVar(p, statGroup, replacementByPosition);
    const scarcityVar = Number.isFinite(scarcity.valueAboveReplacement)
      ? scarcity.valueAboveReplacement
      : overallVar;
    const adjustedVar = Math.max(overallVar, scarcityVar);
    return {
      ...p,
      rank: i + 1,
      var: overallVar,
      scarcityVar,
      adjustedVar,
      scarcityPosition: scarcity.scarcityPosition,
    };
  });

  const positiveVAR   = withVAR.filter((p) => p.adjustedVar > 0);
  const sumPositive   = positiveVAR.reduce((s, p) => s + p.adjustedVar, 0);
  // Reserve $1 for every rostered player as the minimum bid; the rest is "free salary" to distribute
  const freeSalary    = Math.max(0, totalSalary - withVAR.length);

  return withVAR.map((p) => {
    let dollarValue;
    if (p.adjustedVar > 0 && sumPositive > 0) {
      // STEP 7b: Each valuable player gets $1 + their proportional share of the free salary pool
      dollarValue = Math.max(1, Math.round(1 + (p.adjustedVar / sumPositive) * freeSalary));
    } else {
      // Player is at or below replacement level — minimum $1 bid
      dollarValue = 1;
    }

    return {
      playerId:       p.player_id,
      name:           p.name,
      mlbTeam:        p.mlb_team,
      positions:      safeParsePositions(p.positions),
      status:         p.status || 'active',
      depthChartRank: Number(p.depth_chart_rank) || null,
      depthChartPosition: p.depth_chart_position || null,
      availabilityMultiplier: Number(p.availabilityMultiplier) || 1,
      injuryAdjustment:     p.injuryAdjustment     || null,
      depthChartAdjustment: p.depthChartAdjustment || null,
      ageAdjustment:        p.ageAdjustment        || null,
      dollarValue,
      projectedValue: dollarValue,  // pre-draft: projected = dollar value
      rank:           p.rank,
      zScore:         Math.round(p.zTotal * 1000) / 1000,
      zScores:        roundZScores(p.zScores),
      valueAboveReplacement: Math.round(p.var * 1000) / 1000,
      positionalValueAboveReplacement: Math.round((p.scarcityVar || 0) * 1000) / 1000,
      scarcityPosition: p.scarcityPosition,
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

function roundCurrency(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function normalizePoolPlayer(player) {
  return {
    playerId: String(player.playerId || player.player_id || ''),
    name: String(player.name || player.playerName || ''),
    mlbTeam: String(player.mlbTeam || player.mlb_team || ''),
    positions: Array.isArray(player.positions)
      ? player.positions
      : safeParsePositions(player.positions),
  };
}

function canonicalPoolKey(player) {
  const id = Number(String(player.playerId || '').replace(/^mlb-/i, ''));
  if (Number.isFinite(id) && id >= 100000) return `pid:${id}`;
  return [
    String(player.name || '').trim().toLowerCase(),
    String(player.mlbTeam || '').trim().toUpperCase(),
  ].join('||');
}

function poolQualityScore(player) {
  const id = Number(String(player.playerId || '').replace(/^mlb-/i, ''));
  return Number.isFinite(id) && id >= 100000 ? 10 : 0;
}

function hasReliablePoolId(player) {
  const id = Number(String(player.playerId || '').replace(/^mlb-/i, ''));
  return Number.isFinite(id) && id >= 100000;
}

function dedupePoolPlayers(players = []) {
  const byId = new Map();
  for (const player of players) {
    const normalized = normalizePoolPlayer(player);
    if (!normalized.playerId) continue;
    const existing = byId.get(normalized.playerId);
    if (!existing || poolQualityScore(normalized) > poolQualityScore(existing)) {
      byId.set(normalized.playerId, normalized);
    }
  }

  const byIdentity = new Map();
  for (const player of byId.values()) {
    const key = canonicalPoolKey(player);
    if (!key || key.startsWith('||')) continue;
    const existing = byIdentity.get(key);
    if (!existing) {
      byIdentity.set(key, player);
      continue;
    }
    const best = poolQualityScore(player) > poolQualityScore(existing) ? player : existing;
    const mergedPositions = [...new Set([...(existing.positions || []), ...(player.positions || [])])]
      .map((p) => String(p).toUpperCase())
      .sort();
    byIdentity.set(key, { ...best, positions: mergedPositions });
  }

  const byNameTeam = new Map();
  for (const player of byIdentity.values()) {
    const key = [
      String(player.name || '').trim().toLowerCase(),
      String(player.mlbTeam || '').trim().toUpperCase(),
    ].join('||');
    if (!key || key.startsWith('||')) continue;
    const existing = byNameTeam.get(key);
    if (!existing) {
      byNameTeam.set(key, player);
      continue;
    }
    const best = poolQualityScore(player) > poolQualityScore(existing) ? player : existing;
    const mergedPositions = [...new Set([...(existing.positions || []), ...(player.positions || [])])]
      .map((p) => String(p).toUpperCase())
      .sort();
    byNameTeam.set(key, { ...best, positions: mergedPositions });
  }

  const mergedByNameTeam = [...byNameTeam.values()];

  const byNamePos = new Map();
  for (const player of mergedByNameTeam) {
    const posKey = [...new Set((player.positions || []).map((p) => String(p).toUpperCase()))]
      .sort()
      .join('|');
    const key = [String(player.name || '').trim().toLowerCase(), posKey].join('||');
    if (!byNamePos.has(key)) byNamePos.set(key, []);
    byNamePos.get(key).push(player);
  }

  const finalPlayers = [];
  for (const group of byNamePos.values()) {
    const reliable = group.filter(hasReliablePoolId);
    const legacy = group.filter((p) => !hasReliablePoolId(p));
    if (reliable.length === 1 && legacy.length >= 1) {
      const mergedPositions = [...new Set(group.flatMap((p) => p.positions || []))]
        .map((p) => String(p).toUpperCase())
        .sort();
      finalPlayers.push({ ...reliable[0], positions: mergedPositions });
    } else {
      finalPlayers.push(...group);
    }
  }

  return finalPlayers;
}

function loadPlayerPool() {
  const db = tryGetDb();
  if (db) {
    try {
      const rows = db.prepare(`
        SELECT player_id, name, mlb_team, positions
        FROM players
      `).all();
      if (rows.length) {
        return dedupePoolPlayers(rows.map((row) => ({
          playerId: row.player_id,
          name: row.name,
          mlbTeam: row.mlb_team,
          positions: safeParsePositions(row.positions),
        })));
      }
    } catch (_) {}
  }
  return [];
}

function calibrateValuationTotals(valuations, targetTotal) {
  if (!Array.isArray(valuations) || !valuations.length) return [];

  const target = roundCurrency(Math.max(0, Number(targetTotal) || 0));
  const current = roundCurrency(
    valuations.reduce((sum, v) => sum + (Number(v.dollarValue) || 0), 0)
  );

  // If we have no signal values, split salary pool evenly.
  if (current === 0) {
    const even = roundCurrency(target / valuations.length);
    const next = valuations.map((v) => ({
      ...v,
      dollarValue: even,
      projectedValue: even,
    }));
    const fixed = roundCurrency(target - roundCurrency(even * valuations.length));
    if (fixed !== 0) {
      next[0].dollarValue = roundCurrency(next[0].dollarValue + fixed);
      next[0].projectedValue = next[0].dollarValue;
    }
    return next;
  }

  const ratio = target / current;
  const scaled = valuations.map((v) => {
    const value = roundCurrency((Number(v.dollarValue) || 0) * ratio);
    return { ...v, dollarValue: value, projectedValue: value };
  });

  // Correct residual cents so totals line up exactly.
  const scaledTotal = roundCurrency(
    scaled.reduce((sum, v) => sum + (Number(v.dollarValue) || 0), 0)
  );
  const diff = roundCurrency(target - scaledTotal);
  if (diff !== 0 && scaled.length) {
    scaled[0].dollarValue = roundCurrency(scaled[0].dollarValue + diff);
    scaled[0].projectedValue = scaled[0].dollarValue;
  }

  return scaled;
}

function parseRosterSlotsConfig(leagueSettings = {}) {
  const rosterSlots = leagueSettings.rosterSlots;

  if (rosterSlots === undefined || rosterSlots === null) {
    return {
      positionSlotMap: { ...DEFAULT_POSITION_SLOT_MAP },
      hitterSlotsPerTeam: DEFAULTS.hitterSlotsPerTeam,
      pitcherSlotsPerTeam: DEFAULTS.pitcherSlotsPerTeam,
      unknownKeys: [],
      ignoredBench: 0,
      legacyFlatSlots: null,
    };
  }

  if (typeof rosterSlots === 'number' && Number.isFinite(rosterSlots) && rosterSlots > 0) {
    return {
      positionSlotMap: { ...DEFAULT_POSITION_SLOT_MAP },
      hitterSlotsPerTeam: DEFAULTS.hitterSlotsPerTeam,
      pitcherSlotsPerTeam: DEFAULTS.pitcherSlotsPerTeam,
      unknownKeys: [],
      ignoredBench: 0,
      legacyFlatSlots: Math.floor(rosterSlots),
    };
  }

  if (typeof rosterSlots !== 'object' || Array.isArray(rosterSlots)) {
    return {
      positionSlotMap: { ...DEFAULT_POSITION_SLOT_MAP },
      hitterSlotsPerTeam: DEFAULTS.hitterSlotsPerTeam,
      pitcherSlotsPerTeam: DEFAULTS.pitcherSlotsPerTeam,
      unknownKeys: [],
      ignoredBench: 0,
      legacyFlatSlots: null,
    };
  }

  const positionSlotMap = {};
  const unknownKeys = [];
  let ignoredBench = 0;

  for (const [rawKey, rawValue] of Object.entries(rosterSlots)) {
    const key = String(rawKey || '').trim().toUpperCase();
    const count = Math.max(0, Math.floor(Number(rawValue) || 0));
    if (!count) continue;

    // BENCH is intentionally ignored for scarcity demand.
    if (key === 'BENCH') {
      ignoredBench += count;
      continue;
    }

    if (HITTER_POSITION_KEYS.has(key) || PITCHER_POSITION_KEYS.has(key)) {
      positionSlotMap[key] = (positionSlotMap[key] || 0) + count;
    } else {
      unknownKeys.push(key);
    }
  }

  const hitterSlotsPerTeam = Object.entries(positionSlotMap)
    .filter(([key]) => HITTER_POSITION_KEYS.has(key))
    .reduce((sum, [, count]) => sum + count, 0);
  const pitcherSlotsPerTeam = Object.entries(positionSlotMap)
    .filter(([key]) => PITCHER_POSITION_KEYS.has(key))
    .reduce((sum, [, count]) => sum + count, 0);

  return {
    positionSlotMap: Object.keys(positionSlotMap).length
      ? positionSlotMap
      : { ...DEFAULT_POSITION_SLOT_MAP },
    hitterSlotsPerTeam: hitterSlotsPerTeam || DEFAULTS.hitterSlotsPerTeam,
    pitcherSlotsPerTeam: pitcherSlotsPerTeam || DEFAULTS.pitcherSlotsPerTeam,
    unknownKeys,
    ignoredBench,
    legacyFlatSlots: null,
  };
}

// ── US-5.4: Draft-state-aware overrides ──────────────────────────────────────

/**
 * Aggregates remaining open roster slots per position across all teams.
 *
 * @param {Record<string, Record<string,number>>} filledRosterSlots
 *   teamId → { position → filledCount }
 * @param {Record<string,number>} rosterSlotsMap
 *   position → slotsPerTeam  (the leagueSettings.rosterSlots map)
 * @param {string[]} teamIds
 * @returns {Record<string,number>}  position → total remaining open slots (across all teams)
 */
function computeRemainingSlotsByPosition(filledRosterSlots, rosterSlotsMap, teamIds) {
  const remaining = {};
  for (const [rawPos, slotsPerTeam] of Object.entries(rosterSlotsMap)) {
    const pos = String(rawPos).toUpperCase();
    if (pos === 'BENCH') continue;
    if (!HITTER_POSITION_KEYS.has(pos) && !PITCHER_POSITION_KEYS.has(pos)) continue;

    let totalOpen = 0;
    for (const teamId of teamIds) {
      const filled = Number(
        (filledRosterSlots[teamId] || {})[pos] ||
        (filledRosterSlots[teamId] || {})[rawPos] ||
        0
      );
      totalOpen += Math.max(0, Number(slotsPerTeam) - filled);
    }
    if (totalOpen > 0) remaining[pos] = totalOpen;
  }
  return remaining;
}

/**
 * Computes draft-state-aware overrides for league settings.
 *
 * When a live draft is in progress the engine uses:
 *   - Remaining salary pool  = sum(teamBudgets) − $1 × openSlotsAcrossAllTeams
 *     (expressed as a per-team budget so computeValuations' numTeams×budget still works)
 *   - positionTotalDemand    = remaining open slots per position (total, not per-team)
 *     which replaces the per-team × numTeams calculation inside computeValuations.
 *
 * Pre-draft (empty draftState) → returns settings unchanged.
 *
 * @param {object} settings       - merged league settings from mergeSettings()
 * @param {object} draftState     - raw draftState from the request
 * @param {object} leagueSettings - raw leagueSettings from the request (for rosterSlots map)
 * @returns {object}              - settings with dynamic overrides applied
 */
function applyDraftStateOverrides(settings, draftState, leagueSettings) {
  const { purchasedPlayers, teamBudgets, filledRosterSlots } = draftState;

  const hasPurchases    = Array.isArray(purchasedPlayers) && purchasedPlayers.length > 0;
  const hasTeamBudgets  = teamBudgets != null &&
                          typeof teamBudgets === 'object' &&
                          !Array.isArray(teamBudgets) &&
                          Object.keys(teamBudgets).length > 0;
  const hasFilledSlots  = filledRosterSlots != null && typeof filledRosterSlots === 'object';
  const hasRosterMap    = leagueSettings.rosterSlots != null &&
                          typeof leagueSettings.rosterSlots === 'object' &&
                          !Array.isArray(leagueSettings.rosterSlots);

  // Pre-draft baseline — no overrides needed
  if (!hasPurchases && !hasTeamBudgets && !hasFilledSlots) return settings;

  const overrides = { ...settings };

  // ── Dynamic budget recalculation ──────────────────────────────────────────
  if (hasTeamBudgets) {
    const teamIds = Object.keys(teamBudgets);
    const totalRemainingBudget = teamIds.reduce(
      (s, id) => s + Math.max(0, Number(teamBudgets[id] || 0)), 0
    );

    // Compute total open slots across all teams (for the $1-minimum reservation)
    let openSlotsAcrossAllTeams;
    if (hasFilledSlots && hasRosterMap) {
      openSlotsAcrossAllTeams = teamIds.reduce((sum, teamId) => {
        const filled = filledRosterSlots[teamId] || {};
        for (const [rawPos, slotsPerTeam] of Object.entries(leagueSettings.rosterSlots)) {
          const pos        = String(rawPos).toUpperCase();
          if (pos === 'BENCH') continue;
          const filledCount = Number(filled[pos] || filled[rawPos] || 0);
          sum += Math.max(0, Number(slotsPerTeam) - filledCount);
        }
        return sum;
      }, 0);
    } else {
      // Estimate: (total league slots) − (number already purchased)
      const totalSlotsPerTeam = settings.hitterSlotsPerTeam + settings.pitcherSlotsPerTeam;
      const numPurchased       = hasPurchases ? purchasedPlayers.length : 0;
      openSlotsAcrossAllTeams  = Math.max(0, settings.numTeams * totalSlotsPerTeam - numPurchased);
    }

    // remainingSalaryPool = sum(teamBudgets) − $1 × openSlotsAcrossAllTeams
    const remainingSalaryPool = Math.max(0, totalRemainingBudget - openSlotsAcrossAllTeams);

    // Express as a per-team value so computeValuations' (numTeams × budget) yields the right total
    if (settings.numTeams > 0) {
      overrides.budget = remainingSalaryPool / settings.numTeams;
    }

    // Stash for meta reporting
    overrides._draftBudgetMeta = { remainingSalaryPool, totalRemainingBudget, openSlotsAcrossAllTeams };
  }

  // ── Positional replacement-level recalculation ────────────────────────────
  if (hasFilledSlots && hasRosterMap) {
    const teamIds = hasTeamBudgets
      ? Object.keys(teamBudgets)
      : Object.keys(filledRosterSlots);

    const remainingByPosition = computeRemainingSlotsByPosition(
      filledRosterSlots, leagueSettings.rosterSlots, teamIds
    );

    if (Object.keys(remainingByPosition).length > 0) {
      // positionTotalDemand: total across all teams (computeValuations will skip ×numTeams)
      overrides.positionTotalDemand = remainingByPosition;

      // Keep per-team slot counts consistent so replacement-rank calcs stay meaningful
      const hitterTotal  = Object.entries(remainingByPosition)
        .filter(([pos]) => HITTER_POSITION_KEYS.has(pos))
        .reduce((s, [, n]) => s + n, 0);
      const pitcherTotal = Object.entries(remainingByPosition)
        .filter(([pos]) => PITCHER_POSITION_KEYS.has(pos))
        .reduce((s, [, n]) => s + n, 0);

      if (hitterTotal  > 0) overrides.hitterSlotsPerTeam  = hitterTotal  / settings.numTeams;
      if (pitcherTotal > 0) overrides.pitcherSlotsPerTeam = pitcherTotal / settings.numTeams;
    }
  }

  return overrides;
}

// ── Public API ────────────────────────────────────────────────────────────────

// Positions that map to the hitter budget bucket
const HITTER_POSITIONS_SET  = new Set(['C', '1B', '2B', '3B', 'SS', 'OF', 'UTIL', 'DH']);
// Positions that map to the pitcher budget bucket
const PITCHER_POSITIONS_SET = new Set(['SP', 'RP', 'P']);

/**
 * Converts the Draft Kit leagueSettings shape to the engine's internal shape.
 * Also accepts the legacy engine shape directly (pass-through).
 *
 * Draft Kit shape:
 *   { numberOfTeams, salaryCap, rosterSlots: { C:2, "1B":1, … }, scoringType, draftType }
 *
 * Engine (legacy) shape:
 *   { numTeams, budget, hitterSlotsPerTeam, pitcherSlotsPerTeam, hittingCategories, … }
 *
 * When both shapes are present, legacy engine fields take precedence so internal
 * callers can still override individual values.
 */
function normalizeLeagueSettings(input = {}) {
  const out = { ...input };

  // numberOfTeams → numTeams (only when legacy field absent)
  if (input.numberOfTeams !== undefined && input.numTeams === undefined) {
    out.numTeams = Number(input.numberOfTeams);
  }

  // salaryCap → budget (only when legacy field absent)
  if (input.salaryCap !== undefined && input.budget === undefined) {
    out.budget = Number(input.salaryCap);
  }

  // rosterSlots map → hitterSlotsPerTeam / pitcherSlotsPerTeam
  // Only applied when the legacy slot fields are absent to allow explicit overrides.
  if (
    input.rosterSlots &&
    typeof input.rosterSlots === 'object' &&
    !Array.isArray(input.rosterSlots) &&
    input.hitterSlotsPerTeam  === undefined &&
    input.pitcherSlotsPerTeam === undefined
  ) {
    let hitterSlots  = 0;
    let pitcherSlots = 0;
    let benchCount   = 0;

    for (const [pos, count] of Object.entries(input.rosterSlots)) {
      const posKey = String(pos).toUpperCase();
      const n = Number(count) || 0;
      if (posKey === 'BENCH') {
        benchCount += n;
      } else if (HITTER_POSITIONS_SET.has(posKey)) {
        hitterSlots += n;
      } else if (PITCHER_POSITIONS_SET.has(posKey)) {
        pitcherSlots += n;
      } else {
        log.warn('unknown position key — ignored', { context: 'normalizeLeagueSettings', position: pos });
      }
    }

    // Distribute BENCH slots proportionally to the hitter/pitcher ratio already found.
    // If no other slots are defined yet, default to a 70/30 hitter/pitcher split.
    if (benchCount > 0) {
      const knownTotal = hitterSlots + pitcherSlots;
      const hitterBenchShare = knownTotal > 0
        ? Math.round(benchCount * (hitterSlots / knownTotal))
        : Math.round(benchCount * 0.7);
      hitterSlots  += hitterBenchShare;
      pitcherSlots += benchCount - hitterBenchShare;
    }

    if (hitterSlots  > 0) out.hitterSlotsPerTeam  = hitterSlots;
    if (pitcherSlots > 0) out.pitcherSlotsPerTeam = pitcherSlots;
  }

  // scoringType → category presets (only when hittingCategories not already overridden)
  if (input.scoringType && !input.hittingCategories) {
    if (input.scoringType === 'Points') {
      // Points leagues use a single composite fantasy-points category
      out.hittingCategories  = ['fpts'];
      out.pitchingCategories = ['fpts'];
    }
    // '5x5 Roto' and 'H2H Categories' both map to the default 5x5 categories,
    // so no override is needed — DEFAULTS in mergeSettings handle them.
  }

  return out;
}

/**
 * Merges caller-supplied league settings with defaults.
 * Numeric string values are coerced to numbers.
 */
function mergeSettings(leagueSettings = {}) {
  const slotsConfig = parseRosterSlotsConfig(leagueSettings);
  if (slotsConfig.unknownKeys.length) {
    log.warn('ignoring unknown roster slot keys', { keys: slotsConfig.unknownKeys });
  }
  const inputAvailability = leagueSettings.availability || {};
  const inputInjury = inputAvailability.injuryMultipliers || {};
  const inputDepth = inputAvailability.depthRankMultipliers || {};

  return {
    ...DEFAULTS,
    numTeams:            Number(leagueSettings.numTeams)            || DEFAULTS.numTeams,
    budget:              Number(leagueSettings.budget)              || DEFAULTS.budget,
    hitterBudgetPct:     Number(leagueSettings.hitterBudgetPct)     || DEFAULTS.hitterBudgetPct,
    hitterSlotsPerTeam:  Number(leagueSettings.hitterSlotsPerTeam)  || slotsConfig.hitterSlotsPerTeam,
    pitcherSlotsPerTeam: Number(leagueSettings.pitcherSlotsPerTeam) || slotsConfig.pitcherSlotsPerTeam,
    minAB:               Number(leagueSettings.minAB)               || DEFAULTS.minAB,
    minIP:               Number(leagueSettings.minIP)               || DEFAULTS.minIP,
    statSeason:          Number(leagueSettings.statSeason)          || null,
    statsWindow:         leagueSettings.statsWindow === 'last3' ? 'last3' : DEFAULTS.statsWindow,
    ageFactor:           leagueSettings.ageFactor === true,
    ageCurve:            parseAgeCurve(leagueSettings.ageCurve),
    depthChartFactor:    leagueSettings.depthChartFactor === false ? false : DEFAULTS.depthChartFactor,
    hittingCategories:   leagueSettings.hittingCategories  || DEFAULTS.hittingCategories,
    pitchingCategories:  leagueSettings.pitchingCategories || DEFAULTS.pitchingCategories,
    // Keep Set types — don't allow override for now (US-5.3 can extend)
    negativeCategories:  DEFAULTS.negativeCategories,
    rateStats:           DEFAULTS.rateStats,
    rateStatVolume:      DEFAULTS.rateStatVolume,
    positionSlotMap: slotsConfig.positionSlotMap,
    unknownRosterSlotKeys: slotsConfig.unknownKeys,
    ignoredBenchSlots: slotsConfig.ignoredBench,
    legacyFlatRosterSlots: slotsConfig.legacyFlatSlots,
    availability: {
      injuryMultipliers: {
        ...DEFAULTS.availability.injuryMultipliers,
        ...inputInjury,
      },
      depthRankMultipliers: (() => {
        const envCurve = process.env.VALUATION_DEPTH_CURVE;
        let envDepth = {};
        if (envCurve) { try { envDepth = JSON.parse(envCurve); } catch (_) {} }
        return { ...DEFAULTS.availability.depthRankMultipliers, ...envDepth, ...inputDepth };
      })(),
    },
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
function computeValuations(hitterRows, pitcherRows, poolPlayers, settings) {
  const {
    numTeams, budget, hitterBudgetPct,
    hitterSlotsPerTeam, pitcherSlotsPerTeam,
    minAB, minIP,
    hittingCategories, pitchingCategories, positionSlotMap,
  } = settings;

  // Split the total salary pool between hitters and pitchers
  const totalSalary   = numTeams * budget;
  const hitterSalary  = Math.round(totalSalary * hitterBudgetPct);
  const pitcherSalary = totalSalary - hitterSalary;

  // Total roster spots across all teams — this determines the replacement level rank
  const hitterSlots  = numTeams * hitterSlotsPerTeam;
  const pitcherSlots = numTeams * pitcherSlotsPerTeam;

  // STEP 2: Drop players who didn't play enough to have meaningful stats
  const hitters  = hitterRows.filter((p) => {
    const ab = Number(p.ab) || 0;
    return ab >= minAB || ab === 0;
  });
  const pitchers = pitcherRows.filter((p) => {
    const ip = Number(p.ip) || 0;
    return ip >= minIP || ip === 0;
  });

  // Reliability-weighted projection before z-scores:
  // regresses small-sample players toward league averages and gives no-sample players a fallback volume.
  const projectedHitters = projectRowsWithReliability(hitters, 'hitting', settings);
  const projectedPitchers = projectRowsWithReliability(pitchers, 'pitching', settings);

  // STEPS 3 & 4: Score every player in each category and sum into a total z-score
  const scoredHitters  = computeZScores(projectedHitters,  hittingCategories,  settings);
  const scoredPitchers = computeZScores(projectedPitchers, pitchingCategories, settings);

  const hitterDemand  = {};
  const pitcherDemand = {};
  if (settings.positionTotalDemand) {
    // US-5.4 draft-state override: remaining total slots already span all teams
    for (const [position, totalCount] of Object.entries(settings.positionTotalDemand)) {
      if (HITTER_POSITION_KEYS.has(position))  hitterDemand[position]  = totalCount;
      if (PITCHER_POSITION_KEYS.has(position)) pitcherDemand[position] = totalCount;
    }
  } else {
    for (const [position, count] of Object.entries(positionSlotMap || {})) {
      if (!count) continue;
      if (HITTER_POSITION_KEYS.has(position))  hitterDemand[position]  = count * numTeams;
      if (PITCHER_POSITION_KEYS.has(position)) pitcherDemand[position] = count * numTeams;
    }
  }

  const hitterReplacementByPosition = buildReplacementByPosition(
    scoredHitters,
    hitterDemand,
    'hitting'
  );
  const pitcherReplacementByPosition = buildReplacementByPosition(
    scoredPitchers,
    pitcherDemand,
    'pitching'
  );

  // STEPS 5, 6 & 7: Find replacement level, calculate VAR, convert to dollar values
  const hitterVals = assignDollarValues(
    scoredHitters,
    hitterSlots,
    hitterSalary,
    'hitting',
    hitterReplacementByPosition
  );
  const pitcherVals = assignDollarValues(
    scoredPitchers,
    pitcherSlots,
    pitcherSalary,
    'pitching',
    pitcherReplacementByPosition
  );

  const pool = Array.isArray(poolPlayers)
    ? poolPlayers.map(normalizePoolPlayer).filter((p) => p.playerId)
    : [];

  const byPlayerId = new Map();
  for (const valuation of [...hitterVals, ...pitcherVals]) {
    byPlayerId.set(valuation.playerId, valuation);
  }

  const withFullPool = pool.length
    ? pool.map((player) => {
        const fromModel = byPlayerId.get(player.playerId);
        if (fromModel) return fromModel;
        return {
          playerId: player.playerId,
          name: player.name,
          mlbTeam: player.mlbTeam,
          positions: player.positions,
          dollarValue: 0,
          projectedValue: 0,
          rank: null,
          zScore: null,
          zScores: {},
          statGroup: 'unscored',
        };
      })
    : [...hitterVals, ...pitcherVals];

  const targetTotal = numTeams * budget;
  const normalized = calibrateValuationTotals(withFullPool, targetTotal)
    .sort((a, b) => {
      const diff = (Number(b.dollarValue) || 0) - (Number(a.dollarValue) || 0);
      if (diff !== 0) return diff;
      return String(a.name || '').localeCompare(String(b.name || ''));
    })
    .map((v, index) => ({ ...v, rank: index + 1 }));

  return normalized;
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
  const season   = getStatSeason(settings);

  // STEP 1: Load all hitter and pitcher stat rows for the target season (or 3-year weighted,
  //         or projections if available — US-11.2)
  const { rows: allHitters,  usedProjectionSource: hitterProjSource  } = loadStatRowsForSettings(settings, season, 'hitting');
  const { rows: allPitchers, usedProjectionSource: pitcherProjSource } = loadStatRowsForSettings(settings, season, 'pitching');
  const usedProjectionSource = hitterProjSource || pitcherProjSource || null;
  const allPoolPlayers = loadPlayerPool();

  if (!allHitters.length && !allPitchers.length) {
    return { valuations: [], meta: { season, statsWindow: settings.statsWindow, usedProjectionSource, note: 'No player stats found — run import-stats first' } };
  }

  // If a live draft is in progress, only value players who haven't been picked yet
  let hitters  = allHitters;
  let pitchers = allPitchers;
  let poolPlayers = allPoolPlayers;

  // Exclude purchased players from available valuation pool (US-7.5 state transitions).
  if (Array.isArray(draftState.purchasedPlayers) && draftState.purchasedPlayers.length) {
    const purchasedIds = new Set(
      draftState.purchasedPlayers
        .map((pp) => pp && pp.playerId)
        .filter(Boolean)
    );
    if (purchasedIds.size) {
      hitters = hitters.filter((p) => !purchasedIds.has(p.player_id));
      pitchers = pitchers.filter((p) => !purchasedIds.has(p.player_id));
      poolPlayers = poolPlayers.filter((p) => !purchasedIds.has(p.playerId));
    }
  }

  if (Array.isArray(draftState.availablePlayerIds) && draftState.availablePlayerIds.length) {
    const avail = new Set(draftState.availablePlayerIds);
    hitters  = hitters.filter((p)  => avail.has(p.player_id));
    pitchers = pitchers.filter((p) => avail.has(p.player_id));
    poolPlayers = poolPlayers.filter((p) => avail.has(p.playerId));
  }

  // US-5.4: override budget and positional demand when live draft state is present
  const effectiveSettings = applyDraftStateOverrides(settings, draftState, leagueSettings);

  const rawValuations = computeValuations(hitters, pitchers, poolPlayers, effectiveSettings);

  // US-5.5: Annotate each valuation with purchasePrice and valueGap.
  // purchasePrice is resolved server-side from draftState.purchasedPlayers —
  // the client does NOT send it as a separate field in the request.
  const purchasedMap = new Map();
  if (Array.isArray(draftState.purchasedPlayers)) {
    for (const pp of draftState.purchasedPlayers) {
      if (pp && pp.playerId) purchasedMap.set(pp.playerId, Number(pp.price) || 0);
    }
  }

  // US-5.5: Purchased players must appear in the response with their pre-draft
  // projectedValue + purchasePrice + valueGap, so the Draft Kit can render the
  // value-vs-paid view without additional lookups. We compute a baseline pass
  // over the full (un-excluded) pool only when there are purchases to surface.
  const baselineByPlayerId = new Map();
  if (purchasedMap.size > 0) {
    const baselineRows = computeValuations(allHitters, allPitchers, allPoolPlayers, settings);
    for (const row of baselineRows) baselineByPlayerId.set(row.playerId, row);
  }

  const availableValuations = rawValuations.map((v) => ({ ...v, purchasePrice: null, valueGap: null }));

  const purchasedValuations = [];
  for (const [playerId, purchasePrice] of purchasedMap.entries()) {
    const base = baselineByPlayerId.get(playerId);
    if (!base) continue; // unknown player id — skip rather than crash
    purchasedValuations.push({
      ...base,
      purchasePrice,
      valueGap: Math.round((base.projectedValue - purchasePrice) * 100) / 100,
    });
  }

  const valuations = [...availableValuations, ...purchasedValuations];

  const hitterCount  = valuations.filter((v) => v.statGroup === 'hitting').length;
  const pitcherCount = valuations.filter((v) => v.statGroup === 'pitching').length;
  const totalValue   = valuations.reduce((s, v) => s + v.dollarValue, 0);
  const isDraftActive = Array.isArray(draftState.purchasedPlayers)
    ? draftState.purchasedPlayers.length > 0
    : !!(draftState.teamBudgets || draftState.filledRosterSlots);

  const meta = {
    season,
    statsWindow:           settings.statsWindow,
    usedProjectionSource:  usedProjectionSource,
    numTeams:              effectiveSettings.numTeams,
    budget:           effectiveSettings.budget,
    hitterSlots:      effectiveSettings.numTeams * effectiveSettings.hitterSlotsPerTeam,
    pitcherSlots:     effectiveSettings.numTeams * effectiveSettings.pitcherSlotsPerTeam,
    hitterCount,
    pitcherCount,
    totalValue,
    targetTotalValue: effectiveSettings.numTeams * effectiveSettings.budget,
    valuationCount:   valuations.length,
    calibrationError: roundCurrency(totalValue - (effectiveSettings.numTeams * effectiveSettings.budget)),
    isDraftActive,
    draftBudget:      effectiveSettings._draftBudgetMeta || null,
    rosterSlotConfig: {
      positionSlotMap:       effectiveSettings.positionSlotMap,
      ignoredBenchSlots:     effectiveSettings.ignoredBenchSlots,
      unknownRosterSlotKeys: effectiveSettings.unknownRosterSlotKeys,
      legacyFlatRosterSlots: effectiveSettings.legacyFlatRosterSlots,
    },
  };

  return { valuations, meta };
}

function getExclusionDiagnostics(leagueSettings = {}, draftState = {}, opts = {}) {
  const settings = mergeSettings(leagueSettings);
  const season = getStatSeason(settings);
  const targetIds = Array.isArray(opts.playerIds) ? opts.playerIds.filter(Boolean) : [];

  const { rows: allHitters  } = loadStatRowsForSettings(settings, season, 'hitting');
  const { rows: allPitchers } = loadStatRowsForSettings(settings, season, 'pitching');
  const allPoolPlayers = loadPlayerPool();

  const purchasedIds = new Set(
    Array.isArray(draftState.purchasedPlayers)
      ? draftState.purchasedPlayers.map((pp) => pp && pp.playerId).filter(Boolean)
      : []
  );
  const hasAvailFilter = Array.isArray(draftState.availablePlayerIds) && draftState.availablePlayerIds.length > 0;
  const availableIds = new Set(hasAvailFilter ? draftState.availablePlayerIds : []);

  const hitterById = new Map();
  for (const row of allHitters) {
    if (!hitterById.has(row.player_id)) hitterById.set(row.player_id, []);
    hitterById.get(row.player_id).push(row);
  }
  const pitcherById = new Map();
  for (const row of allPitchers) {
    if (!pitcherById.has(row.player_id)) pitcherById.set(row.player_id, []);
    pitcherById.get(row.player_id).push(row);
  }
  const poolById = new Map(allPoolPlayers.map((p) => [p.playerId, p]));

  const idsToCheck = targetIds.length ? targetIds : [...poolById.keys()];

  const players = idsToCheck.map((playerId) => {
    const reasons = [];
    const hitterRows = hitterById.get(playerId) || [];
    const pitcherRows = pitcherById.get(playerId) || [];

    if (!poolById.has(playerId)) reasons.push('not_in_player_pool');
    if (!hitterRows.length && !pitcherRows.length) reasons.push('missing_stats_for_season');
    if (purchasedIds.has(playerId)) reasons.push('purchased');
    if (hasAvailFilter && !availableIds.has(playerId)) reasons.push('not_in_availablePlayerIds');

    const hasQualifiedHitting = hitterRows.some((r) => (r.ab ?? 0) >= settings.minAB);
    const hasQualifiedPitching = pitcherRows.some((r) => (r.ip ?? 0) >= settings.minIP);
    if (hitterRows.length && !hasQualifiedHitting) reasons.push(`below_minAB_${settings.minAB}`);
    if (pitcherRows.length && !hasQualifiedPitching) reasons.push(`below_minIP_${settings.minIP}`);
    if (!hasQualifiedHitting && !hasQualifiedPitching && (hitterRows.length || pitcherRows.length)) {
      reasons.push('unscored_profile');
    }

    return {
      playerId,
      name: poolById.get(playerId)?.name || hitterRows[0]?.name || pitcherRows[0]?.name || null,
      includedInResults: reasons.length === 0 || (reasons.length === 1 && reasons[0] === 'unscored_profile'),
      reasons,
    };
  });

  return { season, players };
}

module.exports = {
  runValuations,
  getExclusionDiagnostics,
  computeValuations,
  mergeSettings,
  normalizeLeagueSettings,
  applyDraftStateOverrides,
  computeRemainingSlotsByPosition,
  loadStatRows,
  loadWeightedStatRows,
  loadProjectionRows,
  DEFAULTS,
  HITTER_POSITIONS_SET,
  PITCHER_POSITIONS_SET,
};
