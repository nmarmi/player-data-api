require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

//actual endpoints and handles routing
const healthRouter  = require('./routes/health');
const licenseRouter = require('./routes/license');
const playersRouter = require('./routes/players');
const usageRouter   = require('./routes/usage');
const adminRouter   = require('./routes/admin');

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

// US-2.8: mark legacy unversioned endpoints as deprecated.
app.use((req, res, next) => {
  if (!req.path.startsWith(`/api/${API_VERSION}/`)) {
    res.set('Deprecation', 'true');
    res.set('Sunset', LEGACY_SUNSET);
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

// v1 versioned routes
app.use(`/api/${API_VERSION}/health`, healthRouter);
app.use(`/api/${API_VERSION}/license`, licenseRouter);
app.use(`/api/${API_VERSION}/players`, playersRouter);
app.use(`/api/${API_VERSION}/usage`, usageRouter);
app.use(`/api/${API_VERSION}/admin`, adminRouter);

// Legacy unversioned routes (aliases — kept for backwards compatibility)
app.use('/health', healthRouter);
app.use('/license', licenseRouter);
app.use('/players', playersRouter);
app.use('/usage', usageRouter);
app.use('/admin', adminRouter);

app.use(express.static(path.join(__dirname, '..', 'public')));

//root route
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// 404 — unknown route
app.use((req, res) => {
  res.status(404).json({ success: false, error: `Route not found: ${req.method} ${req.path}`, code: 'NOT_FOUND' });
});

// 500 — unhandled errors
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
});

module.exports = app;
