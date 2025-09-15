const express = require('express');
const { attendanceVerificationService } = require('../dist/services/attendanceVerificationService');

const router = express.Router();

// Get master data
router.get('/master', async (req, res) => {
  try {
    const result = await attendanceVerificationService.getMasterData();
    res.json({
      success: true,
      data: result.masterRows,
      summary: result.summary
    });
  } catch (error) {
    console.error('Error fetching master data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch master data',
      error: error?.message || 'Unknown error'
    });
  }
});

// Verify attendance data
router.post('/verify', async (req, res) => {
  try {
    const result = await attendanceVerificationService.verifyAttendanceData();
    res.json({
      success: true,
      message: result.message,
      data: result.masterRows,
      summary: result.summary
    });
  } catch (error) {
    console.error('Error verifying attendance data:', error);
    res.status(500).json({
      success: false,
      message: 'Verification failed',
      error: error?.message || 'Unknown error'
    });
  }
});

// Get verification summary
router.get('/summary', async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    const result = await attendanceVerificationService.getMasterData({ fromDate, toDate });
    res.json({
      success: true,
      summary: result.summary
    });
  } catch (error) {
    console.error('Error fetching verification summary:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch verification summary',
      error: error?.message || 'Unknown error'
    });
  }
});

// Get unverified records
router.get('/unverified', async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    const result = await attendanceVerificationService.getUnverifiedRecords({ fromDate, toDate });
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error fetching unverified records:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch unverified records',
      error: error?.message || 'Unknown error'
    });
  }
});

// Manual verification
router.post('/manual-verify', async (req, res) => {
  try {
    const { attendanceId, paymentId, sessionPrice, coachAmount, bgmAmount, managementAmount, mfcAmount } = req.body;
    const result = await attendanceVerificationService.applyManualVerification({
      attendanceId,
      paymentId,
      sessionPrice,
      coachAmount,
      bgmAmount,
      managementAmount,
      mfcAmount
    });
    res.json({
      success: true,
      message: 'Manual verification applied successfully',
      data: result
    });
  } catch (error) {
    console.error('Error applying manual verification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to apply manual verification',
      error: error?.message || 'Unknown error'
    });
  }
});

// Export data
router.get('/export', async (req, res) => {
  try {
    const { fromDate, toDate, format = 'csv' } = req.query;
    const result = await attendanceVerificationService.getMasterData({ fromDate, toDate });
    
    if (format === 'csv') {
      // Convert to CSV format
      const csv = convertToCSV(result.masterRows);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="attendance-verification.csv"');
      res.send(csv);
    } else {
      res.json({
        success: true,
        data: result.masterRows,
        summary: result.summary
      });
    }
  } catch (error) {
    console.error('Error exporting data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export data',
      error: error?.message || 'Unknown error'
    });
  }
});

// Helper function to convert data to CSV
function convertToCSV(data) {
  if (!data || data.length === 0) return '';
  
  const headers = [
    'Customer Name', 'Event Starts At', 'Membership Name', 'Instructors', 'Status',
    'Discount', 'Discount %', 'Verification Status', 'Invoice #', 'Amount',
    'Payment Date', 'Session Price', 'Coach Amount', 'BGM Amount', 'Management Amount', 'MFC Amount'
  ];
  
  const csvRows = [headers.join(',')];
  
  data.forEach(row => {
    const values = [
      `"${row.customerName || ''}"`,
      `"${row.eventStartsAt || ''}"`,
      `"${row.membershipName || ''}"`,
      `"${row.instructors || ''}"`,
      `"${row.status || ''}"`,
      `"${row.discount || ''}"`,
      `"${row.discountPercent || ''}"`,
      `"${row.verificationStatus || ''}"`,
      `"${row.invoiceNumber || ''}"`,
      `"${row.amount || ''}"`,
      `"${row.paymentDate || ''}"`,
      `"${row.sessionPrice || ''}"`,
      `"${row.coachAmount || ''}"`,
      `"${row.bgmAmount || ''}"`,
      `"${row.managementAmount || ''}"`,
      `"${row.mfcAmount || ''}"`
    ];
    csvRows.push(values.join(','));
  });
  
  return csvRows.join('\n');
}

module.exports = router;
