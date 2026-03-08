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

app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json());

app.use('/health', healthRouter);
app.use('/license', licenseRouter);
app.use('/players', playersRouter);
app.use('/usage', usageRouter);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'demo.html'));
});

module.exports = app;
