const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const captainSchema = new mongoose.Schema({
  fullname: {
    firstname: { type: String, required: true },
    lastname: { type: String, required: true },
  },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true, select: false },
  socketId: { type: String },
  vehicle: {
    color: { type: String, required: true },
    plate: { type: String, required: true },
    capacity: { type: Number, required: true },
    vehicleType: { type: String, enum: ['car', 'motorcycle', 'auto'], required: true },
  },
  totalEarnings: { type: Number, default: 0 },
  dailyStats: [{
    date: { type: Date, default: Date.now },
    earnings: { type: Number, default: 0 },
    hoursOnline: { type: Number, default: 0 },
    tripsCompleted: { type: Number, default: 0 },
  }],
  phoneNumber: {
    type: String,
    unique: true,
    minlength: [10, 'Phone number must be at least 10 digits'],
    maxlength: [15, 'Phone number cannot exceed 15 characters'],
    match: [/^\+?[1-9]\d{1,14}$/, 'Please enter a valid phone number'],
    required: false, 
    default: null,
  },
  isOnline: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  profilePic: { type: String, default: null },
  rating: { type: Number, default: 0 },
  ratingCount: { type: Number, default: 0 },
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true }, 
  },
  preferences: {
    ride: {
      vehicleType: { type: String, enum: ['car', 'motorcycle', 'auto'], default: 'car' },
      quietRide: { type: Boolean, default: false },
    },
    notifications: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
    },
  },
  totalRides: { type: Number, default: 0 },
}, { timestamps: true });

captainSchema.index({ socketId: 1 });
captainSchema.index({ location: '2dsphere' }); 
captainSchema.methods.generateAuthToken = function () {
  const token = jwt.sign({ _id: this._id, role: 'captain' }, process.env.JWT_SECRET, { expiresIn: '24h' });
  return token;
};
captainSchema.methods.comparePassword = async function (password) {
  return await bcrypt.compare(password, this.password);
};

captainSchema.statics.hashPassword = async function (password) {
  return await bcrypt.hash(password, 10);
};

const captainModel = mongoose.model('captain', captainSchema);

module.exports = captainModel;
