const captainModel = require('../models/captain.model');
const captainService = require('../services/captain.service');
const rideModel = require('../models/ride.model');
const blackListTokenModel = require('../models/blackListToken.model');
const { validationResult } = require('express-validator');
const path = require('path');
const fs = require('fs');

module.exports.registerCaptain = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { fullname, email, password, phoneNumber, vehicle, latitude, longitude } = req.body;

  console.log('Received captain registration data:', req.body); 

  const isCaptainAlreadyExist = await captainModel.findOne({ email });
  if (isCaptainAlreadyExist) return res.status(400).json({ message: 'Captain already exists' });

  try {
    const hashedPassword = await captainModel.hashPassword(password);
    const location = {
      type: 'Point',
      coordinates: [longitude, latitude],
    };

    const captain = await captainService.createCaptain({
      firstname: fullname.firstname,
      lastname: fullname.lastname,
      email,
      password: hashedPassword,
      phoneNumber, 
      color: vehicle.color,
      plate: vehicle.plate,
      capacity: vehicle.capacity,
      vehicleType: vehicle.vehicleType,
      location, 
    });

    const token = captain.generateAuthToken();
    res.status(201).json({ token, captain });
  } catch (err) {
    console.error('Error in registerCaptain:', err.message);
    if (err.code === 11000) {
      // Duplicate key error
      const field = Object.keys(err.keyValue)[0];
      return res.status(400).json({ message: `A captain with this ${field} already exists.` });
    }
    res.status(400).json({ message: err.message });
  }
};

module.exports.loginCaptain = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { email, password, latitude, longitude } = req.body;

  const captain = await captainModel.findOne({ email }).select('+password');
  if (!captain || !(await captain.comparePassword(password))) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  captain.isOnline = true;
  if (latitude && longitude) {
    captain.location = { type: 'Point', coordinates: [longitude, latitude] };
  }
  await captain.save();

  const token = captain.generateAuthToken();
  res.cookie('token', token, { httpOnly: true });
  res.status(200).json({ token, captain });
};

module.exports.getCaptainProfile = async (req, res) => {
  res.status(200).json(req.captain);
};

module.exports.updateCaptainProfile = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { fullname, phone } = req.body;
  try {
    const updateData = {};
    if (fullname) {
      if (fullname.firstname) updateData['fullname.firstname'] = fullname.firstname;
      if (fullname.lastname) updateData['fullname.lastname'] = fullname.lastname;
    }
    if (phone) updateData.phoneNumber = phone;

    const updatedCaptain = await captainModel.findByIdAndUpdate(
      req.captain._id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select('-password');

    if (!updatedCaptain) {
      return res.status(404).json({ message: 'Captain not found' });
    }

    res.status(200).json(updatedCaptain);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: 'Phone number already in use' });
    }
    res.status(400).json({ message: err.message });
  }
};

module.exports.updateCaptainProfilePic = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const filePath = path.join(__dirname, '../uploads', `${req.captain._id}-${Date.now()}.jpg`);
    fs.renameSync(req.file.path, filePath);

    const profilePicUrl = `/uploads/${path.basename(filePath)}`;
    const updatedCaptain = await captainModel.findByIdAndUpdate(
      req.captain._id,
      { profilePic: profilePicUrl },
      { new: true }
    );

    console.log('Updated captain:', updatedCaptain);
    res.status(200).json({ profilePic: profilePicUrl });
  } catch (err) {
    res.status(500).json({ message: 'Failed to upload profile picture', error: err.message });
  }
};


module.exports.getCaptainStats = async (req, res) => {
  try {
    const captain = req.captain;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todayStats = captain.dailyStats.find(stat =>
      stat.date.toDateString() === today.toDateString()
    ) || { earnings: 0, hoursOnline: 0, tripsCompleted: 0 };
    
    const stats = {
      earningsToday: todayStats.earnings,
      hoursOnline: todayStats.hoursOnline,
      tripsToday: todayStats.tripsCompleted,
      rating: captain.rating,
    };
    
    res.status(200).json(stats);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch stats', error: err.message });
  }
};

module.exports.confirmRide = async (req, res) => {
  const { rideId, captainId } = req.body;
  try {
    const ride = await rideModel.findById(rideId);
    if (!ride) return res.status(404).json({ message: 'Ride not found' });
    
    const captain = await captainModel.findById(captainId);
    if (!captain) return res.status(404).json({ message: 'Captain not found' });
    
    ride.status = 'confirmed';
    ride.captain = captainId;
    await ride.save();
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let todayStats = captain.dailyStats.find(stat =>
      stat.date.toDateString() === today.toDateString()
    );
    
    if (todayStats) {
      todayStats.tripsCompleted += 1;
      todayStats.earnings += ride.fare || 0;
    } else {
      todayStats = {
        date: today,
        tripsCompleted: 1,
        earnings: ride.fare || 0,
        hoursOnline: 0,
      };
      captain.dailyStats.push(todayStats);
    }
    
    await captain.save();
    
    const io = req.app.get('socketio');
    if (io && captain.socketId) {
      io.to(captain.socketId).emit('stats-update', {
        earningsToday: todayStats.earnings,
        hoursOnline: todayStats.hoursOnline,
        tripsToday: todayStats.tripsCompleted,
        rating: captain.rating,
      });
    }
    
    res.status(200).json({ message: 'Ride confirmed', ride });
  } catch (err) {
    res.status(500).json({ message: 'Failed to confirm ride', error: err.message });
  }
};

