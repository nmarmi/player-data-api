const { loadPlayers } = require('../services/playersService');
const { computeValuations } = require('./valuationsController');

const DEFAULT_BUDGET = 260;
const DEFAULT_ROSTER_SLOTS = 23;

/**
 * Placeholder recommendation logic:
 * 1. Compute placeholder dollar values for all available players (reuses valuation logic).
 * 2. Compare each player's dollarValue against the market price (default $1 if unknown).
 * 3. Recommend players where dollarValue > marketPrice (value above cost).
 * 4. Sort by value surplus descending.
 */
function getRecommendations(req, res) {
  const { leagueSettings = {}, draftState = {}, teamId } = req.body || {};

  const validationErrors = [];
  if (leagueSettings.budget !== undefined && (isNaN(Number(leagueSettings.budget)) || Number(leagueSettings.budget) <= 0)) {
    validationErrors.push({ field: 'leagueSettings.budget', message: 'Must be a positive number' });
  }
  if (leagueSettings.rosterSlots !== undefined && (isNaN(Number(leagueSettings.rosterSlots)) || Number(leagueSettings.rosterSlots) <= 0)) {
    validationErrors.push({ field: 'leagueSettings.rosterSlots', message: 'Must be a positive number' });
  }
  if (draftState.availablePlayerIds !== undefined && !Array.isArray(draftState.availablePlayerIds)) {
    validationErrors.push({ field: 'draftState.availablePlayerIds', message: 'Must be an array' });
  }
  if (draftState.marketPrices !== undefined && (typeof draftState.marketPrices !== 'object' || Array.isArray(draftState.marketPrices))) {
    validationErrors.push({ field: 'draftState.marketPrices', message: 'Must be an object mapping playerId to price' });
  }
  if (validationErrors.length) {
    return res.status(400).json({ success: false, error: 'Invalid request body', code: 'BAD_REQUEST', fields: validationErrors });
  }

  const budget = Number(leagueSettings.budget) || DEFAULT_BUDGET;
  const rosterSlots = Number(leagueSettings.rosterSlots) || DEFAULT_ROSTER_SLOTS;
  const { availablePlayerIds, marketPrices = {} } = draftState;

  let players = loadPlayers();

  if (Array.isArray(availablePlayerIds) && availablePlayerIds.length) {
    const idSet = new Set(availablePlayerIds);
    players = players.filter((p) => idSet.has(p.playerId));
  }

  const valuations = computeValuations(players, budget, rosterSlots);

  const recommendations = valuations
    .map((v) => {
      const marketPrice = Number(marketPrices[v.playerId]) || 1;
      const surplus = v.dollarValue - marketPrice;
      return {
        playerId: v.playerId,
        recommendedBid: v.dollarValue,
        reason: surplus > 0
          ? `Valued at $${v.dollarValue} vs market $${marketPrice} (+$${surplus} surplus)`
          : `At or below market value ($${v.dollarValue})`,
        surplus,
      };
    })
    .filter((r) => r.surplus > 0)
    .sort((a, b) => b.surplus - a.surplus)
    .map(({ surplus, ...r }) => r);

  res.json({ success: true, recommendations, teamId: teamId || null });
}

module.exports = { getRecommendations };
