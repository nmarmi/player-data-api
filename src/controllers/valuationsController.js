/**
 * POST /players/valuations
 *
 * US-5.1: Delegates to the z-score above replacement valuation engine.
 * US-5.3: Accepts both the Draft Kit leagueSettings shape (numberOfTeams,
 *   salaryCap, rosterSlots map, scoringType) and the legacy engine shape
 *   (numTeams, budget, …) via normalizeLeagueSettings.
 * Falls back to a ranking-based placeholder when no player_stats rows exist.
 */

const { runValuations, normalizeLeagueSettings } = require('../services/valuationEngine');
const { loadPlayers }           = require('../services/playersService');
const { getDataFreshnessMeta }  = require('../db/syncLog');

// Sources that feed the valuation engine
const VALUATION_SOURCES = ['player_metadata', 'player_stats'];

function freshness() {
  try { return getDataFreshnessMeta(VALUATION_SOURCES); } catch (_) { return {}; }
}

const DEFAULT_BUDGET       = 260;
const DEFAULT_NUM_TEAMS    = 10;

// ── Placeholder (used only when player_stats table is empty) ─────────────────

function placeholderValuations(players, leagueSettings = {}) {
  if (!Array.isArray(players) || !players.length) return [];

  const budget = Number(leagueSettings.budget) || DEFAULT_BUDGET;
  const numTeams = Number(leagueSettings.numTeams) || DEFAULT_NUM_TEAMS;
  const targetTotal = Math.max(0, budget * numTeams);

  const sorted = [...players].sort((a, b) => {
    const diff = (b.fpts || 0) - (a.fpts || 0);
    return diff !== 0 ? diff : (a.name || '').localeCompare(b.name || '');
  });

  const minFpts = Math.min(...sorted.map((p) => Number(p.fpts) || 0));
  const weights = sorted.map((p) => Math.max(0, (Number(p.fpts) || 0) - minFpts) + 1);
  const weightSum = weights.reduce((s, w) => s + w, 0) || 1;

  const valuations = sorted.map((player, i) => {
    const rawValue = targetTotal * (weights[i] / weightSum);
    const dollarValue = Math.round(rawValue * 100) / 100;
    return { playerId: player.playerId, dollarValue, projectedValue: dollarValue, rank: i + 1 };
  });

  const total = valuations.reduce((s, v) => s + v.dollarValue, 0);
  const diff = Math.round((targetTotal - total) * 100) / 100;
  if (diff !== 0 && valuations.length) {
    valuations[0].dollarValue = Math.round((valuations[0].dollarValue + diff) * 100) / 100;
    valuations[0].projectedValue = valuations[0].dollarValue;
  }
  return valuations;
}

// ── Controller ────────────────────────────────────────────────────────────────

function getValuations(req, res) {
  const { leagueSettings = {}, draftState = {} } = req.body || {};

  // ── Input validation ──────────────────────────────────────────────────────
  // Accept both Draft Kit shape (salaryCap / numberOfTeams) and legacy engine
  // shape (budget / numTeams).  Both are validated under the same rules.
  const errors = [];

  const budgetVal    = leagueSettings.budget    ?? leagueSettings.salaryCap;
  const numTeamsVal  = leagueSettings.numTeams  ?? leagueSettings.numberOfTeams;

  if (budgetVal !== undefined && (isNaN(Number(budgetVal)) || Number(budgetVal) <= 0)) {
    errors.push({ field: 'leagueSettings.budget', message: 'Must be a positive number' });
  }
  if (numTeamsVal !== undefined && (isNaN(Number(numTeamsVal)) || Number(numTeamsVal) <= 0)) {
    errors.push({ field: 'leagueSettings.numTeams', message: 'Must be a positive number' });
  }
  if (leagueSettings.rosterSlots !== undefined) {
    const rs = leagueSettings.rosterSlots;
    const isPositiveNumber = typeof rs === 'number' && Number.isFinite(rs) && rs > 0;
    const isPositionMap =
      rs !== null &&
      typeof rs === 'object' &&
      !Array.isArray(rs) &&
      Object.values(rs).every((v) => Number.isFinite(Number(v)) && Number(v) >= 0);
    if (!isPositiveNumber && !isPositionMap) {
      errors.push({
        field: 'leagueSettings.rosterSlots',
        message: 'Must be a positive number or an object map of position→slotCount',
      });
    }
  }
  if (draftState.availablePlayerIds !== undefined && !Array.isArray(draftState.availablePlayerIds)) {
    errors.push({ field: 'draftState.availablePlayerIds', message: 'Must be an array' });
  }
  if (draftState.purchasedPlayers !== undefined && !Array.isArray(draftState.purchasedPlayers)) {
    errors.push({ field: 'draftState.purchasedPlayers', message: 'Must be an array' });
  }
  if (
    draftState.teamBudgets !== undefined &&
    (typeof draftState.teamBudgets !== 'object' || Array.isArray(draftState.teamBudgets))
  ) {
    errors.push({ field: 'draftState.teamBudgets', message: 'Must be an object mapping teamId to remaining budget' });
  }
  if (errors.length) {
    return res.status(400).json({
      success: false, error: 'Invalid request body', code: 'BAD_REQUEST', fields: errors,
    });
  }

  // US-5.3: normalise the Draft Kit leagueSettings shape before passing to the engine
  const normalizedSettings = normalizeLeagueSettings(leagueSettings);

  // Try the real valuation engine first
  try {
    const { valuations, meta } = runValuations(normalizedSettings, draftState);

    if (valuations.length > 0) {
      return res.json({
        success: true,
        valuations,
        meta,
        ...freshness(),
      });
    }
    // Engine returned nothing (no stats) — fall through to placeholder
  } catch (err) {
    console.error('[valuations] Engine error — falling back to placeholder:', err.message);
  }

  // Placeholder fallback
  const { availablePlayerIds } = draftState;

  let players = loadPlayers();
  if (Array.isArray(availablePlayerIds) && availablePlayerIds.length) {
    const idSet = new Set(availablePlayerIds);
    players = players.filter((p) => idSet.has(p.playerId));
  }

  const valuations = placeholderValuations(players, normalizedSettings);
  const totalValue = valuations.reduce((s, v) => s + (v.dollarValue || 0), 0);
  const numTeams = Number(normalizedSettings.numTeams) || DEFAULT_NUM_TEAMS;
  const budget = Number(normalizedSettings.budget) || DEFAULT_BUDGET;
  return res.json({
    success:    true,
    valuations,
    meta:       {
      note: 'Placeholder valuations — run import-stats to enable the full model',
      valuationCount: valuations.length,
      totalValue,
      targetTotalValue: numTeams * budget,
      calibrationError: Math.round((totalValue - (numTeams * budget)) * 100) / 100,
    },
    ...freshness(),
  });
}

module.exports = { getValuations, placeholderValuations };
