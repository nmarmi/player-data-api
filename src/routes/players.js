const express = require('express');
const { requireLicense } = require('../middleware/license');
const { listPlayers, getPlayerFilters, getPlayerPool, getPlayerById } = require('../controllers/playersController');
const { getValuations } = require('../controllers/valuationsController');

const router = express.Router();

router.get('/filters', requireLicense, getPlayerFilters);
router.get('/pool', requireLicense, getPlayerPool);
router.post('/valuations', requireLicense, getValuations);
router.get('/:playerId', requireLicense, getPlayerById);
router.get('/', requireLicense, listPlayers);

module.exports = router;
