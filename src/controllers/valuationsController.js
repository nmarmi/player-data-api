const { loadPlayers } = require('../services/playersService');

const DEFAULT_BUDGET = 260;
const DEFAULT_ROSTER_SLOTS = 23;

/**
 * Placeholder valuation logic: distributes a dollar budget across available
 * players proportional to their fpts rank. When fpts are tied (e.g. all 0),
 * falls back to alphabetical order so rankings are still deterministic.
 */
function computeValuations(players, budget, rosterSlots) {
  const sorted = [...players].sort((a, b) => {
    const diff = (b.fpts || 0) - (a.fpts || 0);
    if (diff !== 0) return diff;
    return (a.name || '').localeCompare(b.name || '');
  });

  // Distribute the full budget among the top N (one per roster slot); rest get $1
  const valuedCount = Math.min(sorted.length, rosterSlots);
  const weightSum = (valuedCount * (valuedCount + 1)) / 2;

  return sorted.map((player, i) => {
    const rank = i + 1;
    let dollarValue;
    if (rank <= valuedCount) {
      const weight = valuedCount - rank + 1;
      dollarValue = Math.max(1, Math.round((weight / weightSum) * budget));
    } else {
      dollarValue = 1;
    }
    return { playerId: player.playerId, dollarValue, rank };
  });
}

function getValuations(req, res) {
  const { leagueSettings = {}, draftState = {} } = req.body || {};

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
  if (validationErrors.length) {
    return res.status(400).json({ success: false, error: 'Invalid request body', code: 'BAD_REQUEST', fields: validationErrors });
  }

  const budget = Number(leagueSettings.budget) || DEFAULT_BUDGET;
  const rosterSlots = Number(leagueSettings.rosterSlots) || DEFAULT_ROSTER_SLOTS;
  const { availablePlayerIds } = draftState;

  let players = loadPlayers();

  if (Array.isArray(availablePlayerIds) && availablePlayerIds.length) {
    const idSet = new Set(availablePlayerIds);
    players = players.filter((p) => idSet.has(p.playerId));
  }

  const valuations = computeValuations(players, budget, rosterSlots);
  res.json({ success: true, valuations });
}

module.exports = { getValuations, computeValuations };
