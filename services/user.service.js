const userModel = require('../models/user.model');
const crypto = require('crypto'); 

module.exports.createUser = async ({
  firstname, lastname, email, password
}) => {
  if (!firstname || !email || !password) {
    throw new Error('All fields are required');
  }
  const user = userModel.create({
    fullname: {
      firstname,
      lastname
    },
    email,
    password,
  });

  return user;
};

module.exports.requestPasswordReset = async (email) => {
  const user = await userModel.findOne({ email });
  if (!user) {
    throw new Error('User not found');
  }

  const resetToken = user.generatePasswordResetToken();
  await user.save(); 

  return resetToken; 
};

module.exports.resetPassword = async (token, newPassword) => {
  const resetPasswordToken = crypto.createHash('sha256').update(token).digest('hex');
  const user = await userModel.findOne({
    resetPasswordToken,
    resetPasswordExpires: { $gt: Date.now() }, 
  });

  if (!user) {
    throw new Error('Invalid or expired reset token');
  }

  user.password = await userModel.hashPassword(newPassword);
  user.resetPasswordToken = undefined; 
  user.resetPasswordExpires = undefined; 
  await user.save();

  return user;
};