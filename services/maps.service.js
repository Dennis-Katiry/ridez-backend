const axios = require('axios');
const captainModel = require('../models/captain.model');

module.exports.getAddressCoordinate = async (address) => {
    const apiKey = process.env.GOOGLE_MAPS_API;
    if (!apiKey) {
        console.error('Google Maps API key is missing');
        throw new Error('Server configuration error: Missing API key');
    }

    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;

    try {
        const response = await axios.get(url);
        console.log('Geocoding response for:', address, response.data); 

        if (response.data.status === 'OK' && response.data.results.length > 0) {
            const location = response.data.results[0].geometry.location;
            return {
                lat: location.lat, 
                lng: location.lng
            };
        } else {
            console.error('Geocoding failed:', {
                status: response.data.status,
                error_message: response.data.error_message || 'No results found'
            });
            return null;
        }
    } catch (error) {
        console.error('Error in getAddressCoordinate:', error.message);
        return null; 
    }
};

module.exports.getDistanceTime = async (origin, destination) => {
    if (!origin || !destination) {
        throw new Error('Origin and destination are required');
    }

    const apiKey = process.env.GOOGLE_MAPS_API;
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(destination)}&key=${apiKey}`;

    try {
        const response = await axios.get(url);
        if (response.data.status === 'OK') {
            if (response.data.rows[0].elements[0].status === 'ZERO_RESULTS') {
                throw new Error('No routes found');
            }
            return response.data.rows[0].elements[0];
        } else {
            throw new Error('Unable to fetch distance and time');
        }
    } catch (err) {
        console.error(err);
        throw err;
    }
};

module.exports.getAutoCompleteSuggestions = async (input) => {
    if (!input) {
        throw new Error('Query input is required');
    }

    const apiKey = process.env.GOOGLE_MAPS_API;
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&key=${apiKey}&language=en`;

    try {
        const response = await axios.get(url);
        if (response.data.status === 'OK') {
            return response.data.predictions.map(prediction => ({
                description: prediction.description,
                terms: prediction.terms,
                structured_formatting: prediction.structured_formatting,
                place_id: prediction.place_id
            }));
        } else {
            throw new Error(`Google API Error: ${response.data.status}`);
        }
    } catch (err) {
        console.error(err);
        throw err;
    }
};

module.exports.getCaptainsInTheRadius = async (lat, lng, radius) => {
    try {
        const captains = await captainModel.find({
            location: {
                $geoWithin: {
                    $centerSphere: [[lng, lat], radius / 6371] // [lng, lat]
                }
            }
        });
        return captains;
    } catch (error) {
        console.error('Error in getCaptainsInTheRadius:', error.message);
        return []; // Fallback to empty array
    }
};

module.exports.getDistanceAndETA = async (originLatLng, destinationLatLng) => {
    const apiKey = process.env.GOOGLE_MAPS_API;
    const origin = `${originLatLng.lat},${originLatLng.lng}`;
    const destination = `${destinationLatLng.lat},${destinationLatLng.lng}`;
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(destination)}&key=${apiKey}`;

    try {
        const response = await axios.get(url);
        if (response.data.status === 'OK' && response.data.rows[0].elements[0].status === 'OK') {
            const element = response.data.rows[0].elements[0];
            return {
                distance: element.distance.text,
                duration: element.duration.text,
            };
        } else {
            throw new Error('Unable to calculate distance and ETA');
        }
    } catch (error) {
        console.error('Error fetching distance and ETA:', error);
        throw error;
    }
};