module.exports.updateHoursOnline = async (captainId, io) => {
  try {
    const captain = await captainModel.findById(captainId);
    if (!captain) return;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let todayStats = captain.dailyStats.find(stat =>
      stat.date.toDateString() === today.toDateString()
    );
    
    if (todayStats) {
      todayStats.hoursOnline += 1 / 60; // Increment by 1 minute
    } else {
      todayStats = {
        date: today,
        tripsCompleted: 0,
        earnings: 0,
        hoursOnline: 1 / 60,
      };
      captain.dailyStats.push(todayStats);
    }
    
    await captain.save();
    
    if (io && captain.socketId) {
      io.to(captain.socketId).emit('stats-update', {
        earningsToday: todayStats.earnings,
        hoursOnline: todayStats.hoursOnline,
        tripsToday: todayStats.tripsCompleted,
        rating: captain.rating,
      });
    }
  } catch (err) {
    console.error('Failed to update hours online:', err);
  }
};

module.exports.getCaptainRideHistory = async (req, res) => {
  try {
    const captainId = req.captain._id;

    const rides = await rideModel.find({ captain: captainId })
    .sort({ createdAt: -1 })
    .select('pickup destination fare status createdAt');
    
    res.status(200).json(rides);
  } catch (err) {
    console.error('Error fetching captain ride history:', err);
    res.status(500).json({ message: 'Failed to fetch ride history', error: err.message });
  }
};

module.exports.updateCaptainStatus = async (req, res) => {
  try {
    const { isOnline } = req.body;
    const captainId = req.captain._id;

    const captain = await captainModel.findById(captainId);
    if (!captain) {
      return res.status(404).json({ message: 'Captain not found' });
    }

    if (isOnline) {
      const serviceModel = require('../models/service.model');
      const servicesStatus = await serviceModel.find().lean();

      let serviceName;
      switch (captain.vehicle.vehicleType) {
        case 'motorcycle':
          serviceName = 'Bike Ride';
          break;
        case 'car':
          serviceName = ['Car', 'Intercity'];
          break;
        case 'auto':
          serviceName = ['Taxi Ride', 'Taxi Booking', 'Taxi Pool'];
          break;
        default:
          serviceName = null;
      }

      if (serviceName) {
        let isServiceDisabled = false;
        if (Array.isArray(serviceName)) {
          isServiceDisabled = serviceName.every(name => {
            const service = servicesStatus.find(s => s.name === name);
            return service && !service.isActive;
          });
        } else {
          const service = servicesStatus.find(s => s.name === serviceName);
          isServiceDisabled = service && !service.isActive;
        }

        if (isServiceDisabled) {
          return res.status(403).json({
            message: `Cannot go online: The ${Array.isArray(serviceName) ? serviceName.join(' and ') : serviceName} service is currently disabled.`,
          });
        }
      }
    }

    captain.isOnline = isOnline;
    await captain.save();

    console.log(`Captain ${captainId} isOnline updated to: ${isOnline}`);

    const io = req.app.get('socketio');
    if (io && captain.socketId) {
      io.to(captain.socketId).emit('status-update', { isOnline });
    }

    res.status(200).json({
      message: `Captain is now ${isOnline ? 'online' : 'offline'}`,
      captain,
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update status', error: err.message });
  }
};

module.exports.updateCaptainPreferences = async (req, res) => {
  try {
    const captainId = req.captain._id;
    const preferences = req.body;

    // Validate preferences (optional, add more checks as needed)
    if (!preferences || typeof preferences !== 'object') {
      return res.status(400).json({ message: 'Invalid preferences data' });
    }

    const updatedCaptain = await captainModel.findByIdAndUpdate(
      captainId,
      { $set: { preferences } },
      { new: true, runValidators: true }
    ).select('-password');

    if (!updatedCaptain) {
      return res.status(404).json({ message: 'Captain not found' });
    }

    console.log('Updated captain preferences:', updatedCaptain.preferences);
    res.status(200).json({ message: 'Preferences updated successfully', captain: updatedCaptain });
  } catch (err) {
    console.error('Error updating preferences:', err.message);
    res.status(500).json({ message: 'Failed to update preferences', error: err.message });
  }
};
module.exports.logoutCaptain = async (req, res) => {
  const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
  if (token) await blackListTokenModel.create({ token });
  res.clearCookie('token');
  res.status(200).json({ message: 'Logout successfully' });
};

module.exports = {
  registerCaptain: module.exports.registerCaptain,
  loginCaptain: module.exports.loginCaptain,
  getCaptainProfile: module.exports.getCaptainProfile,
  updateCaptainProfile: module.exports.updateCaptainProfile,
  updateCaptainProfilePic: module.exports.updateCaptainProfilePic,
  logoutCaptain: module.exports.logoutCaptain,
  getCaptainStats: module.exports.getCaptainStats,
  confirmRide: module.exports.confirmRide,
  updateHoursOnline: module.exports.updateHoursOnline,
  getCaptainRideHistory: module.exports.getCaptainRideHistory,
  updateCaptainStatus: module.exports.updateCaptainStatus, // Added
  updateCaptainPreferences: module.exports.updateCaptainPreferences,
};