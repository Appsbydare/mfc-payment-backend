const express = require('express');
const { attendanceVerificationService } = require('../dist/services/attendanceVerificationService');
const { invoiceVerificationService } = require('../dist/services/invoiceVerificationService');

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
      const headers = ['Customer Name','Event Starts At','Membership Name','Instructors','Status','Discount','Discount %','Verification Status','Invoice #','Amount','Payment Date','Package Price','Session Price','Discounted Session Price','Coach Amount','BGM Amount','Management Amount','MFC Amount'];
      const csv = [headers.join(',')].concat(filtered.map(r => [
        `"${r.customerName}"`,`"${r.eventStartsAt}"`,`"${r.membershipName}"`,`"${r.instructors}"`,`"${r.status}"`,`"${r.discount}"`,r.discountPercentage,`"${r.verificationStatus}"`,`"${r.invoiceNumber}"`,r.amount,`"${r.paymentDate}"`,r.packagePrice,r.sessionPrice,r.discountedSessionPrice,r.coachAmount,r.bgmAmount,r.managementAmount,r.mfcAmount
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

// @desc Rewrite master sheet - USING SAME LOGIC AS VERIFY PAYMENT
// @route POST /api/attendance-verification/rewrite-master
router.post('/rewrite-master', async (req, res) => {
  try {
    console.log('🔄 Starting rewrite master process using same logic as verify payment...');
    
    // Import Google Sheets service
    const { googleSheetsService } = require('../src/services/googleSheets');
    
    // Read current data from payment_calc_detail sheet
    const sheetData = await googleSheetsService.readSheet('payment_calc_detail');
    
    if (!sheetData || sheetData.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No data found in payment_calc_detail sheet. Please run verification first.'
      });
    }
    
    console.log(`📊 Found ${sheetData.length} rows in payment_calc_detail sheet`);
    
    // Convert the raw sheet data to the same object format used by verify payment
    const dataObjects = sheetData.map((row) => ({
      'Customer Name': row['Customer Name'] || row['customerName'] || '',
      'Event Starts At': row['Event Starts At'] || row['eventStartsAt'] || row['Event Starts'] || '',
      'Membership Name': row['Membership Name'] || row['membershipName'] || '',
      'Instructors': row['Instructors'] || row['instructors'] || '',
      'Status': row['Status'] || row['status'] || '',
      'Discount': row['Discount'] || row['discount'] || '',
      'Discount %': row['Discount %'] || row['discountPercentage'] || 0,
      'Verification Status': row['Verification Status'] || row['verificationStatus'] || '',
      'Invoice #': row['Invoice #'] || row['invoiceNumber'] || '',
      'Amount': row['Amount'] || row['amount'] || 0,
      'Payment Date': row['Payment Date'] || row['paymentDate'] || '',
      'Package Price': row['Package Price'] || row['packagePrice'] || 0,
      'Session Price': row['Session Price'] || row['sessionPrice'] || 0,
      'Discounted Session Price': row['Discounted Session Price'] || row['discountedSessionPrice'] || 0,
      'Coach Amount': row['Coach Amount'] || row['coachAmount'] || 0,
      'BGM Amount': row['BGM Amount'] || row['bgmAmount'] || 0,
      'Management Amount': row['Management Amount'] || row['managementAmount'] || 0,
      'MFC Amount': row['MFC Amount'] || row['mfcAmount'] || 0,
      'UniqueKey': row['UniqueKey'] || row['uniqueKey'] || '',
      'CreatedAt': row['CreatedAt'] || row['createdAt'] || new Date().toISOString(),
      'UpdatedAt': row['UpdatedAt'] || row['updatedAt'] || new Date().toISOString()
    }));
    
    // Use the exact same method as the verification process
    await googleSheetsService.writeSheet('payment_calc_detail', dataObjects);
    
    console.log('✅ Master sheet rewritten successfully using same logic as verify payment');
    
    res.json({
      success: true,
      message: `Master sheet rewritten successfully with ${dataObjects.length} records`,
      recordCount: dataObjects.length
    });
    
  } catch (error) {
    console.error('❌ Error in rewrite master:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to rewrite master sheet'
    });
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

// @desc Add discounts to verified data (Step 1)
// @route POST /api/attendance-verification/add-discounts
router.post('/add-discounts', async (req, res) => {
  try {
    console.log('🔍 Starting Add Discounts process...');
    
    // Load current master data
    const masterData = await attendanceVerificationService.loadExistingMasterData();
    if (masterData.length === 0) {
      return res.json({
        success: false,
        message: 'No verified data found. Please run verification first.'
      });
    }
    
    // Load payments and discounts data
    const { payments, discounts } = await attendanceVerificationService['loadAllData']();
    
    // Apply discounts to master data
    const updatedMasterData = await attendanceVerificationService['applyDiscountsToMasterData'](masterData, discounts, payments);
    
    // Save updated master data
    await attendanceVerificationService.saveMasterData(updatedMasterData);
    
    const discountAppliedCount = updatedMasterData.filter(r => r.discount && r.discountPercentage > 0).length;
    
    console.log(`✅ Add Discounts complete: ${discountAppliedCount} records updated with discounts`);
    
    res.json({
      success: true,
      message: `Discounts added to ${discountAppliedCount} records`,
      data: updatedMasterData,
      summary: {
        totalRecords: updatedMasterData.length,
        discountAppliedCount: discountAppliedCount
      }
    });
    
  } catch (error) {
    console.error('Error adding discounts:', error);
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to add discounts'
    });
  }
});

// @desc Recalculate amounts with discounted prices (Step 2)
// @route POST /api/attendance-verification/recalculate-discounts
router.post('/recalculate-discounts', async (req, res) => {
  try {
    console.log('💰 Starting Recalculate Discounts process...');
    
    // Load current master data
    const masterData = await attendanceVerificationService.loadExistingMasterData();
    if (masterData.length === 0) {
      return res.json({
        success: false,
        message: 'No verified data found. Please run verification first.'
      });
    }
    
    // Recalculate amounts for records with discounts
    const updatedMasterData = await attendanceVerificationService['recalculateDiscountedAmounts'](masterData);
    
    // Save updated master data
    await attendanceVerificationService.saveMasterData(updatedMasterData);
    
    const recalculatedCount = updatedMasterData.filter(r => r.discount && r.discountPercentage > 0).length;
    
    console.log(`✅ Recalculate Discounts complete: ${recalculatedCount} records recalculated`);
    
    res.json({
      success: true,
      message: `Amounts recalculated for ${recalculatedCount} discounted records`,
      data: updatedMasterData,
      summary: {
        totalRecords: updatedMasterData.length,
        recalculatedCount: recalculatedCount
      }
    });
    
  } catch (error) {
    console.error('Error recalculating discounts:', error);
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to recalculate discounts'
    });
  }
});

