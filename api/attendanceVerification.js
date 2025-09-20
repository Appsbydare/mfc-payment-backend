const express = require('express');
const { attendanceVerificationService } = require('../dist/services/attendanceVerificationService');
const { invoiceVerificationService } = require('./invoiceVerificationService');

const router = express.Router();

// Align serverless routes with TypeScript router implementation

// @desc Get attendance verification master data
// @route GET /api/attendance-verification/master
router.get('/master', async (req, res) => {
  try {
    const { fromDate, toDate } = req.query || {};
    const result = await attendanceVerificationService.verifyAttendanceData({ fromDate, toDate });
    res.json({ success: true, data: result.masterRows, summary: result.summary });
  } catch (error) {
    console.error('Error loading master verification data:', error);
    res.status(500).json({ success: false, error: error?.message || 'Failed to load verification data' });
  }
});

// @desc Verify payments and update master table
// @route POST /api/attendance-verification/verify
router.post('/verify', async (req, res) => {
  try {
    const { fromDate, toDate, forceReverify = true } = req.body || {};

    // Determine if new attendance records exist
    const existingMaster = await attendanceVerificationService.loadExistingMasterData();
    const { attendance, payments } = await attendanceVerificationService['loadAllData']();
    const filteredAttendance = attendanceVerificationService['filterAttendanceByDate'](attendance, fromDate, toDate);
    const filteredPayments = attendanceVerificationService['filterPaymentsByDate'](payments, fromDate, toDate);

    const existingKeys = new Set((existingMaster || []).map(r => r.uniqueKey));
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
          verificationRate: existingMaster.length > 0 ? (existingMaster.filter(r => r.verificationStatus === 'Verified').length / existingMaster.length) * 100 : 0,
          newRecordsAdded: 0
        }
      });
    }

    const result = await attendanceVerificationService.verifyAttendanceData({ fromDate, toDate, forceReverify });
    res.json({ success: true, message: `Verification complete. ${result.summary.newRecordsAdded || 0} new records processed.`, data: result.masterRows, summary: result.summary });
  } catch (error) {
    console.error('Error during verification:', error);
    res.status(500).json({ success: false, error: error?.message || 'Verification failed' });
  }
});

// @desc Get verification summary statistics
// @route GET /api/attendance-verification/summary
router.get('/summary', async (req, res) => {
  try {
    const { fromDate, toDate } = req.query || {};
    const masterData = await attendanceVerificationService.loadExistingMasterData();
    let filteredData = masterData;
    if (fromDate || toDate) {
      filteredData = masterData.filter(row => {
        const rowDate = new Date(row.eventStartsAt);
        if (fromDate && rowDate < new Date(fromDate)) return false;
        if (toDate && rowDate > new Date(toDate)) return false;
        return true;
      });
    }
    const summary = {
      totalRecords: filteredData.length,
      verifiedRecords: filteredData.filter(r => r.verificationStatus === 'Verified').length,
      unverifiedRecords: filteredData.filter(r => r.verificationStatus === 'Not Verified').length,
      verificationRate: filteredData.length > 0 ? (filteredData.filter(r => r.verificationStatus === 'Verified').length / filteredData.length) * 100 : 0,
      totalAmount: filteredData.reduce((s, r) => s + (r.amount || 0), 0),
      totalSessionPrice: filteredData.reduce((s, r) => s + (r.sessionPrice || 0), 0),
      totalCoachAmount: filteredData.reduce((s, r) => s + (r.coachAmount || 0), 0),
      totalBgmAmount: filteredData.reduce((s, r) => s + (r.bgmAmount || 0), 0),
      totalManagementAmount: filteredData.reduce((s, r) => s + (r.managementAmount || 0), 0),
      totalMfcAmount: filteredData.reduce((s, r) => s + (r.mfcAmount || 0), 0)
    };
    res.json({ success: true, data: summary });
  } catch (error) {
    console.error('Error loading verification summary:', error);
    res.status(500).json({ success: false, error: error?.message || 'Failed to load verification summary' });
  }
});

// @desc Manually verify a specific attendance record
// @route POST /api/attendance-verification/manual-verify
router.post('/manual-verify', async (req, res) => {
  try {
    const { uniqueKey, invoiceNumber, customerName } = req.body || {};
    if (!uniqueKey || !invoiceNumber) {
      return res.status(400).json({ success: false, error: 'Unique key and invoice number are required' });
    }
    const masterData = await attendanceVerificationService.loadExistingMasterData();
    const updated = masterData.map(row => row.uniqueKey === uniqueKey ? { ...row, verificationStatus: 'Verified', invoiceNumber, updatedAt: new Date().toISOString() } : row);
    await attendanceVerificationService['saveMasterData'](updated);
    res.json({ success: true, message: 'Record manually verified successfully' });
  } catch (error) {
    console.error('Error in manual verification:', error);
    res.status(500).json({ success: false, error: error?.message || 'Manual verification failed' });
  }
});

// @desc Get unverified records for manual review
// @route GET /api/attendance-verification/unverified
router.get('/unverified', async (req, res) => {
  try {
    const { fromDate, toDate } = req.query || {};
    const masterData = await attendanceVerificationService.loadExistingMasterData();
    let unverified = masterData.filter(row => row.verificationStatus === 'Not Verified');
    if (fromDate || toDate) {
      unverified = unverified.filter(row => {
        const rowDate = new Date(row.eventStartsAt);
        if (fromDate && rowDate < new Date(fromDate)) return false;
        if (toDate && rowDate > new Date(toDate)) return false;
        return true;
      });
    }
    res.json({ success: true, data: unverified, count: unverified.length });
  } catch (error) {
    console.error('Error loading unverified records:', error);
    res.status(500).json({ success: false, error: error?.message || 'Failed to load unverified records' });
  }
});

