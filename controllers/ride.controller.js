const rideService = require('../services/ride.service');
const { validationResult } = require('express-validator');
const mapService = require('../services/maps.service');
const rideModel = require('../models/ride.model');
const captainModel = require('../models/captain.model');

const createRide = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.log('Validation errors:', errors.array());
    return res.status(400).json({ errors: errors.array() });
  }

  const { pickup, destination, vehicleType, scheduledTime } = req.body;
  console.log('Received createRide request:', { pickup, destination, vehicleType, scheduledTime, userId: req.user._id });

  try {
    const io = req.app.get('socketio');
    if (!io) throw new Error('Socket.IO not initialized');

    let ride = await rideService.createRide({
      user: req.user._id,
      pickup,
      destination,
      vehicleType,
      scheduledTime,
      io,
    });
    if (!ride) throw new Error('Ride creation returned null');
    console.log('Ride created:', ride);

    const rideWithUser = await rideModel.findOne({ _id: ride._id }).populate('user');
    if (!rideWithUser) throw new Error('Ride not found after creation');
    console.log('Ride with user populated:', rideWithUser);

    if (ride.isScheduled) {
      return res.status(201).json({
        message: 'Scheduled ride created, awaiting admin assignment',
        ride: rideWithUser,
      });
    }

    let pickupCoordinates;
    try {
      pickupCoordinates = await mapService.getAddressCoordinate(pickup);
      console.log('Pickup coordinates:', pickupCoordinates);
    } catch (coordErr) {
      console.warn('Failed to get pickup coordinates:', coordErr.message);
      pickupCoordinates = null;
    }

    let onlineCaptains = [];
    if (pickupCoordinates) {
      let captainsInRadius = await mapService.getCaptainsInTheRadius(
        pickupCoordinates.lat,
        pickupCoordinates.lng,
        2
      );
      console.log('Captains in radius:', captainsInRadius);

      const captainVehicleType = vehicleType === 'moto' ? 'motorcycle' : vehicleType;

      onlineCaptains = await captainModel
        .find({
          _id: { $in: captainsInRadius.map((captain) => captain._id) },
          isOnline: true,
          'vehicle.vehicleType': captainVehicleType,
        })
        .select('socketId _id');
      console.log('Online captains with matching vehicleType:', onlineCaptains);
    }

    if (onlineCaptains.length === 0) {
      return res.status(201).json({
        message: 'Ride created, but no online captains available at the moment',
        ride: rideWithUser,
      });
    }

    console.log('Emitting ride-request to specific captains');
    onlineCaptains.forEach((captain) => {
      if (captain.socketId) {
        io.to(captain.socketId).emit('ride-request', {
          rideId: ride._id,
          userLocation: pickupCoordinates || { lat: null, lng: null },
          pickup: ride.pickup,
          destination: ride.destination,
          fare: ride.fare,
          userId: req.user._id,
          vehicleType: ride.vehicleType,
        });
        console.log(`Ride request sent to captain ${captain._id} with socketId ${captain.socketId}`);
      }
    });

    return res.status(201).json({
      message: 'Ride created and captains notified',
      ride: rideWithUser,
    });
  } catch (err) {
    console.error('Error in createRide:', err);
    // Check if it's a user-related error (like deactivation) and send 400, otherwise 500
    if (err.message === 'Your account is deactivated. You cannot create rides.') {
      return res.status(400).json({ message: err.message });
    }
    return res.status(500).json({ message: 'Failed to create ride', error: err.message });
  }
};

const getFare = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { pickup, destination } = req.query;

  try {
    const fare = await rideService.getFare(pickup, destination);
    return res.status(200).json(fare);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const confirmRide = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.log('Validation errors in confirmRide:', errors.array());
    return res.status(400).json({ errors: errors.array() });
  }
  const { rideId } = req.body;
  console.log('Confirming ride:', { rideId });
  try {
    const io = req.app.get('socketio');
    if (!io) throw new Error('Socket.IO not initialized');

    const ride = await rideService.confirmRide({ rideId, captain: req.captain, io });
    if (ride.serviceType === 'taxiPool') {
      ride.users.forEach(userEntry => {
        const user = userEntry.userId;
        if (user.socketId) {
          io.to(user.socketId).emit('ride-confirmed', ride);
        }
      });
    } else {
      if (ride.user.socketId) {
        io.to(ride.user.socketId).emit('ride-confirmed', ride);
      }
    }
    return res.status(200).json(ride);
  } catch (err) {
    console.error('Error in confirmRide:', err);
    return res.status(500).json({ message: err.message });
  }
};

