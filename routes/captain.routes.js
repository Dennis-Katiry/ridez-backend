const captainController = require('../controllers/captain.controller');
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authMiddleware = require('../middlewares/auth.middleware');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

router.post('/register', [
  body('email').isEmail().withMessage('Invalid Email'),
  body('fullname.firstname').isLength({ min: 3 }).withMessage('First name must be at least 3 characters long'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
  body('phoneNumber')
    .isMobilePhone().withMessage('Invalid phone number')
    .isLength({ min: 10, max: 15 }).withMessage('Phone number must be 10-15 digits')
    .matches(/^\+?[1-9]\d{1,14}$/).withMessage('Please enter a valid phone number'),
  body('vehicle.color').isLength({ min: 3 }).withMessage('Color must be at least 3 characters long'),
  body('vehicle.plate').isLength({ min: 3 }).withMessage('Plate must be at least 3 characters long'),
  body('vehicle.capacity').isInt({ min: 1 }).withMessage('Capacity must be at least 1'),
  body('vehicle.vehicleType').isIn(['car', 'motorcycle', 'auto']).withMessage('Invalid vehicle type'),
  body('latitude').isFloat({ min: -90, max: 90 }).withMessage('Invalid latitude'),
  body('longitude').isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude'),
], captainController.registerCaptain);

router.post('/login', [
  body('email').isEmail().withMessage('Invalid Email'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
], captainController.loginCaptain);

router.get('/me', authMiddleware.authCaptain, captainController.getCaptainProfile);

router.put(
  '/update-profile',
  authMiddleware.authCaptain,
  [
    body('fullname.firstname').optional().isLength({ min: 3 }).withMessage('First name must be at least 3 characters long'),
    body('fullname.lastname').optional().isLength({ min: 3 }).withMessage('Last name must be at least 3 characters long'),
    body('phone')
      .optional()
      .isMobilePhone().withMessage('Invalid phone number')
      .isLength({ min: 10, max: 15 }).withMessage('Phone number must be 10-15 digits'),
  ],
  captainController.updateCaptainProfile
);

router.put('/update-profile-pic',
  authMiddleware.authCaptain,
  upload.single('profilePic'),
  captainController.updateCaptainProfilePic
);

router.get('/logout', authMiddleware.authCaptain, captainController.logoutCaptain);

router.get('/stats', authMiddleware.authCaptain, captainController.getCaptainStats);

router.post('/rides/confirm', authMiddleware.authCaptain, [
  body('rideId').isMongoId().withMessage('Invalid ride ID'),
  body('captainId').isMongoId().withMessage('Invalid captain ID'),
], captainController.confirmRide);

router.put('/preferences', authMiddleware.authCaptain, captainController.updateCaptainPreferences);

router.get('/rides/history', authMiddleware.authCaptain, captainController.getCaptainRideHistory);

router.put('/update-status', authMiddleware.authCaptain, captainController.updateCaptainStatus);

module.exports = router;