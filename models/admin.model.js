const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const adminSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true, select: false },
  fullname: {
    firstname: { type: String, required: true },
    lastname: { type: String },
  },
  socketId: { type: String }, 
}, { timestamps: true });

adminSchema.methods.generateAuthToken = function () {
  const token = jwt.sign({ _id: this._id, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '24h' });
  return token;
};

adminSchema.methods.comparePassword = async function (password) {
  return await bcrypt.compare(password, this.password);
};

adminSchema.statics.hashPassword = async function (password) {
  return await bcrypt.hash(password, 10);
};

const adminModel = mongoose.model('admin', adminSchema);

module.exports = adminModel;