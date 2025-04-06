const userModel = require('../models/user.model');
const captainModel = require('../models/captain.model');
const adminModel = require('../models/admin.model');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const blackListTokenModel = require('../models/blackListToken.model');

const verifyToken = async (token, res) => {
  if (!token) {
    res.status(401).json({ message: 'Unauthorized: No token provided' });
    return null; 
  }

  const isBlacklisted = await blackListTokenModel.findOne({ token });
  if (isBlacklisted) {
    res.status(401).json({ message: 'Unauthorized: Token is blacklisted' });
    return null;
  }

  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    res.status(401).json({ message: 'Unauthorized: Invalid token' });
    return null; 
  }
};

module.exports.authUser = async (req, res, next) => {
  const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
  const decoded = await verifyToken(token, res);
  if (!decoded) return;

  try {
    const user = await userModel.findById(decoded._id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    req.user = user;
    next();
  } catch (err) {
    console.error('Error in authUser:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports.authCaptain = async (req, res, next) => {
  const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
  console.log('Token received:', token);
  const decoded = await verifyToken(token, res);
  if (!decoded) return;

  try {
    console.log('Decoded ID:', decoded._id);
    const captain = await captainModel.findById(decoded._id).select('-password');
    console.log('Captain found:', captain ? 'Yes' : 'No');
    if (!captain) {
      return res.status(404).json({ message: 'Captain not found' });
    }
    req.captain = captain;
    next();
  } catch (err) {
    console.error('Error in authCaptain:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports.authUserOrCaptain = async (req, res, next) => {
  const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
  const decoded = await verifyToken(token, res);
  if (!decoded) return;

  console.log('Decoded token:', decoded); 

  try {
    if (decoded.role === 'user') {
      const user = await userModel.findById(decoded._id).select('-password');
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      req.user = user;
      next();
    } else if (decoded.role === 'captain') {
      const captain = await captainModel.findById(decoded._id).select('-password');
      if (!captain) {
        return res.status(404).json({ message: 'Captain not found' });
      }
      req.captain = captain;
      next();
    } else {
      return res.status(403).json({ message: 'Unauthorized: Invalid role' });
    }
  } catch (err) {
    console.error('Error in authUserOrCaptain:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports.authAdmin = async (req, res, next) => {
  const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
  const decoded = await verifyToken(token, res);
  if (!decoded || decoded.role !== 'admin') {
    if (!decoded) return; 
    return res.status(403).json({ message: 'Unauthorized: Admin access only' });
  }

  try {
    const admin = await adminModel.findById(decoded._id).select('-password');
    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }
    req.admin = admin;
    next();
  } catch (err) {
    console.error('Error in authAdmin:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};