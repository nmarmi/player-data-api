/**
 * US-10.2: Stateless signed-cookie session — no external dependency needed.
 *
 * Cookie format: base64url(JSON) + "." + HMAC-SHA256 signature
 * SESSION_SECRET env var signs/verifies the cookie. Warn loudly on default.
 *
 * Attaches req.session = { id, email, isAdmin } when valid; null otherwise.
 */
const crypto = require('crypto');

const COOKIE_NAME = 'draftiq_dev_session';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

function getSecret() {
  if (!process.env.SESSION_SECRET) {
    // Rotate on every restart in dev — warn so operators notice.
    if (!_warned) {
      _warned = true;
      require('../logger').warn('SESSION_SECRET not set — sessions will not survive restarts', {
        hint: 'Set SESSION_SECRET in .env for persistent sessions',
      });
    }
    return _devSecret;
  }
  return process.env.SESSION_SECRET;
}
let _warned = false;
const _devSecret = crypto.randomBytes(32).toString('hex');

function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verify(token) {
  if (!token || !token.includes('.')) return null;
  const lastDot = token.lastIndexOf('.');
  const data = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  const expected = crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'base64url'), Buffer.from(expected, 'base64url'))) return null;
    return JSON.parse(Buffer.from(data, 'base64url').toString());
  } catch (_) {
    return null;
  }
}

/** Middleware — populates req.session from cookie. */
function sessionMiddleware(req, _res, next) {
  const raw = parseCookie(req.headers.cookie || '')[COOKIE_NAME];
  req.session = raw ? verify(raw) : null;
  next();
}

/** Set the session cookie on the response. */
function setSession(res, payload) {
  const token = sign(payload);
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE / 1000}; Path=/`);
}

/** Clear the session cookie. */
function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Max-Age=0; Path=/`);
}

/** Require a valid session or respond 401. */
function requireSession(req, res, next) {
  if (!req.session) {
    return res.status(401).json({ success: false, error: 'Not authenticated', code: 'UNAUTHENTICATED' });
  }
  next();
}

function parseCookie(str) {
  return str.split(';').reduce((acc, part) => {
    const [k, ...v] = part.trim().split('=');
    if (k) acc[k.trim()] = decodeURIComponent(v.join('='));
    return acc;
  }, {});
}

module.exports = { sessionMiddleware, setSession, clearSession, requireSession, sign, verify };
