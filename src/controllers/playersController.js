const {
  loadPlayers,
  buildPlayersQuery,
  applyPlayersQuery,
  getPlayerFilterOptions,
  parseListParam,
} = require('../services/playersService');

// US-4.7: lazily loaded to avoid crashing when DB is unavailable
let _getDataFreshnessMeta = null;
function freshness(sources) {
  if (!_getDataFreshnessMeta) {
    try { _getDataFreshnessMeta = require('../db/syncLog').getDataFreshnessMeta; } catch (_) {}
  }
  if (!_getDataFreshnessMeta) return {};
  return _getDataFreshnessMeta(sources);
}

// Sources that influence the player list / pool / detail responses
const PLAYER_SOURCES = ['player_metadata', 'injuries', 'depth_charts', 'transactions'];

function listPlayers(req, res) {
  const players = loadPlayers();
  const query   = buildPlayersQuery(req.query || {});
  const result  = applyPlayersQuery(players, query);
  res.json({ success: true, ...result, ...freshness(PLAYER_SOURCES) });
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
  res.json({ success: true, player, ...freshness(PLAYER_SOURCES) });
}

function getPlayerPool(req, res) {
  const players   = loadPlayers();
  const positions = parseListParam(req.query.position);

  const pool = positions.length
    ? players.filter((p) => {
        const tokens = Array.isArray(p.positions)
          ? p.positions.map((t) => t.toUpperCase())
          : [];
        return positions.some((pos) => tokens.includes(pos));
      })
    : players;

  res.json({ success: true, players: pool, ...freshness(PLAYER_SOURCES) });
}

module.exports = {
  listPlayers,
  getPlayerFilters,
  getPlayerPool,
  getPlayerById,
};
