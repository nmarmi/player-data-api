/**
 * US-8.5: Per-key in-memory rate limiter.
 *
 * Counts requests per API key in a sliding window. When a key exceeds the
 * threshold the response is `429` with a `Retry-After` header (seconds until
 * the window resets) — protects the valuation/recommendation endpoints from
 * accidental DoS during a buggy draft loop.
 *
 * Configurable via env:
 *   RATE_LIMIT_WINDOW_MS         default 60000 (1 minute)
 *   RATE_LIMIT_MAX_PER_WINDOW    default 600   (10 req/sec sustained)
 *   RATE_LIMIT_DISABLED          set to "true" to bypass entirely (tests)
 *
 * In-memory state is fine for the single-process deployment. If the API is
 * ever scaled horizontally, swap this for a Redis-backed counter — the
 * middleware shape stays the same.
 */

const { getKeyFromRequest } = require('./license');
const log = require('../logger').child({ component: 'rate-limit' });

const buckets = new Map(); // key -> { count, windowStart }

function getConfig() {
  const window = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000;
  const max    = Number(process.env.RATE_LIMIT_MAX_PER_WINDOW) || 600;
  const disabled = String(process.env.RATE_LIMIT_DISABLED || '').toLowerCase() === 'true';
  return { windowMs: window, maxPerWindow: max, disabled };
}

function rateLimitByKey(req, res, next) {
  const cfg = getConfig();
  if (cfg.disabled) return next();

  const key = getKeyFromRequest(req);
  if (!key) return next(); // requireLicense will 401 first; rate limit is per-key

  const now = Date.now();
  let bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart >= cfg.windowMs) {
    bucket = { count: 0, windowStart: now };
    buckets.set(key, bucket);
  }

  bucket.count += 1;

  if (bucket.count > cfg.maxPerWindow) {
    const retryAfterMs = cfg.windowMs - (now - bucket.windowStart);
    const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
    res.set('Retry-After', String(retryAfterSec));
    log.warn('rate limit exceeded', { keyPrefix: key.slice(0, 4) + '…', count: bucket.count, max: cfg.maxPerWindow, retryAfterSec });
    return res.status(429).json({
      success: false,
      error: `Rate limit exceeded — ${cfg.maxPerWindow} requests per ${cfg.windowMs / 1000}s`,
      code: 'RATE_LIMITED',
      retryAfterSec,
    });
  }

  next();
}

// Exposed for tests: drop all per-key counters.
function _resetBuckets() {
  buckets.clear();
}

module.exports = { rateLimitByKey, _resetBuckets, getConfig };
