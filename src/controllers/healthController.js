function getHealth(_req, res) {
  res.json({ success: true, status: 'ok', service: 'player-data-api' });
}

module.exports = { getHealth };
