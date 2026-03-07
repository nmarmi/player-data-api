function recordUsage(req, res) {
  const { event, timestamp, metadata } = req.body || {};
  const payload = {
    event: event || 'unknown',
    timestamp: timestamp || new Date().toISOString(),
    metadata: metadata || {},
  };

  // Log to stdout for demo; could append to file or store in DB later
  console.log('[usage]', JSON.stringify(payload));
  res.status(200).json({ success: true, message: 'Recorded' });
}

module.exports = { recordUsage };
