require('dotenv').config();
const express = require('express');
const cors = require('cors');
const log = require('./logger').child({ component: 'app' });
const pkg = require('../package.json');

//actual endpoints and handles routing
const healthRouter     = require('./routes/health');
const licenseRouter    = require('./routes/license');
const playersRouter    = require('./routes/players');
const analyticsRouter  = require('./routes/analytics');
const developerRouter  = require('./routes/developer');
const eventsRouter     = require('./routes/events');
const adminRouter      = require('./routes/admin');

const app = express();
//controls who can call your api. The * is anyone good for testing, otherwise restricts frontend domains
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
//supports versioned APIs just in case we make changes later on, so we dont break the app
const API_VERSION = 'v1';
const LEGACY_SUNSET = process.env.LEGACY_API_SUNSET || 'Wed, 31 Dec 2026 23:59:59 GMT';

//middleware : runs before routes
//allows requests from browsers. without this the frontend requests would be blocked
app.use(cors({ origin: ALLOWED_ORIGIN }));
//lets API read json request bodies
app.use(express.json());

// US-10.2: session cookie middleware — populates req.session on every request
const { sessionMiddleware } = require('./middleware/session');
app.use(sessionMiddleware);

// US-10.2: developer portal static UI
const path = require('path');
app.use('/developer-portal', express.static(path.join(__dirname, '../public/developer-portal')));

// US-2.8: mark legacy unversioned endpoints as deprecated.
// Adds Deprecation, Sunset, and Link headers so callers can migrate to /api/v1/*.
// Logs a single warning the first time any legacy route is hit per process.
const LEGACY_MIGRATION_LINK = process.env.LEGACY_API_MIGRATION_LINK || '</docs/migration-v1.md>; rel="deprecation"';
let legacyWarningLogged = false;
app.use((req, res, next) => {
  if (!req.path.startsWith(`/api/${API_VERSION}/`) && req.path !== '/') {
    res.set('Deprecation', 'true');
    res.set('Sunset', LEGACY_SUNSET);
    res.set('Link', LEGACY_MIGRATION_LINK);
    if (!legacyWarningLogged) {
      legacyWarningLogged = true;
      log.warn('legacy route hit', { method: req.method, path: req.path, sunset: LEGACY_SUNSET, hint: `Migrate clients to /api/${API_VERSION}/*` });
    }
  }
  next();
});

// Attach apiVersion to every JSON response
app.use((_req, res, next) => {
  const originalJson = res.json.bind(res);
  //overrides how responses are sent
  res.json = (body) => {
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      body.apiVersion = API_VERSION;
      //essentially adds the api version type to every response
    }
    return originalJson(body);
  };
  next();
  //moves onto middleware/routes
});

// US-8.5: Per-key rate limit applied to all licensed routes. /health is mounted
// before this so external uptime checkers stay exempt.
const { rateLimitByKey } = require('./middleware/rateLimit');

// /health is exempt from license + rate limit so uptime checkers can hit it.
app.use(`/api/${API_VERSION}/health`, healthRouter);
app.use('/health', healthRouter);

// Apply rate limiter ahead of the licensed mounts so 429 fires before route work.
app.use(rateLimitByKey);

// v1 versioned routes
app.use(`/api/${API_VERSION}/license`, licenseRouter);
app.use(`/api/${API_VERSION}/players`, playersRouter);
app.use(`/api/${API_VERSION}/analytics`, analyticsRouter);
app.use(`/api/${API_VERSION}/developer`, developerRouter);
app.use(`/api/${API_VERSION}/events`, eventsRouter);
app.use(`/api/${API_VERSION}/admin`, adminRouter);

// Legacy unversioned routes (aliases — kept for backwards compatibility)
app.use('/license', licenseRouter);
app.use('/players', playersRouter);
app.use('/admin', adminRouter);

// US-9.1: Production API serves only JSON. The demo UI lives in
// `examples/demo-ui/` and is hosted separately (see vercel.json). The Express
// server no longer mounts a static-file middleware.
app.get('/', (_req, res) => {
  res.json({
    success: true,
    service: 'player-data-api',
    name: pkg.name,
    version: pkg.version,
    apiVersion: API_VERSION,
    docs: '/docs/openapi.yaml',
    health: `/api/${API_VERSION}/health`,
    endpoints: {
      players:         `/api/${API_VERSION}/players`,
      pool:            `/api/${API_VERSION}/players/pool`,
      valuations:      `/api/${API_VERSION}/players/valuations`,
      recommendations: `/api/${API_VERSION}/players/recommendations`,
      license:         `/api/${API_VERSION}/license/check`,
      analytics:       `/api/${API_VERSION}/analytics/usage`,
      syncStatus:      `/api/${API_VERSION}/analytics/sync-status`,
      admin:           `/api/${API_VERSION}/admin/refresh`,
    },
  });
});

// 404 — unknown route
app.use((req, res) => {
  res.status(404).json({ success: false, error: `Route not found: ${req.method} ${req.path}`, code: 'NOT_FOUND' });
});

// 500 — unhandled errors
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  log.error('unhandled error', { error: err.message, stack: err.stack, method: req.method, path: req.path });
  res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
});

module.exports = app;
