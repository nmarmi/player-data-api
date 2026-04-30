'use strict';

/**
 * Recommendation engine — Epic 6
 *
 * US-6.1  getRecommendations  POST /players/recommendations
 *   Returns top N available players ranked by projected value with tier labels.
 *
 * US-6.2  (positional need)   same endpoint, activated when teamId is supplied
 *   Adds positionalNeed + fillsOpenSlot to every recommendation and re-sorts
 *   to favour players that fill the requesting team's open roster slots.
 *   Weighting: 70 % projected-value rank, 30 % positional need (documented below).
 *   Returns 400 / UNKNOWN_TEAM when teamId is not in draftState.teamBudgets.
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

/**
 * Returns the open and total roster slot counts for a team.
 * Requires leagueSettings.rosterSlots to be a position → count map.
 *
 * @returns {{ open: Record<string,number>, total: Record<string,number> }}
 */
function getTeamSlotState(teamId, draftState, leagueSettings) {
  const rosterSlots = (
    leagueSettings.rosterSlots &&
    typeof leagueSettings.rosterSlots === 'object' &&
    !Array.isArray(leagueSettings.rosterSlots)
  ) ? leagueSettings.rosterSlots : {};

  const filledSlots = ((draftState.filledRosterSlots || {})[teamId]) || {};

  const open  = {};
  const total = {};
  for (const [pos, count] of Object.entries(rosterSlots)) {
    const key    = String(pos).toUpperCase();
    const n      = Number(count) || 0;
    const filled = Number(filledSlots[key] || filledSlots[pos] || 0);
    total[key] = n;
    open[key]  = Math.max(0, n - filled);
  }
  return { open, total };
}

/**
 * Computes positionalNeed (0–1) and fillsOpenSlot for a player.
 *
 * positionalNeed = max over the player's eligible positions of
 *   open[pos] / total[pos]
 * A value of 1 means every roster slot at that position is still empty.
 * A value of 0 means no eligible position has an open slot (or rosterSlots
 * was not a map — e.g. legacy flat integer setting).
 */
function playerNeed(playerPositions, openSlots, totalSlots) {
  const positions = (playerPositions || []).map((p) => String(p).toUpperCase());
  let fillsOpenSlot = false;
  let maxNeed = 0;

  for (const pos of positions) {
    const open  = openSlots[pos]  || 0;
    const total = totalSlots[pos] || 0;
    if (open > 0) {
      fillsOpenSlot = true;
      const need = total > 0 ? open / total : 1;
      if (need > maxNeed) maxNeed = need;
    }
  }

  return {
    fillsOpenSlot,
    positionalNeed: Math.round(maxNeed * 100) / 100,
  };
}

function validateBody(body) {
  const { draftState = {}, teamId } = body;
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

  // US-6.2: teamId must be present in teamBudgets when supplied
  if (teamId && draftState.teamBudgets && !(teamId in draftState.teamBudgets)) {
    return {
      errors:    null,
      teamError: {
        success: false,
        error:   `teamId "${teamId}" not found in draftState.teamBudgets`,
        code:    'UNKNOWN_TEAM',
      },
    };
  }

  return { errors, teamError: null };
}

// ── US-6.1 + US-6.2: Best available + positional need ────────────────────────