// Test discount functionality without Google Sheets
router.post('/test-discounts', async (req, res) => {
  try {
    console.log('🧪 Testing discount functionality...');
    
    // Mock data for testing
    const mockDiscounts = [
      { name: 'MindBody Switch', active: true, applicable_percentage: 10 },
      { name: 'Freedom Pass', active: true, applicable_percentage: 15 },
      { name: 'Staff Discount', active: true, applicable_percentage: 20 },
      { name: '10 EURO DISCOUNT', active: true, applicable_percentage: 10 },
      { name: 'BOXING DISCOUNT', active: true, applicable_percentage: 25 }
    ];
    
    const mockPayments = [
      { Invoice: 'INV001', Memo: 'MindBody Switch', Amount: 100 },
      { Invoice: 'INV002', Memo: 'Freedom Pass', Amount: 150 },
      { Invoice: 'INV003', Memo: 'Staff Discount', Amount: 200 },
      { Invoice: 'INV004', Memo: '10 EURO DISCOUNT', Amount: 50 },
      { Invoice: 'INV005', Memo: 'BOXING DISCOUNT', Amount: 80 }
    ];
    
    const mockMasterData = [
      { invoiceNumber: 'INV001', customerName: 'Test Customer 1', amount: 100 },
      { invoiceNumber: 'INV002', customerName: 'Test Customer 2', amount: 150 },
      { invoiceNumber: 'INV003', customerName: 'Test Customer 3', amount: 200 },
      { invoiceNumber: 'INV004', customerName: 'Test Customer 4', amount: 50 },
      { invoiceNumber: 'INV005', customerName: 'Test Customer 5', amount: 80 }
    ];
    
    // Test the discount application logic
    const result = await attendanceVerificationService['applyDiscountsToMasterData'](mockMasterData, mockDiscounts, mockPayments);
    
    const discountAppliedCount = result.filter(row => row.discountApplied).length;
    
    res.json({
      success: true,
      message: `Test completed: ${discountAppliedCount} discounts applied out of ${result.length} records`,
      data: result,
      summary: {
        totalRecords: result.length,
        discountAppliedCount: discountAppliedCount,
        availableDiscounts: mockDiscounts.length,
        testPayments: mockPayments.length
      }
    });
    
  } catch (error) {
    console.error('❌ Test discount error:', error);
    res.status(500).json({
      success: false,
      message: 'Test failed: ' + error.message
    });
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
    
    // Test 5: Try to write dummy data to Inv_Verification sheet
    console.log('📋 Test 5: Testing sheet writing with dummy data...');
    try {
      const { googleSheetsService } = require('../dist/services/googleSheets');
      if (googleSheetsService) {
        // Create dummy invoice verification data
        const dummyData = [{
          'Invoice Number': 'TEST-001',
          'Customer Name': 'Test Customer',
          'Total Amount': 100.00,
          'Used Amount': 0.00,
          'Remaining Balance': 100.00,
          'Status': 'Available',
          'Sessions Used': 0,
          'Total Sessions': 0,
          'Last Used Date': '2025-09-20',
          'Created At': new Date().toISOString(),
          'Updated At': new Date().toISOString()
        }];
        
        // Try to write dummy data
        await googleSheetsService.writeSheet('Inv_Verification', dummyData);
        console.log('✅ Successfully wrote dummy data to Inv_Verification sheet');
      }
    } catch (writeError) {
      console.log('⚠️ Sheet writing error:', writeError.message);
    }
    
    // Test 6: Check if all required data is available for verification
    console.log('📋 Test 6: Checking required data for verification...');
    let dataCheck = {
      attendance: 0,
      payments: 0,
      rules: 0,
      discounts: 0
    };
    
    try {
      const { googleSheetsService } = require('../dist/services/googleSheets');
      if (googleSheetsService) {
        // Check attendance data
        try {
          const attendanceData = await googleSheetsService.readSheet('attendance');
          dataCheck.attendance = attendanceData.length;
          console.log(`✅ Attendance data: ${attendanceData.length} records`);
        } catch (err) {
          console.log('⚠️ Attendance data error:', err.message);
        }
        
        // Check payments data
        try {
          const paymentsData = await googleSheetsService.readSheet('Payments');
          dataCheck.payments = paymentsData.length;
          console.log(`✅ Payments data: ${paymentsData.length} records`);
        } catch (err) {
          console.log('⚠️ Payments data error:', err.message);
        }
        
        // Check rules data
        try {
          const rulesData = await googleSheetsService.readSheet('rules');
          dataCheck.rules = rulesData.length;
          console.log(`✅ Rules data: ${rulesData.length} records`);
        } catch (err) {
          console.log('⚠️ Rules data error:', err.message);
        }
        
        // Check discounts data
        try {
          const discountsData = await googleSheetsService.readSheet('discounts');
          dataCheck.discounts = discountsData.length;
          console.log(`✅ Discounts data: ${discountsData.length} records`);
        } catch (err) {
          console.log('⚠️ Discounts data error:', err.message);
        }
      }
    } catch (dataError) {
      console.log('⚠️ Data check error:', dataError.message);
    }
    
    // Test 7: Try to use the invoice verification service
    console.log('📋 Test 7: Testing invoice verification service...');
    try {
      if (invoiceVerificationService) {
        // Try to initialize invoice verification
        const initResult = await invoiceVerificationService.initializeInvoiceVerification();
        console.log(`✅ Invoice verification service initialized: ${initResult.length} records`);
        
        // Try to save the data
        await invoiceVerificationService.saveInvoiceVerificationData(initResult);
        console.log('✅ Invoice verification data saved successfully');
      }
    } catch (ivError) {
      console.log('⚠️ Invoice verification service error:', ivError.message);
    }
    
    res.json({ 
      success: true, 
      message: 'All tests completed!',
      data: {
        services,
        dataCheck,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'production',
        testsCompleted: [
          'Basic connectivity',
          'Service availability',
          'Google Sheets connectivity',
          'Sheet reading',
          'Sheet writing with dummy data',
          'Data availability check',
          'Invoice verification service'
        ]
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
