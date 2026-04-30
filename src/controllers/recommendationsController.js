'use strict';

/**
 * Recommendation engine — Epic 6
 *
 * US-6.1  getRecommendations  POST /players/recommendations
 *   Returns top N available players ranked by projected value with tier labels.
 *   Delegates to the real valuation engine (US-5.4) for all value computation.
 *   Accepts the Draft Kit leagueSettings shape via normalizeLeagueSettings (US-5.3).
 */

const { runValuations, normalizeLeagueSettings } = require('../services/valuationEngine');

// ── Tier thresholds (returned in every response so the client never re-computes) ──
const BUY_ABOVE   = 15;   // $15+ projected value → "buy"
const AVOID_BELOW =  5;   // $5 or less            → "avoid"
// $6–$14 → "fair"

const DEFAULT_LIMIT = 30;

// ── Helpers ───────────────────────────────────────────────────────────────────

function tierFor(dollarValue) {
  if (dollarValue >= BUY_ABOVE)   return 'buy';
  if (dollarValue <= AVOID_BELOW) return 'avoid';
  return 'fair';
}

function buildReason(dollarValue, tier) {
  if (tier === 'buy')  return `Elite target at $${dollarValue} — top fantasy contributor`;
  if (tier === 'fair') return `Solid value at $${dollarValue} — reliable contributor`;
  return `Limited upside at $${dollarValue} — replacement-level player`;
}

function validateBody(body) {
  const { draftState = {} } = body;
  const errors = [];

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
    errors.push({ field: 'draftState.teamBudgets', message: 'Must be an object' });
  }
  return { errors };
}

// ── US-6.1: Best available recommendations ────────────────────────────────────

function getRecommendations(req, res) {
  const body = req.body || {};
  const { leagueSettings = {}, draftState = {}, teamId } = body;
  const limit = Math.min(Math.max(1, parseInt(body.limit, 10) || DEFAULT_LIMIT), 200);

  const { errors } = validateBody(body);
  if (errors.length) {
    return res.status(400).json({
      success: false, error: 'Invalid request body', code: 'BAD_REQUEST', fields: errors,
    });
  }

  // Normalise the Draft Kit leagueSettings shape before passing to the engine
  const normalizedSettings = normalizeLeagueSettings(leagueSettings);

  let valuations, meta;
  try {
    ({ valuations, meta } = runValuations(normalizedSettings, draftState));
  } catch (err) {
    console.error('[recommendations] Engine error:', err.message);
    return res.status(500).json({
      success: false, error: 'Failed to compute recommendations', code: 'ENGINE_ERROR',
    });
  }

  const thresholds = { buyAbove: BUY_ABOVE, avoidBelow: AVOID_BELOW };

  if (!valuations.length) {
    return res.json({
      success: true, recommendations: [], thresholds, meta: meta || {}, teamId: teamId || null,
    });
  }

  const recommendations = valuations.slice(0, limit).map((v, i) => {
    const tier = tierFor(v.dollarValue);
    return {
      playerId:       v.playerId,
      name:           v.name,
      projectedValue: v.projectedValue,
      recommendedBid: v.dollarValue,
      rank:           i + 1,
      tier,
      reason:         buildReason(v.dollarValue, tier),
    };
  });

  res.json({
    success:         true,
    recommendations,
    thresholds,
    meta:            meta || {},
    teamId:          teamId || null,
  });
}

module.exports = { getRecommendations };