function getRecommendations(req, res) {
  const body = req.body || {};
  const { leagueSettings = {}, draftState = {}, teamId } = body;
  const limit = Math.min(Math.max(1, parseInt(body.limit, 10) || DEFAULT_LIMIT), 200);

  const { errors, teamError } = validateBody(body);
  if (teamError) return res.status(400).json(teamError);
  if (errors && errors.length) {
    return res.status(400).json({
      success: false, error: 'Invalid request body', code: 'BAD_REQUEST', fields: errors,
    });
  }

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

  // US-6.2: compute team slot state when teamId is present
  let slotState = null;
  if (teamId) {
    slotState = getTeamSlotState(teamId, draftState, leagueSettings);
  }

  // Build recommendation objects — initial rank mirrors the engine's value rank
  let recs = valuations.map((v, i) => {
    const tier = tierFor(v.dollarValue);
    const rec  = {
      playerId:       v.playerId,
      name:           v.name,
      projectedValue: v.projectedValue,
      recommendedBid: v.dollarValue,
      rank:           i + 1,
      tier,
      reason:         buildReason(v.dollarValue, tier),
    };

    if (slotState) {
      // US-6.2: annotate with positional need data for the requesting team
      const need = playerNeed(v.positions, slotState.open, slotState.total);
      rec.positionalNeed = need.positionalNeed;
      rec.fillsOpenSlot  = need.fillsOpenSlot;
    }

    return rec;
  });

  // US-6.2: re-sort when teamId is provided.
  // Blended score = 70 % normalised value rank + 30 % positional need.
  // Players that fill an open slot are always ranked above those that don't.
  if (slotState) {
    const n = recs.length;
    recs.sort((a, b) => {
      if (a.fillsOpenSlot !== b.fillsOpenSlot) return a.fillsOpenSlot ? -1 : 1;
      const aScore = (1 - a.rank / (n + 1)) * 0.7 + (a.positionalNeed || 0) * 0.3;
      const bScore = (1 - b.rank / (n + 1)) * 0.7 + (b.positionalNeed || 0) * 0.3;
      return bScore - aScore;
    });
    recs = recs.map((r, i) => ({ ...r, rank: i + 1 }));
  }

  res.json({
    success:         true,
    recommendations: recs.slice(0, limit),
    thresholds,
    meta:            meta || {},
    teamId:          teamId || null,
  });
}

// ── US-6.3: Nomination suggestions ───────────────────────────────────────────

/**
 * POST /players/recommendations/nominations
 *
 * Strategy (documented per US-6.3):
 *   Rank available players by nominationScore descending, where:
 *     nominationScore = expectedMarketBid − myTeamValueToFill
 *     expectedMarketBid  = player's projected dollar value (what competitors pay)
 *     myTeamValueToFill  = expectedMarketBid × myTeamNeedScore
 *
 *   A high score means other teams will compete hard for a player that the
 *   calling team doesn't actually need — ideal to nominate and drain opponents'
 *   budgets without winning the player yourself.
 *
 * Required inputs: availablePlayerIds, teamBudgets, filledRosterSlots, teamId.
 */
function getNominations(req, res) {
  const body = req.body || {};
  const { leagueSettings = {}, draftState = {}, teamId } = body;
  const limit = Math.min(Math.max(1, parseInt(body.limit, 10) || 15), 100);

  if (!teamId) {
    return res.status(400).json({
      success: false,
      error:   'teamId is required for nomination suggestions',
      code:    'BAD_REQUEST',
      fields:  [{ field: 'teamId', message: 'Required' }],
    });
  }

  const { errors, teamError } = validateBody(body);
  if (teamError) return res.status(400).json(teamError);
  if (errors && errors.length) {
    return res.status(400).json({
      success: false, error: 'Invalid request body', code: 'BAD_REQUEST', fields: errors,
    });
  }

  const normalizedSettings = normalizeLeagueSettings(leagueSettings);

  let valuations, meta;
  try {
    ({ valuations, meta } = runValuations(normalizedSettings, draftState));
  } catch (err) {
    console.error('[nominations] Engine error:', err.message);
    return res.status(500).json({
      success: false, error: 'Failed to compute nominations', code: 'ENGINE_ERROR',
    });
  }

  if (!valuations.length) {
    return res.json({ success: true, nominations: [], meta: meta || {}, teamId });
  }

  const slotState = getTeamSlotState(teamId, draftState, leagueSettings);

  const nominations = valuations
    .map((v) => {
      const { positionalNeed } = playerNeed(v.positions, slotState.open, slotState.total);
      const expectedMarketBid  = v.dollarValue;
      const myTeamNeedScore    = Math.round(positionalNeed * 100) / 100;
      // How much of this player's dollar value is wasted on my team
      const nominationScore    = expectedMarketBid * (1 - myTeamNeedScore);

      const posLabel = (v.positions || []).join('/') || 'UTIL';
      const reason = myTeamNeedScore < 0.2
        ? `My team has ${posLabel} covered — good nomination to spend opponents' budgets`
        : `Moderate need ($${expectedMarketBid} market value may still attract competition)`;

      return {
        playerId:          v.playerId,
        name:              v.name,
        expectedMarketBid,
        myTeamNeedScore,
        _nominationScore:  nominationScore,
        reason,
      };
    })
    .sort((a, b) => b._nominationScore - a._nominationScore)
    .slice(0, limit)
    // Strip the internal sort key before sending
    .map(({ _nominationScore, ...rest }) => rest);

  res.json({ success: true, nominations, meta: meta || {}, teamId });
}

