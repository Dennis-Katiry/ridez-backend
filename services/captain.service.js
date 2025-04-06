const captainModel = require('../models/captain.model');

module.exports.createCaptain = async ({
  firstname, lastname, email, password, phoneNumber, color, plate, capacity, vehicleType, location,
}) => {
  if (!firstname || !lastname || !email || !password || !phoneNumber || !color || !plate || !capacity || !vehicleType) {
    throw new Error('All fields are required');
  }
  
  if (!location || !location.coordinates || location.coordinates.length !== 2) {
    throw new Error('Valid location coordinates are required');
  }

  const captain = await captainModel.create({
    fullname: { firstname, lastname },
    email,
    password,
    phoneNumber, 
    vehicle: { color, plate, capacity, vehicleType },
    location, 
  });
  return captain;
};