console.log('Loading ride.service.js');
require('dotenv').config();
const rideModel = require('../models/ride.model');
const mapService = require('./maps.service');
const crypto = require('crypto');
const { sendMessageToSocketId, emitToAdminRoom } = require('../socket');
const Razorpay = require('razorpay');
const captainModel = require('../models/captain.model');
const serviceModel = require('../models/service.model');

const emitServiceStatsUpdate = async (io) => {
  const rides = await rideModel.find().lean();
  const captains = await captainModel.find().select('-password').lean();
  console.log('Executing serviceModel.find() to get services status');
  const servicesStatus = await serviceModel.find().lean();
  console.log('servicesStatus result:', servicesStatus);

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
    'Bike Ride': captains.filter(captain => captain.isOnline && captain.vehicle?.vehicleType === 'motorcycle').length,
    'Car': captains.filter(captain => captain.isOnline && captain.vehicle?.vehicleType === 'car').length,
    'Taxi Ride': captains.filter(captain => captain.isOnline && captain.vehicle?.vehicleType === 'auto').length,
    'Intercity': captains.filter(captain => captain.isOnline && captain.vehicle?.vehicleType === 'car').length,
    'Taxi Booking': captains.filter(captain => captain.isOnline && captain.vehicle?.vehicleType === 'auto').length,
    'Taxi Pool': captains.filter(captain => captain.isOnline && captain.vehicle?.vehicleType === 'auto').length,
  };

  const services = [
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

  emitToAdminRoom('service-stats-update', services); // io is handled internally by emitToAdminRoom
};

async function getFare(pickup, destination) {
  if (!pickup || !destination) {
    throw new Error('Pickup and destination are required');
  }

  const distanceTime = await mapService.getDistanceTime(pickup, destination);

  const baseFare = { auto: 30, car: 50, motorcycle: 20 };
  const perKmRate = { auto: 10, car: 15, motorcycle: 8 };
  const perMinuteRate = { auto: 2, car: 3, motorcycle: 1.5 };

  const fare = {
    auto: Math.round(baseFare.auto + (distanceTime.distance.value / 1000) * perKmRate.auto + (distanceTime.duration.value / 60) * perMinuteRate.auto),
    car: Math.round(baseFare.car + (distanceTime.distance.value / 1000) * perKmRate.car + (distanceTime.duration.value / 60) * perMinuteRate.car),
    motorcycle: Math.round(baseFare.motorcycle + (distanceTime.distance.value / 1000) * perKmRate.motorcycle + (distanceTime.duration.value / 60) * perMinuteRate.motorcycle),
  };

  return fare;
}

function getOtp(num) {
  function generateOtp(num) {
    const otp = crypto.randomInt(Math.pow(10, num - 1), Math.pow(10, num)).toString();
    return otp;
  }
  return generateOtp(num);
}

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

module.exports.getFare = getFare;

module.exports.createPaymentOrder = async ({ rideId, user }) => {
  console.log('Creating payment order for:', { rideId, userId: user._id });
  const ride = await rideModel.findOne({ _id: rideId, user: user._id });
  if (!ride) {
    console.error('Ride not found:', { rideId, userId: user._id });
    throw new Error('Ride not found');
  }
  console.log('Ride found:', { status: ride.status, paymentStatus: ride.paymentStatus, fare: ride.fare });
  if (ride.status !== 'ongoing') throw new Error('Ride not ongoing');
  if (ride.paymentStatus === 'completed') throw new Error('Payment already completed');

  const options = {
    amount: Math.round(ride.fare * 100),
    currency: 'INR',
    receipt: `ride_${rideId}`,
  };
  console.log('Razorpay order options:', options);

  const order = await razorpay.orders.create(options);
  console.log('Razorpay order created:', order);
  return { orderId: order.id, amount: order.amount, currency: order.currency };
};

module.exports.verifyPayment = async ({ rideId, paymentId, orderId, signature, user, io }) => {
  console.log('Verifying payment for:', { rideId, paymentId, orderId });
  const ride = await rideModel.findOne({ _id: rideId, user: user._id });
  if (!ride) throw new Error('Ride not found');

  const generatedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  if (generatedSignature !== signature) throw new Error('Invalid payment signature');

  const updatedRide = await rideModel.findOneAndUpdate(
    { _id: rideId },
    { paymentStatus: 'completed', paymentId, orderId, signature },
    { new: true }
  ).populate('captain').populate('user').select('+otp');

  if (updatedRide.captain && updatedRide.captain.socketId) {
    console.log('Sending payment-completed to captain socket:', updatedRide.captain.socketId);
    io.to(updatedRide.captain.socketId).emit('payment-completed', { rideId: updatedRide._id, message: 'Payment completed by rider' });
  }
  if (updatedRide.user && updatedRide.user.socketId) {
    console.log('Sending payment-completed to user socket:', updatedRide.user.socketId);
    io.to(updatedRide.user.socketId).emit('payment-completed', { rideId: updatedRide._id, message: 'Payment completed successfully' });
  }

  await emitServiceStatsUpdate(io);
  return updatedRide;
};