// ── US-6.4: Budget strategy ───────────────────────────────────────────────────

/**
 * POST /players/recommendations/budget
 *
 * Returns a per-position suggested spend allocation across the requesting
 * team's remaining open roster slots.
 *
 * Algorithm (documented per US-6.4):
 *   1. Derive open slots per position from filledRosterSlots[teamId] vs
 *      leagueSettings.rosterSlots.
 *   2. For each open position, find the top-openSlots available players
 *      from the valuation pool.
 *   3. suggestedSpend = min(idealSpend, proportionalCap) where:
 *        idealSpend      = sum of projected values for the slots to fill
 *        proportionalCap = remainingBudget × (openSlots[pos] / totalOpenSlots)
 *      This ensures suggested spend never exceeds the team's remaining budget
 *      and each position gets a proportional share of available funds.
 *   4. topTargets (up to 3) returned per position for display context.
 *      Stateless — each call reflects the draftState snapshot in the request.
 *
 * teamId is required; returns 400/UNKNOWN_TEAM if absent from teamBudgets.
 */
function getBudgetStrategy(req, res) {
  const body = req.body || {};
  const { leagueSettings = {}, draftState = {}, teamId } = body;

  if (!teamId) {
    return res.status(400).json({
      success: false,
      error:   'teamId is required for budget strategy',
      code:    'BAD_REQUEST',
      fields:  [{ field: 'teamId', message: 'Required' }],
    });
  }

  const { errors, teamError } = validateBody(body);
  if (teamError) return res.status(400).json(teamError);
  if (errors && errors.length) {
    return res.status(400).json({
      success: false, error: 'Invalid request body', code: 'BAD_REQUEST', fields: errors,
    });
  }

  const normalizedSettings = normalizeLeagueSettings(leagueSettings);

  let valuations, meta;
  try {
    ({ valuations, meta } = runValuations(normalizedSettings, draftState));
  } catch (err) {
    console.error('[budget-strategy] Engine error:', err.message);
    return res.status(500).json({
      success: false, error: 'Failed to compute budget strategy', code: 'ENGINE_ERROR',
    });
  }

  const remainingBudget = Number((draftState.teamBudgets || {})[teamId] || 0);
  const slotState       = getTeamSlotState(teamId, draftState, leagueSettings);
  const totalOpenSlots  = Object.values(slotState.open).reduce((s, n) => s + n, 0);

  if (totalOpenSlots === 0 || !valuations.length) {
    return res.json({
      success: true, allocations: [], remainingBudget, meta: meta || {}, teamId,
    });
  }

  const allocations = Object.entries(slotState.open)
    .filter(([, openCount]) => openCount > 0)
    .map(([pos, openCount]) => {
      // Players eligible for this position, best value first
      const eligible = valuations.filter((v) =>
        (v.positions || []).some((p) => String(p).toUpperCase() === pos)
      );

      // Players needed to fill open slots (for spend calculation)
      const toFill  = eligible.slice(0, openCount);
      // Up to 3 for display
      const display = eligible.slice(0, 3);

      const idealSpend       = toFill.reduce((s, v) => s + v.dollarValue, 0);
      const proportionalCap  = Math.round(remainingBudget * (openCount / totalOpenSlots));
      const suggestedSpend   = Math.min(idealSpend, proportionalCap);

      return {
        position:      pos,
        openSlots:     openCount,
        suggestedSpend,
        topTargets:    display.map((v) => ({
          playerId:       v.playerId,
          name:           v.name,
          projectedValue: v.projectedValue,
        })),
      };
    })
    .sort((a, b) => b.suggestedSpend - a.suggestedSpend);

  res.json({
    success:         true,
    allocations,
    remainingBudget,
    meta:            meta || {},
    teamId,
  });
}

module.exports = { getRecommendations, getNominations, getBudgetStrategy };
