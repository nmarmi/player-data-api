const {
  loadPlayers,
  buildPlayersQuery,
  applyPlayersQuery,
  getPlayerFilterOptions,
  parseListParam,
} = require('../services/playersService');

function listPlayers(req, res) {
  const players = loadPlayers();
  const query = buildPlayersQuery(req.query || {});
  const result = applyPlayersQuery(players, query);
  res.json({ success: true, ...result });
}

function getPlayerFilters(_req, res) {
  const players = loadPlayers();
  const filters = getPlayerFilterOptions(players);
  res.json({ success: true, filters });
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

  res.json({ success: true, players: pool });
}

module.exports = {
  listPlayers,
  getPlayerFilters,
  getPlayerPool,
};
