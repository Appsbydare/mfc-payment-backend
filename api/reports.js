const express = require('express');
const router = express.Router();

// @desc    Get payment reports
// @route   GET /api/reports/payments
// @access  Private
router.get('/payments', (req, res) => {
  res.json({ message: 'Get payment reports route - TODO' });
});

// @desc    Export reports
// @route   POST /api/reports/export
// @access  Private
router.post('/export', (req, res) => {
  res.json({ message: 'Export reports route - TODO' });
});

module.exports = router; 