import { Router } from 'express';

const router = Router();

// @desc    Generate monthly report
// @route   POST /api/reports/monthly
// @access  Private
router.post('/monthly', (req, res) => {
  res.json({ message: 'Generate monthly report - TODO' });
});

// @desc    Generate coach payslip
// @route   POST /api/reports/payslip
// @access  Private
router.post('/payslip', (req, res) => {
  res.json({ message: 'Generate coach payslip - TODO' });
});

// @desc    Generate BGM report
// @route   POST /api/reports/bgm
// @access  Private
router.post('/bgm', (req, res) => {
  res.json({ message: 'Generate BGM report - TODO' });
});

// @desc    Get report history
// @route   GET /api/reports/history
// @access  Private
router.get('/history', (req, res) => {
  res.json({ message: 'Get report history - TODO' });
});

export default router; 