// @desc Export verification data to CSV
// @route GET /api/attendance-verification/export
router.get('/export', async (req, res) => {
  try {
    const { fromDate, toDate, format = 'csv' } = req.query || {};
    const masterData = await attendanceVerificationService.loadExistingMasterData();
    let filtered = masterData;
    if (fromDate || toDate) {
      filtered = masterData.filter(row => {
        const rowDate = new Date(row.eventStartsAt);
        if (fromDate && rowDate < new Date(fromDate)) return false;
        if (toDate && rowDate > new Date(toDate)) return false;
        return true;
      });
    }
    if (format === 'csv') {
      const headers = ['Customer Name','Event Starts At','Membership Name','Instructors','Status','Discount','Discount %','Verification Status','Invoice #','Amount','Payment Date','Session Price','Coach Amount','BGM Amount','Management Amount','MFC Amount'];
      const csv = [headers.join(',')].concat(filtered.map(r => [
        `"${r.customerName}"`,`"${r.eventStartsAt}"`,`"${r.membershipName}"`,`"${r.instructors}"`,`"${r.status}"`,`"${r.discount}"`,r.discountPercentage,`"${r.verificationStatus}"`,`"${r.invoiceNumber}"`,r.amount,`"${r.paymentDate}"`,r.sessionPrice,r.coachAmount,r.bgmAmount,r.managementAmount,r.mfcAmount
      ].join(','))).join('\n');
      res.setHeader('Content-Type','text/csv');
      res.setHeader('Content-Disposition',`attachment; filename="attendance_verification_${new Date().toISOString().split('T')[0]}.csv"`);
      return res.send(csv);
    }
    res.json({ success: true, data: filtered });
  } catch (error) {
    console.error('Error exporting verification data:', error);
    res.status(500).json({ success: false, error: error?.message || 'Export failed' });
  }
});

// @desc Rewrite master verification sheet from current computed data
// @route POST /api/attendance-verification/rewrite
router.post('/rewrite', async (req, res) => {
  try {
    const { fromDate, toDate } = req.body || {};
    const result = await attendanceVerificationService.verifyAttendanceData({ fromDate, toDate, forceReverify: true });
    res.json({ success: true, message: 'Master sheet rewritten successfully', summary: result.summary });
  } catch (error) {
    console.error('Error rewriting master sheet:', error);
    res.status(500).json({ success: false, error: error?.message || 'Rewrite failed' });
  }
});

// Invoice Verification routes
router.get('/invoices', async (req, res) => {
  try {
    const invoices = await invoiceVerificationService.loadInvoiceVerificationData();
    res.json({ success: true, data: invoices });
  } catch (error) {
    console.error('Error loading invoice verification data:', error);
    res.status(500).json({ success: false, error: error?.message || 'Failed to load invoice verification data' });
  }
});

router.post('/invoices/initialize', async (req, res) => {
  try {
    const invoices = await invoiceVerificationService.initializeInvoiceVerification();
    await invoiceVerificationService.saveInvoiceVerificationData(invoices);
    res.json({ success: true, message: 'Invoice verification data initialized successfully', data: invoices });
  } catch (error) {
    console.error('Error initializing invoice verification data:', error);
    res.status(500).json({ success: false, error: error?.message || 'Failed to initialize invoice verification data' });
  }
});

router.delete('/invoices', async (req, res) => {
  try {
    await invoiceVerificationService.saveInvoiceVerificationData([]);
    res.json({ success: true, message: 'Invoice verification data cleared successfully' });
  } catch (error) {
    console.error('Error clearing invoice verification data:', error);
    res.status(500).json({ success: false, error: error?.message || 'Failed to clear invoice verification data' });
  }
});

// Simple testing endpoint
router.post('/test', async (req, res) => {
  try {
    console.log('🧪 Testing endpoint called');
    
    // Test 1: Basic connectivity test
    console.log('📋 Test 1: Basic connectivity test...');
    console.log('✅ Backend is responding');
    
    // Test 2: Check if services are available
    console.log('📋 Test 2: Checking service availability...');
    const services = {
      attendanceVerificationService: !!attendanceVerificationService,
      invoiceVerificationService: !!invoiceVerificationService
    };
    console.log('✅ Service availability check completed:', services);
    
    // Test 3: Try to access Google Sheets service
    console.log('📋 Test 3: Testing Google Sheets connectivity...');
    try {
      const { googleSheetsService } = require('../dist/services/googleSheets');
      if (googleSheetsService) {
        console.log('✅ Google Sheets service is available');
      } else {
        console.log('⚠️ Google Sheets service not available');
      }
    } catch (gsError) {
      console.log('⚠️ Google Sheets service error:', gsError.message);
    }
    
    // Test 4: Try to read a simple sheet
    console.log('📋 Test 4: Testing sheet reading...');
    try {
      const { googleSheetsService } = require('../dist/services/googleSheets');
      if (googleSheetsService) {
        // Try to read a simple sheet to test connectivity
        const testData = await googleSheetsService.readSheet('Payments');
        console.log(`✅ Successfully read Payments sheet: ${testData.length} records`);
      }
    } catch (readError) {
      console.log('⚠️ Sheet reading error:', readError.message);
    }
    
    res.json({ 
      success: true, 
      message: 'Basic tests completed!',
      data: {
        services,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'production'
      }
    });
    
  } catch (error) {
    console.error('❌ Testing failed:', error);
    res.status(500).json({ 
      success: false, 
      error: error?.message || 'Testing failed',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
