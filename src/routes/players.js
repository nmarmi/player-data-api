const express = require('express');
const { requireLicense } = require('../middleware/license');
const { listPlayers, getPlayerFilters, getPlayerPool, getPlayerById } = require('../controllers/playersController');
const { getValuations } = require('../controllers/valuationsController');
const { getRecommendations } = require('../controllers/recommendationsController');

const router = express.Router();

router.get('/filters', requireLicense, getPlayerFilters);
router.get('/pool', requireLicense, getPlayerPool);
router.post('/valuations', requireLicense, getValuations);
router.post('/recommendations', requireLicense, getRecommendations);
router.get('/:playerId', requireLicense, getPlayerById);
router.get('/', requireLicense, listPlayers);

module.exports = router;
