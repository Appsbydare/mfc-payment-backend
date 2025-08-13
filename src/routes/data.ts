import { Router } from 'express';

const router = Router();

// @desc    Upload attendance data
// @route   POST /api/data/upload-attendance
// @access  Private
router.post('/upload-attendance', (req, res) => {
  res.json({ message: 'Upload attendance data - TODO' });
});

// @desc    Upload payment data
// @route   POST /api/data/upload-payments
// @access  Private
router.post('/upload-payments', (req, res) => {
  res.json({ message: 'Upload payment data - TODO' });
});

// @desc    Get attendance data
// @route   GET /api/data/attendance
// @access  Private
router.get('/attendance', (req, res) => {
  res.json({ message: 'Get attendance data - TODO' });
});

// @desc    Get payment data
// @route   GET /api/data/payments
// @access  Private
router.get('/payments', (req, res) => {
  res.json({ message: 'Get payment data - TODO' });
});

export default router; 