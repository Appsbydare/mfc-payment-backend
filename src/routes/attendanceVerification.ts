import express from 'express';
import { attendanceVerificationService, AttendanceVerificationMasterRow } from '../services/attendanceVerificationService';
import { googleSheetsService } from '../services/googleSheets';

const router = express.Router();

/**
 * @desc    Get attendance verification master data
 * @route   GET /api/attendance-verification/master
 * @access  Private
 */
router.get('/master', async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    
    const result = await attendanceVerificationService.verifyAttendanceData({
      fromDate: fromDate as string,
      toDate: toDate as string
    });
    
    res.json({
      success: true,
      data: result.masterRows,
      summary: result.summary
    });
  } catch (error: any) {
    console.error('Error loading master verification data:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to load verification data'
    });
  }
});

/**
 * @desc    Verify payments and update master table
 * @route   POST /api/attendance-verification/verify
 * @access  Private
 */
router.post('/verify', async (req, res) => {
  try {
    const { fromDate, toDate, forceReverify = true, clearExisting = false } = req.body; // default to true to recompute all
    
    console.log('🔄 Starting verification process...');
    
    // Check if there's new unverified data
    const existingMaster = await attendanceVerificationService.loadExistingMasterData();
    const { attendance, payments } = await attendanceVerificationService['loadAllData']();
    
    // Filter data by date range
    const filteredAttendance = attendanceVerificationService['filterAttendanceByDate'](attendance, fromDate, toDate);
    const filteredPayments = attendanceVerificationService['filterPaymentsByDate'](payments, fromDate, toDate);
    
    // Check if all data is already verified
    const existingKeys = new Set(existingMaster.map(row => row.uniqueKey));
    const newAttendanceCount = filteredAttendance.filter(att => {
      const uniqueKey = attendanceVerificationService['generateUniqueKey'](att);
      return !existingKeys.has(uniqueKey);
    }).length;
    
    if (newAttendanceCount === 0 && !forceReverify) {
      return res.json({
        success: true,
        message: 'Uploaded Data already verified!',
        data: existingMaster,
        summary: {
          totalRecords: existingMaster.length,
          verifiedRecords: existingMaster.filter(r => r.verificationStatus === 'Verified').length,
          unverifiedRecords: existingMaster.filter(r => r.verificationStatus === 'Not Verified').length,
          verificationRate: existingMaster.length > 0 ? 
            (existingMaster.filter(r => r.verificationStatus === 'Verified').length / existingMaster.length) * 100 : 0,
          newRecordsAdded: 0
        }
      });
    }
    
    // Perform verification
    const result = await attendanceVerificationService.verifyAttendanceData({
      fromDate,
      toDate,
      forceReverify,
      clearExisting
    });
    
    console.log(`✅ Verification complete: ${result.summary.newRecordsAdded || 0} new records added`);
    
    res.json({
      success: true,
      message: `Verification complete. ${result.summary.newRecordsAdded || 0} new records processed.`,
      data: result.masterRows,
      summary: result.summary
    });
    
  } catch (error: any) {
    console.error('Error during verification:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Verification failed'
    });
  }
});

/**
 * @desc    Get verification summary statistics
 * @route   GET /api/attendance-verification/summary
 * @access  Private
 */
router.get('/summary', async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    
    const masterData = await attendanceVerificationService.loadExistingMasterData();
    
    // Filter by date range if provided
    let filteredData = masterData;
    if (fromDate || toDate) {
      filteredData = masterData.filter(row => {
        const rowDate = new Date(row.eventStartsAt);
        if (fromDate && rowDate < new Date(fromDate as string)) return false;
        if (toDate && rowDate > new Date(toDate as string)) return false;
        return true;
      });
    }
    
    const summary = {
      totalRecords: filteredData.length,
      verifiedRecords: filteredData.filter(r => r.verificationStatus === 'Verified').length,
      unverifiedRecords: filteredData.filter(r => r.verificationStatus === 'Not Verified').length,
      verificationRate: filteredData.length > 0 ? 
        (filteredData.filter(r => r.verificationStatus === 'Verified').length / filteredData.length) * 100 : 0,
      totalAmount: filteredData.reduce((sum, r) => sum + r.amount, 0),
      totalSessionPrice: filteredData.reduce((sum, r) => sum + r.sessionPrice, 0),
      totalCoachAmount: filteredData.reduce((sum, r) => sum + r.coachAmount, 0),
      totalBgmAmount: filteredData.reduce((sum, r) => sum + r.bgmAmount, 0),
      totalManagementAmount: filteredData.reduce((sum, r) => sum + r.managementAmount, 0),
      totalMfcAmount: filteredData.reduce((sum, r) => sum + r.mfcAmount, 0)
    };
    
    res.json({
      success: true,
      data: summary
    });
    
  } catch (error: any) {
    console.error('Error loading verification summary:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to load verification summary'
    });
  }
});

/**
 * @desc    Manually verify a specific attendance record
 * @route   POST /api/attendance-verification/manual-verify
 * @access  Private
 */
