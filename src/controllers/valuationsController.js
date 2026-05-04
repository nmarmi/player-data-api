/**
 * POST /players/valuations
 *
 * US-5.1: Delegates to the z-score above replacement valuation engine.
 * US-5.3: Accepts both the Draft Kit leagueSettings shape (numberOfTeams,
 *   salaryCap, rosterSlots map, scoringType) and the legacy engine shape
 *   (numTeams, budget, …) via normalizeLeagueSettings.
 * Falls back to a ranking-based placeholder when no player_stats rows exist.
 */

const {
  runValuations,
  normalizeLeagueSettings,
  getExclusionDiagnostics,
} = require('../services/valuationEngine');
const { getDataFreshnessMeta }  = require('../db/syncLog');
const log = require('../logger').child({ component: 'valuations' });

// Sources that feed the valuation engine
const VALUATION_SOURCES = ['player_metadata', 'player_stats'];

function freshness() {
  try { return getDataFreshnessMeta(VALUATION_SOURCES); } catch (_) { return {}; }
}

// ── Controller ────────────────────────────────────────────────────────────────

function getValuations(req, res) {
  const { leagueSettings = {}, draftState = {} } = req.body || {};
  const query = req.query || {};
  const debugExclusions = query.debugExclusions === 'true' || req.body?.debugExclusions === true;
  const debugPlayerIdsRaw = query.debugPlayerIds || req.body?.debugPlayerIds || req.body?.debugPlayerId;
  const debugPlayerIds = Array.isArray(debugPlayerIdsRaw)
    ? debugPlayerIdsRaw
    : (typeof debugPlayerIdsRaw === 'string' && debugPlayerIdsRaw.trim()
      ? debugPlayerIdsRaw.split(',').map((v) => v.trim()).filter(Boolean)
      : []);

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
      const debug = debugExclusions
        ? getExclusionDiagnostics(normalizedSettings, draftState, { playerIds: debugPlayerIds })
        : null;
      return res.json({
        success: true,
        valuations,
        meta,
        ...(debug ? { debug } : {}),
        ...freshness(),
      });
    }
    // DB-only mode: no valuation stats available.
    return res.status(503).json({
      success: false,
      error: 'No player stats available in database. Run ingestion jobs first.',
      code: 'STATS_UNAVAILABLE',
      ...(debugExclusions ? {
        debug: getExclusionDiagnostics(normalizedSettings, draftState, { playerIds: debugPlayerIds }),
      } : {}),
      ...freshness(),
    });
  } catch (err) {
    log.error('engine error', { error: err.message, stack: err.stack });
    return res.status(500).json({
      success: false,
      error: 'Failed to compute valuations',
      code: 'ENGINE_ERROR',
      ...(debugExclusions ? {
        debug: getExclusionDiagnostics(normalizedSettings, draftState, { playerIds: debugPlayerIds }),
      } : {}),
      ...freshness(),
    });
  }
}

module.exports = { getValuations };
