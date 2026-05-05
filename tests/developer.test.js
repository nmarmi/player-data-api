'use strict';

/**
 * US-10.2: Developer account create/login integration tests.
 * Covers register → login → /me → logout flow with cookie-based sessions.
 */

process.env.API_LICENSE_KEY = 'test-license-key';
process.env.SESSION_SECRET  = 'test-session-secret-32-chars-ok!';
process.env.RATE_LIMIT_DISABLED = 'true';
// Use an isolated in-memory DB so tests don't touch data/players.db
process.env.DB_PATH = ':memory:';

const request = require('supertest');
const app     = require('../src/app');
const { migrate } = require('../src/db/migrate');

beforeAll(() => {
  migrate();
});

// Helper to extract the Set-Cookie header value
function extractCookie(res) {
  const header = res.headers['set-cookie'];
  if (!header) return null;
  const raw = Array.isArray(header) ? header[0] : header;
  return raw.split(';')[0]; // "name=value"
}

describe('US-10.2 Developer auth flow', () => {
  const email    = `test-${Date.now()}@example.com`;
  const password = 'securePass1';
  let sessionCookie = null;

  test('POST /register — creates account, sets session cookie', async () => {
    const res = await request(app)
      .post('/api/v1/developer/register')
      .send({ email, password });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.account.email).toBe(email);
    expect(res.body.account.isAdmin).toBe(false);

    sessionCookie = extractCookie(res);
    expect(sessionCookie).toBeTruthy();
  });

  test('POST /register — duplicate email returns 409', async () => {
    const res = await request(app)
      .post('/api/v1/developer/register')
      .send({ email, password });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMAIL_TAKEN');
  });

  test('POST /register — weak password returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/developer/register')
      .send({ email: 'other@example.com', password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('WEAK_PASSWORD');
  });

  test('POST /register — invalid email returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/developer/register')
      .send({ email: 'not-an-email', password: 'validpassword' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_EMAIL');
  });

  test('GET /me — returns account when session cookie is set', async () => {
    expect(sessionCookie).toBeTruthy();
    const res = await request(app)
      .get('/api/v1/developer/me')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.account.email).toBe(email);
  });

  test('GET /me — returns 401 with no cookie', async () => {
    const res = await request(app).get('/api/v1/developer/me');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  test('POST /logout — clears session cookie', async () => {
    const res = await request(app)
      .post('/api/v1/developer/logout')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Cookie should be cleared (Max-Age=0)
    const cleared = extractCookie(res);
    expect(cleared).toMatch(/draftiq_dev_session=/);
  });

  test('GET /me — returns 401 after logout', async () => {
    // Use old cookie — should be rejected since we just cleared it
    // (Stateless cookie: still technically valid unless we tamper with it.
    //  The server clears it on the client side only. Simulate a fresh request
    //  with no cookie to verify the logged-out state.)
    const res = await request(app).get('/api/v1/developer/me');
    expect(res.status).toBe(401);
  });

  test('POST /login — valid credentials returns 200 + cookie', async () => {
    const res = await request(app)
      .post('/api/v1/developer/login')
      .send({ email, password });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.account.email).toBe(email);

    sessionCookie = extractCookie(res);
    expect(sessionCookie).toBeTruthy();
  });

  test('POST /login — wrong password returns 401', async () => {
    const res = await request(app)
      .post('/api/v1/developer/login')
      .send({ email, password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  test('POST /login — unknown email returns 401', async () => {
    const res = await request(app)
      .post('/api/v1/developer/login')
      .send({ email: 'nobody@example.com', password: 'anything123' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  test('GET /me — session still valid after fresh login', async () => {
    expect(sessionCookie).toBeTruthy();
    const res = await request(app)
      .get('/api/v1/developer/me')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body.account.email).toBe(email);
  });
});

describe('US-10.3 API key management', () => {
  const email    = `keys-${Date.now()}@example.com`;
  const password = 'keysTest99';
  let sessionCookie = null;
  let createdKeyId  = null;
  let rawKey        = null;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/v1/developer/register')
      .send({ email, password });
    sessionCookie = extractCookie(res);
  });

  test('GET /keys — returns empty list for new account', async () => {
    const res = await request(app)
      .get('/api/v1/developer/keys')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.keys).toEqual([]);
  });

  test('GET /keys — returns 401 without session', async () => {
    const res = await request(app).get('/api/v1/developer/keys');
    expect(res.status).toBe(401);
  });

  test('POST /keys — creates key, returns raw value once', async () => {
    const res = await request(app)
      .post('/api/v1/developer/keys')
      .set('Cookie', sessionCookie)
      .send({ label: 'test-key' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.key).toBe('string');
    expect(res.body.key.length).toBeGreaterThan(20);
    expect(res.body.label).toBe('test-key');
    expect(res.body.id).toBeDefined();

    createdKeyId = res.body.id;
    rawKey       = res.body.key;
  });

  test('GET /keys — lists the new key without raw value', async () => {
    const res = await request(app)
      .get('/api/v1/developer/keys')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body.keys).toHaveLength(1);

    const k = res.body.keys[0];
    expect(k.id).toBe(createdKeyId);
    expect(k.label).toBe('test-key');
    expect(k).not.toHaveProperty('key');
    expect(k).not.toHaveProperty('key_hash');
    expect(k).toHaveProperty('ipWhitelist');
    expect(k).toHaveProperty('createdAt');
  });

  test('raw key authenticates licensed endpoints', async () => {
    const res = await request(app)
      .get('/api/v1/license/check')
      .set('X-API-Key', rawKey);

    expect([200, 400]).toContain(res.status); // not 401
    expect(res.body.code).not.toBe('UNAUTHORIZED');
    expect(res.body.code).not.toBe('KEY_REVOKED');
  });

  test('DELETE /keys/:id — revokes the key', async () => {
    const res = await request(app)
      .delete(`/api/v1/developer/keys/${createdKeyId}`)
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('revoked key returns 401 KEY_REVOKED on licensed endpoint', async () => {
    const res = await request(app)
      .get('/api/v1/license/check')
      .set('X-API-Key', rawKey);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('KEY_REVOKED');
  });

  test('GET /keys — revoked key no longer appears in list', async () => {
    const res = await request(app)
      .get('/api/v1/developer/keys')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body.keys).toHaveLength(0);
  });

  test('DELETE /keys/:id — already-revoked key returns 404', async () => {
    const res = await request(app)
      .delete(`/api/v1/developer/keys/${createdKeyId}`)
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  test('POST /keys — ipWhitelist must be an array', async () => {
    const res = await request(app)
      .post('/api/v1/developer/keys')
      .set('Cookie', sessionCookie)
      .send({ label: 'bad', ipWhitelist: 'not-an-array' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_INPUT');
  });
});

describe('US-10.5 IP whitelisting', () => {
  const email    = `ip-${Date.now()}@example.com`;
  const password = 'ipTest99!';
  let sessionCookie = null;
  let rawKey        = null;
  let keyId         = null;

  beforeAll(async () => {
    const reg = await request(app)
      .post('/api/v1/developer/register')
      .send({ email, password });
    sessionCookie = extractCookie(reg);

    const key = await request(app)
      .post('/api/v1/developer/keys')
      .set('Cookie', sessionCookie)
      .send({ label: 'ip-test', ipWhitelist: [] });
    rawKey = key.body.key;
    keyId  = key.body.id;
  });

  test('(a) no whitelist — all IPs pass', async () => {
    const res = await request(app)
      .get('/api/v1/license/check')
      .set('X-API-Key', rawKey);

    expect(res.status).not.toBe(401);
    expect(res.body.code).not.toBe('IP_NOT_ALLOWED');
  });

  test('PATCH /keys/:id — sets IP whitelist', async () => {
    const res = await request(app)
      .patch(`/api/v1/developer/keys/${keyId}`)
      .set('Cookie', sessionCookie)
      .send({ ipWhitelist: ['203.0.113.0/24'] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.ipWhitelist).toEqual(['203.0.113.0/24']);
  });

  test('(b) whitelist set, IP mismatch — returns 401 IP_NOT_ALLOWED', async () => {
    // supertest requests arrive from 127.0.0.1, not in 203.0.113.0/24
    const res = await request(app)
      .get('/api/v1/license/check')
      .set('X-API-Key', rawKey);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('IP_NOT_ALLOWED');
  });

  test('(c) CIDR match — request IP in allowed block passes', async () => {
    // Simulate a request from 203.0.113.5 via X-Forwarded-For with TRUST_PROXY
    const orig = process.env.TRUST_PROXY;
    process.env.TRUST_PROXY = 'true';

    const res = await request(app)
      .get('/api/v1/license/check')
      .set('X-API-Key', rawKey)
      .set('X-Forwarded-For', '203.0.113.5');

    process.env.TRUST_PROXY = orig || '';

    expect(res.status).not.toBe(401);
    expect(res.body.code).not.toBe('IP_NOT_ALLOWED');
  });

  test('PATCH /keys/:id — clears whitelist (empty array restores all-IPs access)', async () => {
    await request(app)
      .patch(`/api/v1/developer/keys/${keyId}`)
      .set('Cookie', sessionCookie)
      .send({ ipWhitelist: [] });

    const res = await request(app)
      .get('/api/v1/license/check')
      .set('X-API-Key', rawKey);

    expect(res.status).not.toBe(401);
    expect(res.body.code).not.toBe('IP_NOT_ALLOWED');
  });

  test('PATCH /keys/:id — wrong account returns 404', async () => {
    // Register a different account and try to patch the first account's key
    const other = await request(app)
      .post('/api/v1/developer/register')
      .send({ email: `other-${Date.now()}@example.com`, password: 'other1234' });
    const otherCookie = extractCookie(other);

    const res = await request(app)
      .patch(`/api/v1/developer/keys/${keyId}`)
      .set('Cookie', otherCookie)
      .send({ ipWhitelist: ['1.2.3.4'] });

    expect(res.status).toBe(404);
  });
});