module.exports.createRide = async ({ user, pickup, destination, vehicleType, serviceType = 'solo', scheduledTime, io }) => {
  if (!user || !pickup || !destination || !vehicleType) {
    throw new Error('All fields are required');
  }

  // Check if user is active
  const userModel = require('../models/user.model');
  const userData = await userModel.findById(user);
  if (!userData) {
    throw new Error('User not found');
  }
  if (!userData.isActive) {
    throw new Error('Your account is deactivated. You cannot create rides.');
  }

  const distanceTime = await mapService.getDistanceTime(pickup, destination);
  const distanceInMeters = distanceTime.distance.value;

  // Fetch coordinates for pickup and destination
  const pickupCoordinates = await mapService.getAddressCoordinate(pickup);
  const destinationCoordinates = await mapService.getAddressCoordinate(destination);

  if (!pickupCoordinates || !destinationCoordinates) {
    throw new Error('Failed to fetch coordinates for pickup or destination');
  }

  let finalServiceType = serviceType;
  if (serviceType === 'solo') {
    const INTERCITY_DISTANCE_THRESHOLD = 50000;
    finalServiceType = distanceInMeters > INTERCITY_DISTANCE_THRESHOLD ? 'intercity' : 'solo';
  }

  let ride;
  if (finalServiceType === 'taxiPool') {
    const existingRide = await findMatchingTaxiPoolRide({ pickup, destination, vehicleType });
    if (existingRide) {
      const userFare = await calculateFareShare(pickup, destination, vehicleType);
      existingRide.users.push({
        userId: user,
        fareShare: userFare,
        pickup,
        destination,
        pickupCoordinates, // Save coordinates for taxiPool user
        destinationCoordinates,
      });
      existingRide.fare = (existingRide.fare || 0) + userFare;
      await existingRide.save();
      ride = existingRide;
    } else {
      const userFare = await calculateFareShare(pickup, destination, vehicleType);
      ride = await rideModel.create({
        users: [{
          userId: user,
          fareShare: userFare,
          pickup,
          destination,
          pickupCoordinates,
          destinationCoordinates,
        }],
        vehicleType,
        otp: getOtp(6),
        fare: userFare,
        distance: distanceInMeters,
        serviceType: 'taxiPool',
        pickupCoordinates, // Save coordinates for the ride
        destinationCoordinates,
      });
    }
  } else {
    const fare = await getFare(pickup, destination);
    ride = await rideModel.create({
      user,
      pickup,
      destination,
      vehicleType,
      otp: getOtp(6),
      fare: fare[vehicleType],
      distance: distanceInMeters,
      serviceType: finalServiceType,
      isScheduled: !!scheduledTime,
      scheduledTime: scheduledTime || undefined,
      pickupCoordinates, // Save coordinates
      destinationCoordinates,
    });
  }

  const populatedRide = await rideModel
    .findById(ride._id)
    .populate('user', 'fullname')
    .populate('captain', 'fullname')
    .lean();
  emitToAdminRoom('new-booking', {
    id: ride._id.toString(),
    service: finalServiceType === 'taxiPool' ? 'Taxi Pool' :
      finalServiceType === 'intercity' ? 'Intercity' :
        finalServiceType === 'taxiBooking' ? 'Taxi Booking' :
          vehicleType === 'motorcycle' ? 'Bike Ride' :
            vehicleType === 'car' ? 'Car' : 'Taxi Ride',
    customer: populatedRide.user ? `${populatedRide.user.fullname?.firstname || 'Unknown'} ${populatedRide.user.fullname?.lastname || ''}` : 'Unknown',
    driver: populatedRide.captain ? `${populatedRide.captain.fullname?.firstname || 'Unknown'} ${populatedRide.captain.fullname?.lastname || ''}` : 'Not Assigned',
    status: populatedRide.status.charAt(0).toUpperCase() + populatedRide.status.slice(1),
  });

  await emitServiceStatsUpdate(io);
  return ride;
};

const findMatchingTaxiPoolRide = async ({ pickup, destination, vehicleType }) => {
  const MAX_DETOUR_MINUTES = 10;
  const rides = await rideModel.find({
    serviceType: 'taxiPool',
    status: 'pending',
    vehicleType,
  });

  for (const ride of rides) {
    let totalDetourMinutes = 0;
    for (const user of ride.users) {
      const detourToPickup = await mapService.getDistanceTime(user.destination, pickup);
      const detourToDestination = await mapService.getDistanceTime(pickup, destination);
      totalDetourMinutes += (detourToPickup.duration.value + detourToDestination.duration.value) / 60;
    }
    if (totalDetourMinutes <= MAX_DETOUR_MINUTES) {
      return ride;
    }
  }
  return null;
};

