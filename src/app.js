require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const healthRouter = require('./routes/health');
const licenseRouter = require('./routes/license');
const playersRouter = require('./routes/players');
const usageRouter = require('./routes/usage');

const app = express();
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const API_VERSION = 'v1';

app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json());

// Attach apiVersion to every JSON response
app.use((_req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      body.apiVersion = API_VERSION;
    }
    return originalJson(body);
  };
  next();
});

// v1 versioned routes
app.use(`/api/${API_VERSION}/health`, healthRouter);
app.use(`/api/${API_VERSION}/license`, licenseRouter);
app.use(`/api/${API_VERSION}/players`, playersRouter);
app.use(`/api/${API_VERSION}/usage`, usageRouter);

// Legacy unversioned routes (aliases — kept for backwards compatibility)
app.use('/health', healthRouter);
app.use('/license', licenseRouter);
app.use('/players', playersRouter);
app.use('/usage', usageRouter);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'demo.html'));
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
