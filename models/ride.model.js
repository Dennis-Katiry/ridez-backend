const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
  fareShare: { type: Number, required: true },
  pickup: { type: String, required: true },
  destination: { type: String, required: true },
  pickupCoordinates: {
    lat: { type: Number },
    lng: { type: Number },
  }, // Add coordinates for taxiPool users
  destinationCoordinates: {
    lat: { type: Number },
    lng: { type: Number },
  },
});

const rideSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
  users: [userSchema],
  captain: { type: mongoose.Schema.Types.ObjectId, ref: 'captain' },
  vehicle: { type: String },
  pickup: { type: String },
  destination: { type: String },
  fare: { type: Number },
  vehicleType: { type: String, enum: ['auto', 'car', 'motorcycle'], required: true },
  status: { type: String, enum: ['pending', 'accepted', 'ongoing', 'completed', 'cancelled'], default: 'pending' },
  duration: { type: Number },
  distance: { type: Number },
  paymentID: { type: String },
  orderId: { type: String },
  signature: { type: String },
  paymentStatus: { type: String, enum: ['pending', 'completed'], default: 'pending' },
  otp: { type: String, select: false, required: true },
  feedbackSubmitted: { type: Boolean, default: false },
  feedbackComment: { type: String, default: '' },
  serviceType: { 
    type: String, 
    enum: ['solo', 'intercity', 'taxiBooking', 'taxiPool'], 
    default: 'solo'
  },
  isScheduled: { type: Boolean, default: false },
  scheduledTime: { type: Date },
  pickupCoordinates: {
    lat: { type: Number },
    lng: { type: Number },
  }, // Replace pickupLat and pickupLng with a single object
  destinationCoordinates: {
    lat: { type: Number },
    lng: { type: Number },
  },
}, {
  timestamps: true,
});

rideSchema.index({ user: 1 });
rideSchema.index({ captain: 1 });
rideSchema.index({ status: 1 });

module.exports = mongoose.model('ride', rideSchema);