const calculateFareShare = async (pickup, destination, vehicleType) => {
  const fare = await getFare(pickup, destination);
  return fare[vehicleType] * 0.7;
};

module.exports.confirmRide = async ({ rideId, captain, io }) => { // Add io parameter
  if (!rideId) {
    throw new Error('Ride id is required');
  }

  await rideModel.findOneAndUpdate(
    { _id: rideId },
    { status: 'accepted', captain: captain._id }
  );

  const ride = await rideModel.findOne({ _id: rideId }).populate('users.userId').populate('captain').select('+otp');
  if (!ride) {
    throw new Error('Ride not found');
  }

  if (ride.serviceType === 'taxiPool') {
    ride.user = undefined;
  } else {
    await ride.populate('user');
  }

  if (ride.serviceType === 'taxiPool') {
    ride.users.forEach(userEntry => {
      const user = userEntry.userId;
      if (user && user.socketId && captain.location) {
        io.to(user.socketId).emit('captain-location-update', {
          rideId: ride._id,
          captainLocation: {
            lat: captain.location.coordinates[1],
            lng: captain.location.coordinates[0],
          },
        });
      }
    });
  } else {
    if (ride.user && ride.user.socketId && captain.location) {
      io.to(ride.user.socketId).emit('captain-location-update', {
        rideId: ride._id,
        captainLocation: {
          lat: captain.location.coordinates[1],
          lng: captain.location.coordinates[0],
        },
      });
    }
  }

  await emitServiceStatsUpdate(io);
  return ride;
};

module.exports.startRide = async ({ rideId, otp, captain, io }) => { // Add io parameter
  if (!rideId || !otp) throw new Error('Ride id and OTP are required');
  const ride = await rideModel.findOne({ _id: rideId }).populate('user').populate('captain').select('+otp');
  if (!ride) throw new Error('Ride not found');
  if (ride.status !== 'accepted') throw new Error('Ride not accepted');
  if (ride.otp !== otp) throw new Error('Invalid OTP');
  const updatedRide = await rideModel.findOneAndUpdate(
    { _id: rideId },
    { status: 'ongoing' },
    { new: true }
  ).populate('user').populate('captain').select('+otp');

  await emitServiceStatsUpdate(io);
  return updatedRide;
};

module.exports.endRide = async ({ rideId, captain, io }) => {
  const ride = await rideModel
    .findOne({ _id: rideId, captain: captain._id })
    .populate('user')
    .populate('captain')
    .select('+otp');
  if (!ride || ride.status !== 'ongoing') throw new Error('Ride not ongoing');

  const today = new Date().setHours(0, 0, 0, 0);
  const captainModel = require('../models/captain.model');
  const userModel = require('../models/user.model');

  // Update ride status to completed
  await rideModel.findOneAndUpdate({ _id: rideId }, { status: 'completed' });

  // Update captain's daily stats and totalRides
  const captainUpdate = await captainModel.findOneAndUpdate(
    { _id: captain._id },
    {
      $inc: { totalRides: 1 }, // Increment totalRides
      $push: {
        dailyStats: {
          $each: [{ date: today, earnings: ride.fare, tripsCompleted: 1 }],
          $position: 0,
          $slice: 30, // Optional: Limit dailyStats array size
        },
      },
    },
    { upsert: true, new: true }
  );

  // If dailyStats for today already exists, update it instead of pushing
  await captainModel.updateOne(
    { _id: captain._id, 'dailyStats.date': today },
    { $inc: { 'dailyStats.$.earnings': ride.fare, 'dailyStats.$.tripsCompleted': 1 } }
  );

  // Increment user's totalRides (assuming this was missing here but works elsewhere)
  if (ride.user) {
    await userModel.findByIdAndUpdate(ride.user._id, { $inc: { totalRides: 1 } });
  }

  // Emit events
  if (ride.user && ride.user.socketId) {
    io.to(ride.user.socketId).emit('ride-ended', ride);
  }

  const todayStats = captainUpdate.dailyStats.find((stat) => stat.date.getTime() === today) || {
    earnings: 0,
    hoursOnline: 0,
    tripsCompleted: 0,
  };
  if (captainUpdate.socketId) {
    io.to(captainUpdate.socketId).emit('stats-updated', {
      earningsToday: todayStats.earnings,
      hoursOnline: todayStats.hoursOnline,
      tripsToday: todayStats.tripsCompleted,
      rating: captainUpdate.rating || 0,
    });
  }

  // Emit to admin room for real-time update in Drivers.jsx
  emitToAdminRoom('ride-completed', {
    rideId: ride._id,
    captainId: captain._id,
    totalRides: captainUpdate.totalRides,
  });

  await emitServiceStatsUpdate(io);
  return ride;
};

