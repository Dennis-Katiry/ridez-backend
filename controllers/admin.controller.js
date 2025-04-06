const captainModel = require('../models/captain.model');
const userModel = require('../models/user.model');
const adminModel = require('../models/admin.model');
const rideModel = require('../models/ride.model');
const serviceModel = require('../models/service.model'); // New model
const { validationResult } = require('express-validator');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const { getIo, emitToAdminRoom } = require('../socket');

const initializeServices = async () => {
  const services = [
    { name: 'Bike Ride', isActive: true },
    { name: 'Car', isActive: true },
    { name: 'Taxi Ride', isActive: true },
    { name: 'Intercity', isActive: true },
    { name: 'Taxi Booking', isActive: true },
    { name: 'Taxi Pool', isActive: true },
  ];

  for (const service of services) {
    const existingService = await serviceModel.findOne({ name: service.name });
    if (!existingService) {
      await serviceModel.create(service);
    }
  }
};

initializeServices();

module.exports.loginAdmin = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { email, password } = req.body;
  try {
    const admin = await adminModel.findOne({ email }).select('+password');
    if (!admin || !(await admin.comparePassword(password))) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = admin.generateAuthToken();
    res.status(200).json({ token, admin: admin.toObject({ virtuals: false, getters: true }) });
  } catch (err) {
    console.error('Error in loginAdmin:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports.getAllCaptains = async (req, res) => {
  try {
    const captains = await captainModel.find().select('-password').lean();
    res.status(200).json({ captains, total: captains.length });
  } catch (err) {
    console.error('Error in getAllCaptains:', err);
    res.status(500).json({ message: 'Failed to fetch captains', error: err.message });
  }
};

module.exports.getAllUsers = async (req, res) => {
  try {
    const users = await userModel.find().select('-password').lean();
    res.status(200).json({ users, total: users.length });
  } catch (err) {
    console.error('Error in getAllUsers:', err);
    res.status(500).json({ message: 'Failed to fetch users', error: err.message });
  }
};

module.exports.getCaptainDetails = async (req, res) => {
  try {
    console.log('Fetching captain with ID:', req.params.id);
    const captain = await captainModel.findById(req.params.id).select('-password').lean();
    if (!captain) return res.status(404).json({ message: 'Captain not found' });
    res.status(200).json(captain);
  } catch (err) {
    console.error('Error in getCaptainDetails:', err);
    res.status(500).json({ message: 'Failed to fetch captain details', error: err.message });
  }
};

module.exports.getUserDetails = async (req, res) => {
  try {
    const user = await userModel.findById(req.params.id).select('-password').lean();
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.status(200).json(user);
  } catch (err) {
    console.error('Error in getUserDetails:', err);
    res.status(500).json({ message: 'Failed to fetch user details', error: err.message });
  }
};

module.exports.getStats = async (req, res) => {
  try {
    const captains = await captainModel.find().select('-password').lean();
    const users = await userModel.find().select('-password').lean();
    const rides = await rideModel.find().lean();
    const servicesStatus = await serviceModel.find().lean();

    const mapVehicleType = (vehicleType) => {
      if (vehicleType === 'motorcycle') return 'motorcycle'; // Update mapping to keep 'motorcycle'
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

    const totalRevenue = rides
      .filter(ride => ride.status === 'completed' && ride.paymentStatus === 'completed')
      .reduce((sum, ride) => sum + (ride.fare || 0), 0);

    const completeRides = rides.filter(ride => ride.status === 'completed').length;
    const cancelledRides = rides.filter(ride => ride.status === 'cancelled').length;
    const totalRides = rides.length;
    const activeRides = rides.filter(ride => ride.status === 'ongoing').length;

    // Create the services array (for WebSocket events and other uses)
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

    // Transform the services array into an object with all fields for the API response
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

    const stats = {
      totalRevenue,
      completeRides,
      cancelledRides,
      totalRides,
      totalCaptains: captains.length,
      totalUsers: users.length,
      activeRides,
      services: servicesObject,
    };

    res.status(200).json(stats);
  } catch (err) {
    console.error('Error in getStats:', err);
    res.status(500).json({ message: 'Failed to fetch stats', error: err.message });
  }
};

module.exports.getRecentBookings = async (req, res) => {
  try {
    const rides = await rideModel
      .find()
      .populate('user', 'fullname')
      .populate('captain', 'fullname')
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    const recentBookings = rides.map(ride => ({
      id: ride._id.toString(),
      service: ride.serviceType === 'taxiPool' ? 'Taxi Pool' :
        ride.serviceType === 'intercity' ? 'Intercity' :
          ride.serviceType === 'taxiBooking' ? 'Taxi Booking' :
            ride.vehicleType === 'motorcycle' ? 'Bike Ride' :
              ride.vehicleType === 'car' ? 'Car' : 'Taxi Ride',
      customer: ride.user ? `${ride.user.fullname?.firstname || 'Unknown'} ${ride.user.fullname?.lastname || ''}` : 'Unknown',
      driver: ride.captain ? `${ride.captain.fullname?.firstname || 'Unknown'} ${ride.captain.fullname?.lastname || ''}` : 'Not Assigned',
      status: ride.status.charAt(0).toUpperCase() + ride.status.slice(1), // Capitalize status
    }));

    res.status(200).json(recentBookings);
  } catch (err) {
    console.error('Error in getRecentBookings:', err);
    res.status(500).json({ message: 'Failed to fetch recent bookings', error: err.message });
  }
};

module.exports.toggleServiceStatus = async (req, res) => {
  const { serviceName, isActive } = req.body;

  try {
    console.log('Toggling service status:', { serviceName, isActive });

    const service = await serviceModel.findOneAndUpdate(
      { name: serviceName },
      { isActive },
      { new: true, upsert: true }
    );
    console.log('Updated service:', service);

    let vehicleTypes = [];
    switch (serviceName) {
      case 'Bike Ride':
        vehicleTypes = ['motorcycle'];
        break;
      case 'Car':
        vehicleTypes = ['car'];
        break;
      case 'Taxi Ride':
        vehicleTypes = ['auto'];
        break;
      case 'Intercity':
        vehicleTypes = ['car'];
        break;
      case 'Taxi Booking':
        vehicleTypes = ['auto'];
        break;
      case 'Taxi Pool':
        vehicleTypes = ['auto'];
        break;
      default:
        break;
    }
    console.log('Vehicle types for service:', vehicleTypes);

    let updatedCaptains = { modifiedCount: 0 };
    if (!isActive && vehicleTypes.length > 0) {
      console.log('Updating captains to offline...');
      updatedCaptains = await captainModel.updateMany(
        { 'vehicle.vehicleType': { $in: vehicleTypes }, isOnline: true },
        { $set: { isOnline: false } }
      );
      console.log(`Updated ${updatedCaptains.modifiedCount} captains to offline`);

      const io = getIo();
      console.log('Fetching affected captains for socket emission...');
      const affectedCaptains = await captainModel.find({
        'vehicle.vehicleType': { $in: vehicleTypes },
        socketId: { $ne: null },
      });
      console.log('Affected captains:', affectedCaptains);

      affectedCaptains.forEach(captain => {
        if (captain.socketId) {
          console.log(`Emitting status-update to captain ${captain._id} with socketId ${captain.socketId}`);
          io.to(captain.socketId).emit('status-update', {
            isOnline: false,
            message: `Service ${serviceName} has been disabled by the admin. You are now offline.`,
          });
        }
      });
    }

    console.log('Emitting service-status-changed event...');
    emitToAdminRoom('service-status-changed', { serviceName, isActive });

    console.log('Sending response...');
    res.status(200).json({
      message: `Service ${serviceName} is now ${isActive ? 'active' : 'inactive'}`,
      service,
      affectedCaptains: isActive ? 0 : updatedCaptains.modifiedCount,
    });
  } catch (err) {
    console.error('Error in toggleServiceStatus:', err);
    res.status(500).json({ message: 'Failed to toggle service status', error: err.message });
  }
};

module.exports.getCaptainRideHistory = async (req, res) => {
  try {
    const captainId = req.captain._id;
    const rides = await rideModel
      .find({ captain: captainId })
      .populate('user', 'fullname')
      .sort({ createdAt: -1 })
      .lean();
    res.status(200).json(rides);
  } catch (err) {
    console.error('Error in getCaptainRideHistory:', err);
    res.status(500).json({ message: 'Failed to fetch ride history', error: err.message });
  }
};

module.exports.getScheduledRides = async (req, res) => {
  try {
    const scheduledRides = await rideModel.find({
      isScheduled: true,
      status: 'pending',
      captain: { $exists: false },
    })
      .populate('user')
      .populate('users.userId')
      .sort({ scheduledTime: 1 });

    res.status(200).json(scheduledRides);
  } catch (error) {
    console.error('Error fetching scheduled rides:', error);
    res.status(500).json({ message: 'Failed to fetch scheduled rides', error: error.message });
  }
};

module.exports.assignCaptain = async (req, res) => {
  const { rideId, captainId, vehicle } = req.body;

  try {
    const ride = await rideModel.findOne({ _id: rideId, isScheduled: true, status: 'pending' })
      .populate('user')
      .populate('users.userId');
    if (!ride) {
      return res.status(404).json({ message: 'Scheduled ride not found or already assigned' });
    }

    const captain = await captainModel.findById(captainId);
    if (!captain) {
      return res.status(404).json({ message: 'Captain not found' });
    }

    const scheduledTime = new Date(ride.scheduledTime);
    const bufferTimeBefore = new Date(scheduledTime.getTime() - 30 * 60 * 1000);
    const bufferTimeAfter = new Date(scheduledTime.getTime() + 2 * 60 * 60 * 1000);

    const conflictingRide = await rideModel.findOne({
      captain: captainId,
      status: { $in: ['accepted', 'ongoing'] },
      $or: [
        { scheduledTime: { $gte: bufferTimeBefore, $lte: bufferTimeAfter } },
        { createdAt: { $gte: bufferTimeBefore, $lte: bufferTimeAfter } },
      ],
    });

    if (conflictingRide) {
      return res.status(400).json({ message: 'Captain is not available at the scheduled time' });
    }

    ride.captain = captainId;
    ride.vehicle = vehicle;
    await ride.save();

    const io = getIo();
    if (captain.socketId) {
      io.to(captain.socketId).emit('ride-request', {
        rideId: ride._id,
        pickup: ride.pickup,
        destination: ride.destination,
        fare: ride.fare,
        userId: ride.serviceType === 'taxiPool' ? ride.users[0].userId : ride.user,
        userLocation: { lat: ride.pickupLat, lng: ride.pickupLng },
        scheduledTime: ride.scheduledTime,
      });
    }

    if (ride.serviceType === 'taxiPool') {
      ride.users.forEach(userEntry => {
        const user = userEntry.userId;
        if (user && user.socketId) {
          io.to(user.socketId).emit('captain-assigned', {
            rideId: ride._id,
            message: 'A captain has been assigned to your scheduled ride',
            captainId: captain._id,
            captainName: `${captain.fullname?.firstname || 'Unknown'} ${captain.fullname?.lastname || ''}`,
            vehicle,
          });
        }
      });
    } else {
      const user = ride.user;
      if (user && user.socketId) {
        io.to(user.socketId).emit('captain-assigned', {
          rideId: ride._id,
          message: 'A captain has been assigned to your scheduled ride',
          captainId: captain._id,
          captainName: `${captain.fullname?.firstname || 'Unknown'} ${captain.fullname?.lastname || ''}`,
          vehicle,
        });
      }
    }

    res.status(200).json({ message: 'Captain assigned successfully', ride });
  } catch (error) {
    console.error('Error assigning captain:', error);
    res.status(500).json({ message: 'Failed to assign captain', error: error.message });
  }
};

module.exports.getAvailableCaptains = async (req, res) => {
  const { scheduledTime } = req.query;

  try {
    if (!scheduledTime) {
      return res.status(400).json({ message: 'Scheduled time is required' });
    }

    const scheduledDate = new Date(scheduledTime);
    const bufferTimeBefore = new Date(scheduledDate.getTime() - 30 * 60 * 1000);
    const bufferTimeAfter = new Date(scheduledDate.getTime() + 2 * 60 * 60 * 1000);

    const captains = await captainModel.find();

    const availableCaptains = [];
    for (const captain of captains) {
      const conflictingRide = await rideModel.findOne({
        captain: captain._id,
        status: { $in: ['accepted', 'ongoing'] },
        $or: [
          { scheduledTime: { $gte: bufferTimeBefore, $lte: bufferTimeAfter } },
          { createdAt: { $gte: bufferTimeBefore, $lte: bufferTimeAfter } },
        ],
      });

      if (!conflictingRide) {
        availableCaptains.push(captain);
      }
    }

    res.status(200).json(availableCaptains);
  } catch (error) {
    console.error('Error fetching available captains:', error);
    res.status(500).json({ message: 'Failed to fetch available captains', error: error.message });
  }
};

module.exports.generateReport = async (req, res) => {
  try {
    const { reportType } = req.query; // Get reportType from query params
    if (!reportType) {
      return res.status(400).json({ message: 'Report type is required' });
    }

    const doc = new PDFDocument({ margin: 50 });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {
      const pdfData = Buffer.concat(buffers);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=${reportType}-report-${new Date().toISOString()}.pdf`);
      res.send(pdfData);
    });

    doc.fontSize(20).text(`Ridez ${reportType.charAt(0).toUpperCase() + reportType.slice(1)} Report`, { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Generated on: ${new Date().toLocaleString()}`, { align: 'center' });
    doc.moveDown(2);

    if (reportType === 'transport-service') {
      // Existing logic for Transport Service report
      const statsResponse = await rideModel.find().lean();
      const captains = await captainModel.find().select('-password').lean();
      const servicesStatus = await serviceModel.find().lean();
      const recentBookings = await rideModel
        .find()
        .populate('user', 'fullname')
        .populate('captain', 'fullname')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();

      const mapVehicleType = (vehicleType) => {
        if (vehicleType === 'motorcycle') return 'motorcycle';
        return vehicleType;
      };

      const revenueByService = {
        'Bike Ride': statsResponse
          .filter(ride => ride.vehicleType === 'motorcycle' && ride.status === 'completed' && ride.paymentStatus === 'completed')
          .reduce((sum, ride) => sum + (ride.fare || 0), 0),
        'Car': statsResponse
          .filter(ride => ride.vehicleType === 'car' && ride.status === 'completed' && ride.paymentStatus === 'completed')
          .reduce((sum, ride) => sum + (ride.fare || 0), 0),
        'Taxi Ride': statsResponse
          .filter(ride => ride.vehicleType === 'auto' && ride.status === 'completed' && ride.paymentStatus === 'completed')
          .reduce((sum, ride) => sum + (ride.fare || 0), 0),
        'Intercity': statsResponse
          .filter(ride => ride.serviceType === 'intercity' && ride.status === 'completed' && ride.paymentStatus === 'completed')
          .reduce((sum, ride) => sum + (ride.fare || 0), 0),
        'Taxi Booking': statsResponse
          .filter(ride => ride.serviceType === 'taxiBooking' && ride.status === 'completed' && ride.paymentStatus === 'completed')
          .reduce((sum, ride) => sum + (ride.fare || 0), 0),
        'Taxi Pool': statsResponse
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

      const services = [
        {
          name: 'Bike Ride',
          bookings: statsResponse.filter(ride => ride.vehicleType === 'motorcycle').length,
          revenue: revenueByService['Bike Ride'],
          activeDrivers: activeDriversByService['Bike Ride'],
          isActive: servicesStatus.find(s => s.name === 'Bike Ride')?.isActive ?? true,
        },
        {
          name: 'Car',
          bookings: statsResponse.filter(ride => ride.vehicleType === 'car').length,
          revenue: revenueByService['Car'],
          activeDrivers: activeDriversByService['Car'],
          isActive: servicesStatus.find(s => s.name === 'Car')?.isActive ?? true,
        },
        {
          name: 'Taxi Ride',
          bookings: statsResponse.filter(ride => ride.vehicleType === 'auto').length,
          revenue: revenueByService['Taxi Ride'],
          activeDrivers: activeDriversByService['Taxi Ride'],
          isActive: servicesStatus.find(s => s.name === 'Taxi Ride')?.isActive ?? true,
        },
        {
          name: 'Intercity',
          bookings: statsResponse.filter(ride => ride.serviceType === 'intercity').length,
          revenue: revenueByService['Intercity'],
          activeDrivers: activeDriversByService['Intercity'],
          isActive: servicesStatus.find(s => s.name === 'Intercity')?.isActive ?? true,
        },
        {
          name: 'Taxi Booking',
          bookings: statsResponse.filter(ride => ride.serviceType === 'taxiBooking').length,
          revenue: revenueByService['Taxi Booking'],
          activeDrivers: activeDriversByService['Taxi Booking'],
          isActive: servicesStatus.find(s => s.name === 'Taxi Booking')?.isActive ?? true,
        },
        {
          name: 'Taxi Pool',
          bookings: statsResponse.filter(ride => ride.serviceType === 'taxiPool').length,
          revenue: revenueByService['Taxi Pool'],
          activeDrivers: activeDriversByService['Taxi Pool'],
          isActive: servicesStatus.find(s => s.name === 'Taxi Pool')?.isActive ?? true,
        },
      ];

      const recentBookingsFormatted = recentBookings.map(ride => ({
        id: ride._id.toString(),
        service: ride.serviceType === 'taxiPool' ? 'Taxi Pool' :
          ride.serviceType === 'intercity' ? 'Intercity' :
            ride.serviceType === 'taxiBooking' ? 'Taxi Booking' :
              ride.vehicleType === 'motorcycle' ? 'Bike Ride' :
                ride.vehicleType === 'car' ? 'Car' : 'Taxi Ride',
        customer: ride.user ? `${ride.user.fullname?.firstname || 'Unknown'} ${ride.user.fullname?.lastname || ''}` : 'Unknown',
        driver: ride.captain ? `${ride.captain.fullname?.firstname || 'Unknown'} ${ride.captain.fullname?.lastname || ''}` : 'Not Assigned',
        status: ride.status.charAt(0).toUpperCase() + ride.status.slice(1),
      }));

      doc.fontSize(16).text('Service Overview', { underline: true });
      doc.moveDown();
      services.forEach(service => {
        doc.fontSize(12).text(`${service.name}:`, { bold: true });
        doc.text(`Bookings: ${service.bookings}`);
        doc.text(`Revenue: ₹${service.revenue}`);
        doc.text(`Active Drivers: ${service.activeDrivers}`);
        doc.text(`Status: ${service.isActive ? 'Active' : 'Inactive'}`);
        doc.moveDown();
      });

      doc.moveDown(2);
      doc.fontSize(16).text('Recent Bookings', { underline: true });
      doc.moveDown();
      recentBookingsFormatted.forEach(booking => {
        doc.fontSize(12).text(`Booking ID: ${booking.id}`);
        doc.text(`Service: ${booking.service}`);
        doc.text(`Customer: ${booking.customer}`);
        doc.text(`Driver: ${booking.driver}`);
        doc.text(`Status: ${booking.status}`);
        doc.moveDown();
      });
    } else if (reportType === 'customers') {
      // Logic for Customers report
      const users = await userModel.find().select('-password').lean();

      const customers = users.map((user, index) => ({
        id: user._id || `C${String(index + 1).padStart(3, '0')}`,
        name: `${user.fullname?.firstname || 'Unknown'} ${user.fullname?.lastname || ''}`.trim(),
        email: user.email || 'N/A',
        totalRides: user.totalRides || 0,
        isActive: user.isActive !== undefined ? user.isActive : true,
      }));

      doc.fontSize(16).text('Customer Overview', { underline: true });
      doc.moveDown();
      doc.fontSize(12).text(`Total Customers: ${customers.length}`);
      doc.moveDown();

      doc.fontSize(14).text('Customer List', { underline: true });
      doc.moveDown();
      customers.forEach(customer => {
        doc.fontSize(12).text(`Customer ID: ${customer.id}`);
        doc.text(`Name: ${customer.name}`);
        doc.text(`Email: ${customer.email}`);
        doc.text(`Total Rides: ${customer.totalRides}`);
        doc.text(`Status: ${customer.isActive ? 'Active' : 'Inactive'}`);
        doc.moveDown();
      });
    } else if (reportType === 'drivers') {
      // Logic for Drivers report
      const captains = await captainModel.find().select('-password').lean();

      const drivers = captains.map(captain => ({
        id: captain._id,
        name: `${captain.fullname?.firstname || 'Unknown'} ${captain.fullname?.lastname || ''}`.trim(),
        email: captain.email || 'N/A',
        totalRides: captain.totalRides || 0,
        isActive: captain.isActive !== undefined ? captain.isActive : true,
      }));

      doc.fontSize(16).text('Driver Overview', { underline: true });
      doc.moveDown();
      doc.fontSize(12).text(`Total Drivers: ${drivers.length}`);
      doc.moveDown();

      doc.fontSize(14).text('Driver List', { underline: true });
      doc.moveDown();
      drivers.forEach(driver => {
        doc.fontSize(12).text(`Driver ID: ${driver.id}`);
        doc.text(`Name: ${driver.name}`);
        doc.text(`Email: ${driver.email}`);
        doc.text(`Total Rides: ${driver.totalRides}`);
        doc.text(`Status: ${driver.isActive ? 'Active' : 'Inactive'}`);
        doc.moveDown();
      });
    } else {
      doc.end();
      return res.status(400).json({ message: 'Invalid report type' });
    }

    doc.end();
  } catch (err) {
    console.error('Error generating report:', err);
    res.status(500).json({ message: 'Failed to generate report', error: err.message });
  }
};

module.exports.toggleUserStatus = async (req, res) => {
  const { userId } = req.params;
  try {
    const user = await userModel.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.isActive = !user.isActive;
    await user.save();

    // Notify user if deactivated
    const io = getIo();
    if (!user.isActive && user.socketId) {
      io.to(user.socketId).emit('status-changed', {
        isActive: user.isActive,
        message: 'Your account has been deactivated by an admin. You cannot create rides.',
      });
    }

    res.status(200).json({
      message: `${user.fullname?.firstname || 'User'} is now ${user.isActive ? 'active' : 'inactive'}`,
      user: {
        id: user._id,
        name: `${user.fullname?.firstname || 'Unknown'} ${user.fullname?.lastname || ''}`.trim(),
        email: user.email,
        totalRides: user.totalRides,
        isActive: user.isActive,
      },
    });
  } catch (error) {
    console.error('Error toggling user status:', error);
    res.status(500).json({ message: 'Failed to toggle user status', error: error.message });
  }
};

module.exports.toggleCaptainStatus = async (req, res) => {
  const { captainId } = req.params;
  try {
    const captain = await captainModel.findById(captainId);
    if (!captain) {
      return res.status(404).json({ message: 'Captain not found' });
    }

    captain.isActive = !captain.isActive;
    await captain.save();

    // Notify captain if deactivated
    const io = getIo();
    if (!captain.isActive && captain.socketId) {
      io.to(captain.socketId).emit('status-changed', {
        isActive: captain.isActive,
        message: 'Your account has been deactivated by an admin.',
      });
    }

    res.status(200).json({
      message: `${captain.fullname?.firstname || 'Captain'} is now ${captain.isActive ? 'active' : 'inactive'}`,
      captain: {
        id: captain._id,
        name: `${captain.fullname?.firstname || 'Unknown'} ${captain.fullname?.lastname || ''}`.trim(),
        email: captain.email,
        totalRides: captain.totalRides,
        isActive: captain.isActive,
      },
    });
  } catch (error) {
    console.error('Error toggling captain status:', error);
    res.status(500).json({ message: 'Failed to toggle captain status', error: error.message });
  }
};