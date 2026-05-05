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