module.exports.getCaptainStats = async (captainId) => {
  const captainModel = require('../models/captain.model');
  const captain = await captainModel.findById(captainId);
  if (!captain) throw new Error('Captain not found');

  const today = new Date().setHours(0, 0, 0, 0);
  const todayStats = captain.dailyStats.find(stat => stat.date.getTime() === today) || {
    earnings: 0,
    hoursOnline: 0,
    tripsCompleted: 0,
  };

  return {
    earningsToday: todayStats.earnings,
    hoursOnline: todayStats.hoursOnline,
    tripsToday: todayStats.tripsCompleted,
    rating: captain.rating || 0,
  };
};

module.exports.cancelRide = async ({ rideId, user, captain, io }) => { // Add io parameter
  console.log('Starting cancelRide with rideId:', rideId, 'user:', user?._id, 'captain:', captain?._id);
  let ride;
  try {
    const query = { _id: rideId };
    if (user) query.user = user._id;
    if (captain) query.captain = captain._id;

    ride = await rideModel.findOne(query).populate('captain').populate('user').select('+otp');
    console.log('Ride found:', ride ? JSON.stringify(ride, null, 2) : 'null');
  } catch (error) {
    console.error('Error fetching ride in cancelRide:', error);
    throw new Error('Failed to fetch ride: ' + error.message);
  }
  if (!ride) throw new Error('Ride not found');
  if (ride.status === 'completed' || ride.status === 'cancelled') throw new Error('Ride already completed or cancelled');
  if (ride.paymentStatus === 'completed') throw new Error('Cannot cancel ride after payment');

  const updatedRide = await rideModel.findOneAndUpdate(
    { _id: rideId },
    { status: 'cancelled' },
    { new: true, runValidators: true }
  ).populate('captain').populate('user').select('+otp');

  const initiator = user ? 'user' : 'captain';

  if (ride.captain && ride.captain.socketId) {
    io.to(ride.captain.socketId).emit('ride-cancelled', {
      rideId: ride._id,
      message: user ? 'Ride cancelled by rider' : 'Ride cancelled by captain',
      initiator,
    });
  }
  if (ride.user && ride.user.socketId) {
    io.to(ride.user.socketId).emit('ride-cancelled', {
      rideId: ride._id,
      message: user ? 'Ride cancelled by rider' : 'Ride cancelled by captain',
      initiator,
    });
  }

  await emitServiceStatsUpdate(io);
  return updatedRide;
};

module.exports.getRideStatus = async ({ rideId, user }) => {
  if (!rideId || !user) {
    throw new Error('Ride ID and user are required');
  }

  const ride = await rideModel.findOne({ _id: rideId, user: user._id }).select('status pickupCoordinates destinationCoordinates');
  if (!ride) {
    throw new Error('Ride not found');
  }

  return ride;
};

module.exports.submitFeedback = async ({ rideId, rating, comment, user, io }) => { // Add io parameter
  const ride = await rideModel.findOne({ _id: rideId, user: user._id }).populate('captain');
  if (!ride) throw new Error('Ride not found');
  if (ride.status !== 'completed') throw new Error('Ride not completed');
  if (ride.feedbackSubmitted) throw new Error('Feedback already submitted');

  const captainModel = require('../models/captain.model');
  const captain = await captainModel.findById(ride.captain._id);
  const newRatingCount = captain.ratingCount + 1;
  const newRating = ((captain.rating * captain.ratingCount) + rating) / newRatingCount;

  await captainModel.updateOne(
    { _id: captain._id },
    { rating: newRating, ratingCount: newRatingCount }
  );

  await rideModel.updateOne(
    { _id: rideId },
    { feedbackSubmitted: true, feedbackComment: comment || '' }
  );

  const today = new Date().setHours(0, 0, 0, 0);
  const todayStats = captain.dailyStats.find(stat => stat.date.getTime() === today) || {
    earnings: 0,
    hoursOnline: 0,
    tripsCompleted: 0,
  };
  if (captain.socketId) {
    io.to(captain.socketId).emit('stats-updated', {
      earningsToday: todayStats.earnings,
      hoursOnline: todayStats.hoursOnline,
      tripsToday: todayStats.tripsCompleted,
      rating: newRating,
    });
  }

  return { rideId, rating: newRating, comment };
};

module.exports.getUserRideHistory = async (userId) => {
  const rides = await rideModel
    .find({ user: userId })
    .populate('captain', 'fullname')
    .sort({ createdAt: -1 });
  return rides;
};