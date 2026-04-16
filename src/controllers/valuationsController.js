/**
 * POST /players/valuations
 *
 * US-5.1: Delegates to the z-score above replacement valuation engine.
 * Falls back to the ranking-based placeholder when no player_stats rows
 * exist (e.g. before import-stats has been run).
 */

const { runValuations }         = require('../services/valuationEngine');
const { loadPlayers }           = require('../services/playersService');
const { getDataFreshnessMeta }  = require('../db/syncLog');

// Sources that feed the valuation engine
const VALUATION_SOURCES = ['player_metadata', 'player_stats'];

function freshness() {
  try { return getDataFreshnessMeta(VALUATION_SOURCES); } catch (_) { return {}; }
}

const DEFAULT_BUDGET       = 260;
const DEFAULT_ROSTER_SLOTS = 23;

// ── Placeholder (used only when player_stats table is empty) ─────────────────

function placeholderValuations(players, budget, rosterSlots) {
  const sorted = [...players].sort((a, b) => {
    const diff = (b.fpts || 0) - (a.fpts || 0);
    return diff !== 0 ? diff : (a.name || '').localeCompare(b.name || '');
  });

  const valuedCount = Math.min(sorted.length, rosterSlots);
  const weightSum   = (valuedCount * (valuedCount + 1)) / 2;

  return sorted.map((player, i) => {
    const rank = i + 1;
    const dollarValue =
      rank <= valuedCount
        ? Math.max(1, Math.round(((valuedCount - rank + 1) / weightSum) * budget))
        : 1;
    return { playerId: player.playerId, dollarValue, projectedValue: dollarValue, rank };
  });
}

// ── Controller ────────────────────────────────────────────────────────────────

function getValuations(req, res) {
  const { leagueSettings = {}, draftState = {} } = req.body || {};

  // Input validation
  const errors = [];
  if (
    leagueSettings.budget !== undefined &&
    (isNaN(Number(leagueSettings.budget)) || Number(leagueSettings.budget) <= 0)
  ) {
    errors.push({ field: 'leagueSettings.budget', message: 'Must be a positive number' });
  }
  if (
    leagueSettings.rosterSlots !== undefined &&
    (isNaN(Number(leagueSettings.rosterSlots)) || Number(leagueSettings.rosterSlots) <= 0)
  ) {
    errors.push({ field: 'leagueSettings.rosterSlots', message: 'Must be a positive number' });
  }
  if (
    draftState.availablePlayerIds !== undefined &&
    !Array.isArray(draftState.availablePlayerIds)
  ) {
    errors.push({ field: 'draftState.availablePlayerIds', message: 'Must be an array' });
  }
  if (errors.length) {
    return res.status(400).json({
      success: false, error: 'Invalid request body', code: 'BAD_REQUEST', fields: errors,
    });
  }

  // Try the real valuation engine first
  try {
    const { valuations, meta } = runValuations(leagueSettings, draftState);

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
  const budget      = Number(leagueSettings.budget)      || DEFAULT_BUDGET;
  const rosterSlots = Number(leagueSettings.rosterSlots) || DEFAULT_ROSTER_SLOTS;
  const { availablePlayerIds } = draftState;

  let players = loadPlayers();
  if (Array.isArray(availablePlayerIds) && availablePlayerIds.length) {
    const idSet = new Set(availablePlayerIds);
    players = players.filter((p) => idSet.has(p.playerId));
  }

  const valuations = placeholderValuations(players, budget, rosterSlots);
  return res.json({
    success:    true,
    valuations,
    meta:       { note: 'Placeholder valuations — run import-stats to enable the full model' },
    ...freshness(),
  });
}

module.exports = { getValuations, placeholderValuations };
