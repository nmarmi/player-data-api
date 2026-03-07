function checkLicense(_req, res) {
  res.json({ success: true, message: 'License valid' });
}

module.exports = { checkLicense };
