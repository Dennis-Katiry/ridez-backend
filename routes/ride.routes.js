const express = require('express');
const router = express.Router();
const { body, query } = require('express-validator');
const rideController = require('../controllers/ride.controller');
const authMiddleware = require('../middlewares/auth.middleware');


router.post('/create',
    authMiddleware.authUser,
    [
      body('pickup').isString().isLength({ min: 3 }).withMessage('Invalid pickup address'),
      body('destination').isString().isLength({ min: 3 }).withMessage('Invalid destination address'),
      body('vehicleType').isString().isIn(['auto', 'car', 'motorcycle']).withMessage('Invalid vehicle type'), // Changed 'moto' to 'motorcycle'
      body('serviceType').optional().isIn(['solo', 'intercity', 'taxiBooking', 'taxiPool']).withMessage('Invalid service type'),
    ],
    rideController.createRide
  );

router.get('/get-fare',
    authMiddleware.authUser,
    query('pickup').isString().isLength({ min: 3 }).withMessage('Invalid pickup address'),
    query('destination').isString().isLength({ min: 3 }).withMessage('Invalid destination address'),
    rideController.getFare
)

router.post('/confirm',
    authMiddleware.authCaptain,
    body('rideId').isMongoId().withMessage('Invalid ride id'),
    rideController.confirmRide
)

router.get('/start-ride',
    authMiddleware.authCaptain,
    query('rideId').isMongoId().withMessage('Invalid ride id'),
    query('otp').isString().isLength({ min: 6, max: 6 }).withMessage('Invalid OTP'),
    rideController.startRide
)

router.post(
    '/cancel',
    authMiddleware.authUser,
    body('rideId').isMongoId().withMessage('Invalid ride id'),
    rideController.cancelRide
);

router.post('/end-ride',
    authMiddleware.authCaptain,
    body('rideId').isMongoId().withMessage('Invalid ride id'),
    rideController.endRide
)

router.get(
    '/status',
    authMiddleware.authUser,
    query('rideId').isMongoId().withMessage('Invalid ride id'),
    rideController.getRideStatus
);

router.post('/create-payment-order',
    authMiddleware.authUser,
    body('rideId').isMongoId().withMessage('Invalid ride id'),
    rideController.createPaymentOrder
);

router.post('/verify-payment',
    authMiddleware.authUser,
    body('rideId').isMongoId().withMessage('Invalid ride id'),
    body('paymentId').isString().withMessage('Invalid payment ID'),
    body('orderId').isString().withMessage('Invalid order ID'),
    body('signature').isString().withMessage('Invalid signature'),
    rideController.verifyPayment
);

router.post(
    '/submit-feedback',
    authMiddleware.authUser, // Only users can submit feedback
    body('rideId').isMongoId().withMessage('Invalid ride id'),
    body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
    rideController.submitFeedback
  );

router.get('/captain-stats', authMiddleware.authCaptain, rideController.getCaptainStats);

router.get('/user-history', authMiddleware.authUser, rideController.getUserRideHistory);


module.exports = router;