router.post('/manual-verify', async (req, res) => {
  try {
    const { uniqueKey, invoiceNumber, customerName } = req.body;
    
    if (!uniqueKey || !invoiceNumber) {
      return res.status(400).json({
        success: false,
        error: 'Unique key and invoice number are required'
      });
    }
    
    // Load existing master data
    const masterData = await attendanceVerificationService.loadExistingMasterData();
    
    // Find and update the specific record
    const updatedData = masterData.map(row => {
      if (row.uniqueKey === uniqueKey) {
        return {
          ...row,
          verificationStatus: 'Verified' as const,
          invoiceNumber,
          updatedAt: new Date().toISOString()
        };
      }
      return row;
    });
    
    // Save updated data
    await attendanceVerificationService['saveMasterData'](updatedData);
    
    res.json({
      success: true,
      message: 'Record manually verified successfully'
    });
    
  } catch (error: any) {
    console.error('Error in manual verification:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Manual verification failed'
    });
  }
});

/**
 * @desc    Get unverified records for manual review
 * @route   GET /api/attendance-verification/unverified
 * @access  Private
 */
router.get('/unverified', async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    
    const masterData = await attendanceVerificationService.loadExistingMasterData();
    
    // Filter unverified records
    let unverifiedData = masterData.filter(row => row.verificationStatus === 'Not Verified');
    
    // Apply date filter if provided
    if (fromDate || toDate) {
      unverifiedData = unverifiedData.filter(row => {
        const rowDate = new Date(row.eventStartsAt);
        if (fromDate && rowDate < new Date(fromDate as string)) return false;
        if (toDate && rowDate > new Date(toDate as string)) return false;
        return true;
      });
    }
    
    res.json({
      success: true,
      data: unverifiedData,
      count: unverifiedData.length
    });
    
  } catch (error: any) {
    console.error('Error loading unverified records:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to load unverified records'
    });
  }
});

/**
 * @desc    Export verification data to CSV
 * @route   GET /api/attendance-verification/export
 * @access  Private
 */
router.get('/export', async (req, res) => {
  try {
    const { fromDate, toDate, format = 'csv' } = req.query;
    
    const masterData = await attendanceVerificationService.loadExistingMasterData();
    
    // Filter by date range if provided
    let filteredData = masterData;
    if (fromDate || toDate) {
      filteredData = masterData.filter(row => {
        const rowDate = new Date(row.eventStartsAt);
        if (fromDate && rowDate < new Date(fromDate as string)) return false;
        if (toDate && rowDate > new Date(toDate as string)) return false;
        return true;
      });
    }
    
    if (format === 'csv') {
      // Generate CSV
      const headers = [
        'Customer Name', 'Event Starts At', 'Membership Name', 'Instructors', 'Status',
        'Discount', 'Discount %', 'Verification Status', 'Invoice #', 'Amount',
        'Payment Date', 'Session Price', 'Coach Amount', 'BGM Amount', 'Management Amount', 'MFC Amount'
      ];
      
      const csvContent = [
        headers.join(','),
        ...filteredData.map(row => [
          `"${row.customerName}"`,
          `"${row.eventStartsAt}"`,
          `"${row.membershipName}"`,
          `"${row.instructors}"`,
          `"${row.status}"`,
          `"${row.discount}"`,
          row.discountPercentage,
          `"${row.verificationStatus}"`,
          `"${row.invoiceNumber}"`,
          row.amount,
          `"${row.paymentDate}"`,
          row.sessionPrice,
          row.coachAmount,
          row.bgmAmount,
          row.managementAmount,
          row.mfcAmount
        ].join(','))
      ].join('\n');
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="attendance_verification_${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csvContent);
    } else {
      res.json({
        success: true,
        data: filteredData
      });
    }
    
  } catch (error: any) {
    console.error('Error exporting verification data:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Export failed'
    });
  }
});

/**
 * @desc    Rewrite master verification sheet from current computed data
 * @route   POST /api/attendance-verification/rewrite
 * @access  Private
 */
router.post('/rewrite', async (req, res) => {
  try {
    const { fromDate, toDate } = req.body || {};
    const result = await attendanceVerificationService.verifyAttendanceData({ fromDate, toDate, forceReverify: true });
    return res.json({ success: true, message: 'Master sheet rewritten successfully', summary: result.summary });
  } catch (error: any) {
    console.error('Error rewriting master sheet:', error);
    res.status(500).json({ success: false, error: error.message || 'Rewrite failed' });
  }
});

/**
 * @desc    Health check for verification service
 * @route   GET /api/attendance-verification/health
 * @access  Private
 */
router.get('/health', async (req, res) => {
  try {
    const isGoogleSheetsHealthy = await googleSheetsService.healthCheck();
    
    res.json({
      success: true,
      data: {
        googleSheets: isGoogleSheetsHealthy,
        service: 'operational',
        timestamp: new Date().toISOString()
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Health check failed'
    });
  }
});

/**
 * @desc    Clear all master verification data
 * @route   DELETE /api/attendance-verification/master
 * @access  Private
 */
router.delete('/master', async (req, res) => {
  try {
    await attendanceVerificationService.clearMasterData();
    
    res.json({
      success: true,
      message: 'Master verification data cleared successfully'
    });
  } catch (error: any) {
    console.error('Error clearing master verification data:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to clear verification data'
    });
  }
});

export default router;
