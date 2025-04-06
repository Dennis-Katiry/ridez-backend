const userModel = require('../models/user.model');
const userService = require('../services/user.service');
const { validationResult } = require('express-validator');
const blackListTokenModel = require('../models/blackListToken.model');
const path = require('path');
const fs = require('fs');

module.exports.registerUser = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { fullname, email, password } = req.body;

  const isUserAlready = await userModel.findOne({ email });
  if (isUserAlready) {
    return res.status(400).json({ message: 'User already exists' });
  }

  const hashedPassword = await userModel.hashPassword(password);

  const user = await userService.createUser({
    firstname: fullname.firstname,
    lastname: fullname.lastname,
    email,
    password: hashedPassword,
  });

  const token = user.generateAuthToken();
  res.status(201).json({ token, user });
};

module.exports.loginUser = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email, password } = req.body;

  const user = await userModel.findOne({ email }).select('+password');
  if (!user || !(await user.comparePassword(password))) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  const token = user.generateAuthToken();
  res.cookie('token', token, { httpOnly: true });
  res.status(200).json({ token, user: user.toObject({ getters: true, virtuals: false }) });
};

module.exports.getUserProfile = async (req, res) => {
  res.status(200).json(req.user);
};

module.exports.updateProfile = async (req, res, next) => {
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

    const updatedUser = await userModel.findByIdAndUpdate(
      req.user._id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select('-password');

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json(updatedUser);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: 'Phone number already in use' });
    }
    res.status(400).json({ message: err.message });
  }
};

module.exports.updateProfilePic = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const filePath = path.join(__dirname, '../uploads', `${req.user._id}-${Date.now()}.jpg`);
    fs.renameSync(req.file.path, filePath); // Move and rename file

    const profilePicUrl = `/uploads/${path.basename(filePath)}`; // URL for frontend
    const updatedUser = await userModel.findByIdAndUpdate(
      req.user._id,
      { profilePic: profilePicUrl },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    console.log('Updated user:', updatedUser); // Debug log
    res.status(200).json({ profilePic: profilePicUrl });
  } catch (err) {
    console.error('Error updating profile picture:', err); // Log the error for debugging
    res.status(500).json({ message: 'Failed to upload profile picture', error: err.message });
  }
};

module.exports.logoutUser = async (req, res, next) => {
  const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
  if (token) {
    await blackListTokenModel.create({ token });
  }
  res.clearCookie('token');
  res.status(200).json({ message: 'Logged out' });
};

module.exports.requestPasswordReset = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email } = req.body;
  try {
    const resetToken = await userService.requestPasswordReset(email);
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Password Reset Request',
      text: `Click this link to reset your password: http://localhost:5173/reset-password?token=${resetToken}`,
    };

    await transporter.sendMail(mailOptions);
    res.status(200).json({ message: 'Password reset link sent to your email' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

module.exports.resetPassword = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { token, newPassword } = req.body;
  try {
    const user = await userService.resetPassword(token, newPassword);
    res.status(200).json({ message: 'Password reset successfully', user });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

module.exports.updatePreferences = async (req, res) => {
  try {
    console.log("User ID:", req.user._id);
    console.log("Received preferences:", JSON.stringify(req.body, null, 2));
    const updatedUser = await userModel.findByIdAndUpdate(
      req.user._id,
      { preferences: req.body },
      { new: true, runValidators: true }
    );
    if (!updatedUser) {
      console.log("User not found for ID:", req.user._id);
      return res.status(404).json({ message: "User not found" });
    }
    console.log("Updated preferences:", JSON.stringify(updatedUser.preferences, null, 2));
    res.status(200).json(updatedUser.preferences);
  } catch (err) {
    console.error("Error in updatePreferences:", err.message);
    console.error("Stack trace:", err.stack);
    res.status(500).json({ message: "Failed to update preferences", error: err.message });
  }
};