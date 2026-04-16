const {
  loadPlayers,
  buildPlayersQuery,
  applyPlayersQuery,
  getPlayerFilterOptions,
  parseListParam,
} = require('../services/playersService');

let _getSyncStatus = null;
function getInjuriesLastUpdated() {
  if (!_getSyncStatus) {
    try { _getSyncStatus = require('../db/syncLog').getSyncStatus; } catch (_) {}
  }
  try {
    if (!_getSyncStatus) return null;
    const row = _getSyncStatus().find((s) => s.source === 'injuries');
    return row ? { lastSyncAt: row.lastSyncAt, isStale: row.isStale } : null;
  } catch (_) { return null; }
}

function listPlayers(req, res) {
  const players = loadPlayers();
  const query = buildPlayersQuery(req.query || {});
  const result = applyPlayersQuery(players, query);
  res.json({ success: true, ...result, injuries: getInjuriesLastUpdated() });
}

function getPlayerFilters(_req, res) {
  const players = loadPlayers();
  const filters = getPlayerFilterOptions(players);
  res.json({ success: true, filters });
}

function getPlayerById(req, res) {
  const players = loadPlayers();
  const { playerId } = req.params;
  const player = players.find((p) => p.playerId === playerId);
  if (!player) {
    return res.status(404).json({ success: false, error: 'Player not found', code: 'NOT_FOUND' });
  }
  res.json({ success: true, player });
}

function getPlayerPool(req, res) {
  const players = loadPlayers();
  const positions = parseListParam(req.query.position);

  const pool = positions.length
    ? players.filter((p) => {
        const tokens = Array.isArray(p.positions)
          ? p.positions.map((t) => t.toUpperCase())
          : [];
        return positions.some((pos) => tokens.includes(pos));
      })
    : players;

  res.json({ success: true, players: pool, injuries: getInjuriesLastUpdated() });
}

module.exports = {
  listPlayers,
  getPlayerFilters,
  getPlayerPool,
  getPlayerById,
};
