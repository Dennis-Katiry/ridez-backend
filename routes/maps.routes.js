const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const mapController = require('../controllers/map.controller');
const { query } = require('express-validator');

router.get(
  '/get-coordinates',
  query('address').isString().isLength({ min: 3 }),
  authMiddleware.authUser,
  mapController.getCoordinates
);

router.get(
  '/get-distance-time',
  query('origin').isString().isLength({ min: 3 }),
  query('destination').isString().isLength({ min: 3 }),
  authMiddleware.authUser,
  mapController.getDistanceTime
);

router.get(
  '/get-suggestions',
  query('input').isString().isLength({ min: 3 }),
  authMiddleware.authUser,
  mapController.getAutoCompleteSuggestions
);

router.get(
  '/get-distance-eta',
  [
    query('originLat').isFloat().withMessage('Invalid origin latitude'),
    query('originLng').isFloat().withMessage('Invalid origin longitude'),
    query('destLat').isFloat().withMessage('Invalid destination latitude'),
    query('destLng').isFloat().withMessage('Invalid destination longitude'),
  ],
  authMiddleware.authUserOrCaptain, 
  mapController.getDistanceAndETA
);

module.exports = router;