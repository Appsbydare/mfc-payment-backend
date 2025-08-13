import { Router } from 'express';

const router = Router();

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
router.post('/register', (req, res) => {
  res.json({ message: 'Register route - TODO' });
});

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
router.post('/login', (req, res) => {
  res.json({ message: 'Login route - TODO' });
});

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
router.get('/me', (req, res) => {
  res.json({ message: 'Get current user - TODO' });
});

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
router.post('/logout', (req, res) => {
  res.json({ message: 'Logout route - TODO' });
});

export default router; 