const startRide = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.log('Validation errors in startRide:', errors.array());
    return res.status(400).json({ errors: errors.array() });
  }

  const { rideId, otp } = req.query;
  console.log('Received startRide request:', { rideId, otp, captainId: req.captain._id });

  try {
    const io = req.app.get('socketio');
    if (!io) throw new Error('Socket.IO not initialized');

    const ride = await rideService.startRide({ rideId, otp, captain: req.captain, io });
    console.log('Ride started successfully:', ride);

    if (ride.serviceType === 'taxiPool') {
      ride.users.forEach(userEntry => {
        const user = userEntry.userId;
        if (user.socketId) {
          io.to(user.socketId).emit('ride-started', ride);
        }
      });
    } else {
      if (ride.user.socketId) {
        console.log('Emitting ride-started to:', ride.user.socketId);
        io.to(ride.user.socketId).emit('ride-started', ride);
      } else {
        console.error('User socketId missing for ride:', ride._id);
      }
    }

    return res.status(200).json(ride);
  } catch (err) {
    console.error('Error in startRide:', err.message);
    if (err.message === 'Invalid OTP') {
      return res.status(401).json({ message: 'Invalid OTP' });
    }
    return res.status(500).json({ message: err.message });
  }
};

const endRide = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { rideId } = req.body;

  try {
    const io = req.app.get('socketio');
    if (!io) throw new Error('Socket.IO not initialized');

    const ride = await rideService.endRide({ rideId, captain: req.captain, io });

    if (ride.serviceType === 'taxiPool') {
      ride.users.forEach(userEntry => {
        const user = userEntry.userId;
        if (user.socketId) {
          io.to(user.socketId).emit('ride-ended', ride);
        }
      });
    } else {
      if (ride.user.socketId) {
        io.to(ride.user.socketId).emit('ride-ended', ride);
      }
    }

    return res.status(200).json(ride);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const cancelRide = async (req, res) => {
  try {
    console.log('Cancel ride request received:', req.body, req.headers, req.user);
    const io = req.app.get('socketio');
    if (!io) throw new Error('Socket.IO not initialized');

    const ride = await rideService.cancelRide({
      rideId: req.body.rideId,
      user: req.user,
      io,
    });
    console.log('Ride cancelled successfully in controller:', ride);
    res.status(200).json({ message: 'Ride cancelled successfully', ride });
  } catch (error) {
    console.error('Error in cancelRide controller:', error.message);
    res.status(400).json({ error: error.message });
  }
};

const getRideStatus = async (req, res) => {
  try {
    const ride = await rideService.getRideStatus({ rideId: req.query.rideId, user: req.user });
    res.status(200).json({ status: ride.status });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const createPaymentOrder = async (req, res) => {
  try {
    const { rideId } = req.body;
    const user = req.user;
    const order = await rideService.createPaymentOrder({ rideId, user });
    res.status(200).json(order);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const verifyPayment = async (req, res) => {
  try {
    const { rideId, paymentId, orderId, signature } = req.body;
    const user = req.user;
    const io = req.app.get('socketio');
    if (!io) throw new Error('Socket.IO not initialized');

    const updatedRide = await rideService.verifyPayment({ rideId, paymentId, orderId, signature, user, io });
    res.status(200).json({ message: 'Payment verified', ride: updatedRide });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getCaptainStats = async (req, res) => {
  try {
    const stats = await rideService.getCaptainStats(req.captain._id);
    res.status(200).json(stats);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const submitFeedback = async (req, res) => {
  try {
    const { rideId, rating } = req.body;
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }
    const io = req.app.get('socketio');
    if (!io) throw new Error('Socket.IO not initialized');

    const result = await rideService.submitFeedback({ rideId, rating, user: req.user, io });
    res.status(200).json({ message: 'Feedback submitted successfully', result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getUserRideHistory = async (req, res) => {
  try {
    const rides = await rideService.getUserRideHistory(req.user._id);
    res.status(200).json(rides);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const emitServiceStatsUpdate = async (req, res) => {
  try {
    const io = req.app.get('socketio');
    if (!io) throw new Error('Socket.IO not initialized');

    const rides = await rideModel.find().lean();
    const captains = await captainModel.find().select('-password').lean();
    const servicesStatus = await serviceModel.find().lean();

    const mapVehicleType = (vehicleType) => {
      if (vehicleType === 'motorcycle') return 'motorcycle';
      return vehicleType;
    };

    const revenueByService = {
      'Bike Ride': rides
        .filter(ride => ride.vehicleType === 'motorcycle' && ride.status === 'completed' && ride.paymentStatus === 'completed')
        .reduce((sum, ride) => sum + (ride.fare || 0), 0),
      'Car': rides
        .filter(ride => ride.vehicleType === 'car' && ride.status === 'completed' && ride.paymentStatus === 'completed')
        .reduce((sum, ride) => sum + (ride.fare || 0), 0),
      'Taxi Ride': rides
        .filter(ride => ride.vehicleType === 'auto' && ride.status === 'completed' && ride.paymentStatus === 'completed')
        .reduce((sum, ride) => sum + (ride.fare || 0), 0),
      'Intercity': rides
        .filter(ride => ride.serviceType === 'intercity' && ride.status === 'completed' && ride.paymentStatus === 'completed')
        .reduce((sum, ride) => sum + (ride.fare || 0), 0),
      'Taxi Booking': rides
        .filter(ride => ride.serviceType === 'taxiBooking' && ride.status === 'completed' && ride.paymentStatus === 'completed')
        .reduce((sum, ride) => sum + (ride.fare || 0), 0),
      'Taxi Pool': rides
        .filter(ride => ride.serviceType === 'taxiPool' && ride.status === 'completed' && ride.paymentStatus === 'completed')
        .reduce((sum, ride) => sum + (ride.fare || 0), 0),
    };

    const activeDriversByService = {
      'Bike Ride': captains.filter(captain => captain.isOnline && mapVehicleType(captain.vehicle?.vehicleType) === 'motorcycle').length,
      'Car': captains.filter(captain => captain.isOnline && mapVehicleType(captain.vehicle?.vehicleType) === 'car').length,
      'Taxi Ride': captains.filter(captain => captain.isOnline && mapVehicleType(captain.vehicle?.vehicleType) === 'auto').length,
      'Intercity': captains.filter(captain => captain.isOnline && mapVehicleType(captain.vehicle?.vehicleType) === 'car').length,
      'Taxi Booking': captains.filter(captain => captain.isOnline && mapVehicleType(captain.vehicle?.vehicleType) === 'auto').length,
      'Taxi Pool': captains.filter(captain => captain.isOnline && mapVehicleType(captain.vehicle?.vehicleType) === 'auto').length,
    };

    const servicesArray = [
      {
        name: 'Bike Ride',
        bookings: rides.filter(ride => ride.vehicleType === 'motorcycle').length,
        revenue: revenueByService['Bike Ride'],
        activeDrivers: activeDriversByService['Bike Ride'],
        isActive: servicesStatus.find(s => s.name === 'Bike Ride')?.isActive ?? true,
      },
      {
        name: 'Car',
        bookings: rides.filter(ride => ride.vehicleType === 'car').length,
        revenue: revenueByService['Car'],
        activeDrivers: activeDriversByService['Car'],
        isActive: servicesStatus.find(s => s.name === 'Car')?.isActive ?? true,
      },
      {
        name: 'Taxi Ride',
        bookings: rides.filter(ride => ride.vehicleType === 'auto').length,
        revenue: revenueByService['Taxi Ride'],
        activeDrivers: activeDriversByService['Taxi Ride'],
        isActive: servicesStatus.find(s => s.name === 'Taxi Ride')?.isActive ?? true,
      },
      {
        name: 'Intercity',
        bookings: rides.filter(ride => ride.serviceType === 'intercity').length,
        revenue: revenueByService['Intercity'],
        activeDrivers: activeDriversByService['Intercity'],
        isActive: servicesStatus.find(s => s.name === 'Intercity')?.isActive ?? true,
      },
      {
        name: 'Taxi Booking',
        bookings: rides.filter(ride => ride.serviceType === 'taxiBooking').length,
        revenue: revenueByService['Taxi Booking'],
        activeDrivers: activeDriversByService['Taxi Booking'],
        isActive: servicesStatus.find(s => s.name === 'Taxi Booking')?.isActive ?? true,
      },
      {
        name: 'Taxi Pool',
        bookings: rides.filter(ride => ride.serviceType === 'taxiPool').length,
        revenue: revenueByService['Taxi Pool'],
        activeDrivers: activeDriversByService['Taxi Pool'],
        isActive: servicesStatus.find(s => s.name === 'Taxi Pool')?.isActive ?? true,
      },
    ];

    const servicesObject = {
      bikeRide: {
        bookings: servicesArray.find(s => s.name === 'Bike Ride')?.bookings || 0,
        revenue: servicesArray.find(s => s.name === 'Bike Ride')?.revenue || 0,
        activeDrivers: servicesArray.find(s => s.name === 'Bike Ride')?.activeDrivers || 0,
        isActive: servicesArray.find(s => s.name === 'Bike Ride')?.isActive ?? true,
      },
      car: {
        bookings: servicesArray.find(s => s.name === 'Car')?.bookings || 0,
        revenue: servicesArray.find(s => s.name === 'Car')?.revenue || 0,
        activeDrivers: servicesArray.find(s => s.name === 'Car')?.activeDrivers || 0,
        isActive: servicesArray.find(s => s.name === 'Car')?.isActive ?? true,
      },
      taxiRide: {
        bookings: servicesArray.find(s => s.name === 'Taxi Ride')?.bookings || 0,
        revenue: servicesArray.find(s => s.name === 'Taxi Ride')?.revenue || 0,
        activeDrivers: servicesArray.find(s => s.name === 'Taxi Ride')?.activeDrivers || 0,
        isActive: servicesArray.find(s => s.name === 'Taxi Ride')?.isActive ?? true,
      },
      intercity: {
        bookings: servicesArray.find(s => s.name === 'Intercity')?.bookings || 0,
        revenue: servicesArray.find(s => s.name === 'Intercity')?.revenue || 0,
        activeDrivers: servicesArray.find(s => s.name === 'Intercity')?.activeDrivers || 0,
        isActive: servicesArray.find(s => s.name === 'Intercity')?.isActive ?? true,
      },
      taxiBooking: {
        bookings: servicesArray.find(s => s.name === 'Taxi Booking')?.bookings || 0,
        revenue: servicesArray.find(s => s.name === 'Taxi Booking')?.revenue || 0,
        activeDrivers: servicesArray.find(s => s.name === 'Taxi Booking')?.activeDrivers || 0,
        isActive: servicesArray.find(s => s.name === 'Taxi Booking')?.isActive ?? true,
      },
      taxiPool: {
        bookings: servicesArray.find(s => s.name === 'Taxi Pool')?.bookings || 0,
        revenue: servicesArray.find(s => s.name === 'Taxi Pool')?.revenue || 0,
        activeDrivers: servicesArray.find(s => s.name === 'Taxi Pool')?.activeDrivers || 0,
        isActive: servicesArray.find(s => s.name === 'Taxi Pool')?.isActive ?? true,
      },
    };

    io.to('admin-room').emit('service-stats-update', servicesObject);
    res.status(200).json({ message: 'Service stats emitted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  createRide,
  getFare,
  confirmRide,
  startRide,
  endRide,
  cancelRide,
  getRideStatus,
  createPaymentOrder,
  verifyPayment,
  getCaptainStats,
  submitFeedback,
  getUserRideHistory,
  emitServiceStatsUpdate,
};