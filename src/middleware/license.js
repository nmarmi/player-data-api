/**
 * Validates API key from X-API-Key or Authorization: Bearer <key>.
 * Responds with 401 when invalid or missing.
 */
function getValidKeys() {
  const single = process.env.API_LICENSE_KEY;
  if (single) return [single.trim()];
  const list = process.env.VALID_API_KEYS;
  if (list) return list.split(',').map((k) => k.trim()).filter(Boolean);
  return [];
}

function getKeyFromRequest(req) {
  const header = req.get('X-API-Key') || req.get('x-api-key');
  if (header) return header;
  const auth = req.get('Authorization');
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  return null;
}

function requireLicense(req, res, next) {
  const key = getKeyFromRequest(req);
  const validKeys = getValidKeys();
  if (!validKeys.length) {
    return res.status(500).json({ success: false, error: 'License not configured', code: 'LICENSE_NOT_CONFIGURED' });
  }
  if (!key || !validKeys.includes(key)) {
    return res.status(401).json({ success: false, error: 'Invalid or missing license', code: 'UNAUTHORIZED' });
  }
  next();
}

module.exports = { requireLicense, getKeyFromRequest, getValidKeys };
