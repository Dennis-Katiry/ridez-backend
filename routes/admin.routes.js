const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const adminController = require('../controllers/admin.controller');
const captainController = require('../controllers/captain.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.post('/login', [
  body('email').isEmail().withMessage('Invalid Email'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
], adminController.loginAdmin);

router.get('/captains', authMiddleware.authAdmin, adminController.getAllCaptains);
router.get('/users', authMiddleware.authAdmin, adminController.getAllUsers);
router.get('/captains/:id', authMiddleware.authAdmin, adminController.getCaptainDetails);
router.get('/users/:id', authMiddleware.authAdmin, adminController.getUserDetails);

router.get('/stats', authMiddleware.authAdmin, adminController.getStats);
router.get('/recent-bookings', authMiddleware.authAdmin, adminController.getRecentBookings);
router.post('/toggle-service', authMiddleware.authAdmin, [
  body('serviceName').isIn(['Bike Ride', 'Car', 'Taxi Ride', 'Intercity', 'Taxi Booking', 'Taxi Pool']).withMessage('Invalid service name'),
  body('isActive').isBoolean().withMessage('isActive must be a boolean'),
], adminController.toggleServiceStatus);

router.get('/rides/history', authMiddleware.authCaptain, captainController.getCaptainRideHistory);

router.get('/scheduled-rides', authMiddleware.authAdmin, adminController.getScheduledRides);
router.post('/assign-captain', authMiddleware.authAdmin, adminController.assignCaptain);
router.get('/available-captains', authMiddleware.authAdmin, adminController.getAvailableCaptains);
router.get('/generate-report', authMiddleware.authAdmin, adminController.generateReport);
router.put('/users/:userId/toggle-status', authMiddleware.authAdmin, adminController.toggleUserStatus);
router.put('/captains/:captainId/toggle', authMiddleware.authAdmin, adminController.toggleCaptainStatus);

module.exports = router;