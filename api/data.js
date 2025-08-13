const express = require('express');
const router = express.Router();

// @desc    Import data
// @route   POST /api/data/import
// @access  Private
router.post('/import', (req, res) => {
  res.json({ message: 'Import data route - TODO' });
});

// @desc    Export data
// @route   GET /api/data/export
// @access  Private
router.get('/export', (req, res) => {
  res.json({ message: 'Export data route - TODO' });
});

// @desc    Get sheets data
// @route   GET /api/data/sheets
// @access  Private
router.get('/sheets', (req, res) => {
  res.json({ message: 'Get sheets data route - TODO' });
});

module.exports = router; 