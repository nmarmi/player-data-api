const express = require('express');
const { requireLicense } = require('../middleware/license');
const { recordUsage, getSyncStatus } = require('../controllers/usageController');

const router = express.Router();

// GET /api/v1/analytics/sync-status — data freshness for all ingestion sources
router.get('/sync-status', requireLicense, getSyncStatus);

// POST /api/v1/analytics/usage — log and persist a usage event
router.post('/usage', requireLicense, recordUsage);

module.exports = router;
