const mapService = require('../services/maps.service')
const { validationResult, query} = require('express-validator')


module.exports.getCoordinates = async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { address } = req.query;

    try {
        const coordinates = await mapService.getAddressCoordinate(address);
        res.status(200).json(coordinates);
    } catch (error) {
        res.status(404).json({ message: 'Coordinates not found' });
    }
}

module.exports.getDistanceTime = async (req, res, next) => {

    try {

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { origin, destination } = req.query;

        const distanceTime = await mapService.getDistanceTime(origin, destination);

        res.status(200).json(distanceTime);

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
}

module.exports.getAutoCompleteSuggestions = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { input } = req.query;

        const suggestions = await mapService.getAutoCompleteSuggestions(input);

        res.status(200).json({ suggestions });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error', error: err.message });
    }
};

// In map.controller.js
module.exports.getDistanceAndETA = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
  
    const { originLat, originLng, destLat, destLng } = req.query;
  
    try {
      const distanceETA = await mapService.getDistanceAndETA(
        { lat: parseFloat(originLat), lng: parseFloat(originLng) },
        { lat: parseFloat(destLat), lng: parseFloat(destLng) }
      );
      res.status(200).json(distanceETA);
    } catch (err) {
      res.status(500).json({ message: 'Failed to fetch distance and ETA', error: err.message });
    }
  };
  
  // Update exports
  module.exports = {
    getCoordinates: module.exports.getCoordinates,
    getDistanceTime: module.exports.getDistanceTime,
    getAutoCompleteSuggestions: module.exports.getAutoCompleteSuggestions,
    getDistanceAndETA: module.exports.getDistanceAndETA,
  };