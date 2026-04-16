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

  // Only value the top N players (one per roster slot), rest get $1
  const valuedCount = Math.min(sorted.length, rosterSlots);
  // Sum of weights 1..valuedCount for proportional distribution
  const weightSum = (valuedCount * (valuedCount + 1)) / 2;
  // Reserve $1 per remaining player so the total budget is realistic
  const reservedForRest = Math.max(0, sorted.length - valuedCount);
  const distributable = Math.max(0, budget - reservedForRest);

  return sorted.map((player, i) => {
    const rank = i + 1;
    let dollarValue;
    if (rank <= valuedCount) {
      const weight = valuedCount - rank + 1;
      dollarValue = Math.max(1, Math.round((weight / weightSum) * distributable));
    } else {
      dollarValue = 1;
    }
    return { playerId: player.playerId, dollarValue, rank };
  });
}

function getValuations(req, res) {
  const { leagueSettings = {}, draftState = {} } = req.body || {};
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

module.exports = { getValuations };
