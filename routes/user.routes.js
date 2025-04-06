const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const userController = require('../controllers/user.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

router.post('/register', [
    body('email').isEmail().withMessage('Invalid Email'),
    body('fullname.firstname').isLength({ min: 3 }).withMessage('First name must be at least 3 characters long'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long')
],
    userController.registerUser
)

router.post('/login', [
    body('email').isEmail().withMessage('Invalid Email'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long')
],
    userController.loginUser
)

router.post(
    '/request-password-reset',
    body('email').isEmail().withMessage('Invalid email address'),
    userController.requestPasswordReset
);

router.post(
    '/reset-password',
    body('token').notEmpty().withMessage('Reset token is required'),
    body('newPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
    userController.resetPassword
);

router.get('/me', authMiddleware.authUser, userController.getUserProfile);

router.put(
    '/update-profile',
    authMiddleware.authUser,
    [
        body('fullname.firstname').optional().isLength({ min: 3 }).withMessage('First name must be at least 3 characters long'),
        body('fullname.lastname').optional().isLength({ min: 3 }).withMessage('Last name must be at least 3 characters long'),
        body('phone')
            .optional()
            .isMobilePhone().withMessage('Invalid phone number')
            .isLength({ min: 10, max: 15 }).withMessage('Phone number must be 10-15 digits'),
    ],
    userController.updateProfile
);

router.put('/update-profile-pic',
    authMiddleware.authUser,
    upload.single('profilePic'),
    userController.updateProfilePic
);

router.get('/logout', authMiddleware.authUser, userController.logoutUser)

router.put('/preferences', authMiddleware.authUser, userController.updatePreferences);

module.exports = router;
