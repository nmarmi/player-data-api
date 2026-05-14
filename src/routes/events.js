const express = require('express');
const { requireLicense } = require('../middleware/license');
const { streamEvents, registerWebhook } = require('../controllers/eventsController');

const router = express.Router();

// GET /api/v1/events/stream — SSE stream of player events
router.get('/stream', requireLicense, streamEvents);

// POST /api/v1/events/webhook — register a webhook URL for this API key
router.post('/webhook', requireLicense, registerWebhook);

module.exports = router;
