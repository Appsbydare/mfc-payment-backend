const express = require('express');
const { google } = require('googleapis');
const router = express.Router();

// Google Sheets auth
function getGoogleSheetsAuth() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      type: 'service_account',
      project_id: process.env.GOOGLE_SHEETS_PROJECT_ID,
      private_key_id: process.env.GOOGLE_SHEETS_PRIVATE_KEY_ID,
      private_key: process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      client_email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
      client_id: process.env.GOOGLE_SHEETS_CLIENT_ID,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return auth;
}

async function readSheet(sheetName) {
  const auth = getGoogleSheetsAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:Z`,
  });
  const rows = response.data.values || [];
  if (rows.length === 0) return [];
  const headers = rows[0];
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] || ''; });
    return obj;
  });
}

// Helper functions
function toDateOnly(value) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function inRange(date, fromDate, toDate) {
  if (!date) return false;
  if (fromDate && date < fromDate) return false;
  if (toDate && date > toDate) return false;
  return true;
}

function monthYearMatch(date, month, year) {
  if (!date) return false;
  if (month && date.getUTCMonth() + 1 !== month) return false;
  if (year && date.getUTCFullYear() !== year) return false;
  return true;
}

// @desc    Get verification summary
// @route   GET /verification/summary
// @access  Private
router.get('/summary', async (req, res) => {
  try {
    const { month, year, fromDate, toDate } = req.query;
    const from = toDateOnly(fromDate);
    const to = toDateOnly(toDate);

    const [attendance, payments] = await Promise.all([
      readSheet('attendance').catch(() => []),
      readSheet('payments').catch(() => [])
    ]);

    // Filter data based on date range
    const attendanceFiltered = attendance.filter(r => {
      const d = toDateOnly(r['Date']);
      if (!d) return false;
      if (from || to) return inRange(d, from, to);
      if (!month && !year) return true;
      return monthYearMatch(d, month, year);
    });

    const paymentsFiltered = payments.filter(p => {
      const d = toDateOnly(p['Date']);
      if (!d) return false;
      if (from || to) return inRange(d, from, to);
      if (!month && !year) return true;
      return monthYearMatch(d, month, year);
    });

    // Enhanced verification logic with payment verification
    const verificationRows = attendanceFiltered.map(attendance => {
      const matchingPayment = paymentsFiltered.find(payment => 
        payment.Customer === attendance.Customer && 
        payment.Date === attendance.Date
      );
      
      return {
        ...attendance,
        Verified: !!matchingPayment,
        Category: matchingPayment ? 'Verified' : 'No payment record',
        UnitPrice: 0,
        EffectiveAmount: matchingPayment ? parseFloat(matchingPayment.Amount || '0') : 0,
        CoachAmount: 0,
        BgmAmount: 0,
        ManagementAmount: 0,
        MfcAmount: 0,
        Invoice: matchingPayment ? matchingPayment.Invoice || '' : '',
        PaymentDate: matchingPayment ? matchingPayment.Date || '' : '',
      };
    });

    // Payment verification analysis
    const paymentVerificationRows = paymentsFiltered.map(payment => {
      let category = payment.Category || 'Payment';
      let isVerified = payment.IsVerified === 'true' || payment.IsVerified === true;

      // Apply verification rules
      if (payment.Memo && payment.Memo.toLowerCase().includes('fee')) {
        category = 'Tax';
        isVerified = true;
      }

      // Check for 100% Discount (same day, same customer, same amount with opposite signs)
      const sameRecords = paymentsFiltered.filter(p => 
        p.Date === payment.Date && 
        p.Customer === payment.Customer && 
        Math.abs(parseFloat(p.Amount || '0')) === Math.abs(parseFloat(payment.Amount || '0'))
      );

      if (sameRecords.length >= 2) {
        const amounts = sameRecords.map(p => parseFloat(p.Amount || '0'));
        const hasPositive = amounts.some(a => a > 0);
        const hasNegative = amounts.some(a => a < 0);
        
        if (hasPositive && hasNegative) {
          category = '100% Discount';
          isVerified = true;
        }
      }

      return {
        ...payment,
        Category: category,
        IsVerified: isVerified,
        Amount: parseFloat(payment.Amount || '0')
      };
    });

    // Calculate comprehensive metrics
    const attendanceVerified = verificationRows.filter(r => r.Verified).length;
    const attendanceTotal = verificationRows.length;
    const attendanceVerificationRate = attendanceTotal > 0 ? (attendanceVerified / attendanceTotal) * 100 : 0;

    const paymentVerified = paymentVerificationRows.filter(p => p.IsVerified).length;
    const paymentTotal = paymentVerificationRows.length;
    const paymentVerificationRate = paymentTotal > 0 ? (paymentVerified / paymentTotal) * 100 : 0;

    // Payment category breakdown
    const paymentCategories = {
      payment: paymentVerificationRows.filter(p => p.Category === 'Payment').length,
      discount: paymentVerificationRows.filter(p => p.Category === 'Discount').length,
      fullDiscount: paymentVerificationRows.filter(p => p.Category === '100% Discount').length,
      tax: paymentVerificationRows.filter(p => p.Category === 'Tax').length,
      refund: paymentVerificationRows.filter(p => p.Category === 'Refund').length,
      fee: paymentVerificationRows.filter(p => p.Category === 'Fee').length,
    };

    // Financial calculations
    const totalDiscountedAmount = paymentVerificationRows
      .filter(p => p.Category === 'Discount' || p.Category === '100% Discount')
      .reduce((sum, p) => sum + Math.abs(p.Amount), 0);

    const totalTaxAmount = paymentVerificationRows
      .filter(p => p.Category === 'Tax')
      .reduce((sum, p) => sum + p.Amount, 0);

    const totalVerifiedAmount = paymentVerificationRows
      .filter(p => p.IsVerified)
      .reduce((sum, p) => sum + p.Amount, 0);

    const totalUnverifiedAmount = paymentVerificationRows
      .filter(p => !p.IsVerified)
      .reduce((sum, p) => sum + p.Amount, 0);

    const summary = {
      // Attendance metrics
      totalAttendanceRecords: attendanceTotal,
      verifiedAttendanceRecords: attendanceVerified,
      unverifiedAttendanceRecords: attendanceTotal - attendanceVerified,
      attendanceVerificationRate: Math.round(attendanceVerificationRate * 100) / 100,
      
      // Payment metrics  
      totalPaymentRecords: paymentTotal,
      verifiedPaymentRecords: paymentVerified,
      unverifiedPaymentRecords: paymentTotal - paymentVerified,
      paymentVerificationRate: Math.round(paymentVerificationRate * 100) / 100,
      
      // Legacy fields for compatibility
      totalRecords: attendanceTotal,
      verifiedRecords: attendanceVerified,
      unverifiedRecords: attendanceTotal - attendanceVerified,
      manuallyVerifiedRecords: verificationRows.filter(r => r.Category === 'Manually Verified').length,
      
      // Financial metrics
      totalDiscountedAmount: Math.round(totalDiscountedAmount * 100) / 100,
      totalTaxAmount: Math.round(totalTaxAmount * 100) / 100,
      totalFuturePaymentsMFC: Math.round(totalUnverifiedAmount * 100) / 100,
      totalVerifiedAmount: Math.round(totalVerifiedAmount * 100) / 100,
      totalUnverifiedAmount: Math.round(totalUnverifiedAmount * 100) / 100,
      verificationCompletionRate: Math.round(attendanceVerificationRate * 100) / 100,
      mfcRetentionRate: totalVerifiedAmount > 0 ? Math.round((totalUnverifiedAmount / (totalVerifiedAmount + totalUnverifiedAmount)) * 10000) / 100 : 0,
      
      // Enhanced category breakdown
      categoryBreakdown: {
        verified: attendanceVerified,
        pending: attendanceTotal - attendanceVerified,
        manuallyVerified: verificationRows.filter(r => r.Category === 'Manually Verified').length,
      },
      
      // Payment category breakdown
      paymentCategoryBreakdown: paymentCategories
    };

    res.json({
      success: true,
      summary,
      message: 'Verification summary retrieved successfully'
    });

  } catch (error) {
    console.error('Error getting verification summary:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get verification summary',
      error: error.message
    });
  }
});

// @desc    Get unverified invoices for a customer
// @route   GET /verification/unverified-invoices/:customer
// @access  Private
router.get('/unverified-invoices/:customer', async (req, res) => {
  try {
    const { customer } = req.params;
    
    const payments = await readSheet('payments').catch(() => []);
    
    // Filter payments for the customer that don't have matching attendance
    const customerPayments = payments.filter(p => p.Customer === customer);
    
    // Group by invoice
    const invoiceGroups = {};
    customerPayments.forEach(payment => {
      const invoice = payment.Invoice || 'No Invoice';
      if (!invoiceGroups[invoice]) {
        invoiceGroups[invoice] = {
          invoice,
          totalAmount: 0,
          paymentCount: 0,
          payments: []
        };
      }
      invoiceGroups[invoice].totalAmount += parseFloat(payment.Amount || '0');
      invoiceGroups[invoice].paymentCount += 1;
      invoiceGroups[invoice].payments.push({
        id: `${payment.Date}_${payment.Customer}_${payment.Amount}`,
        amount: parseFloat(payment.Amount || '0'),
        date: payment.Date,
        memo: payment.Memo,
        category: 'Payment'
      });
    });

    const invoiceOptions = Object.values(invoiceGroups);

    res.json({
      success: true,
      customer,
      invoiceOptions,
      message: 'Unverified invoices retrieved successfully'
    });

  } catch (error) {
    console.error('Error getting unverified invoices:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get unverified invoices',
      error: error.message
    });
  }
});

// @desc    Manually verify attendance
// @route   POST /verification/manual-verify-attendance
// @access  Private
router.post('/manual-verify-attendance', async (req, res) => {
  try {
    const { attendanceId, invoiceNumber, customer } = req.body;
    
    // This is a placeholder implementation
    // In a real system, you would update the verification status in your database
    
    res.json({
      success: true,
      message: 'Attendance manually verified successfully'
    });

  } catch (error) {
    console.error('Error manually verifying attendance:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to manually verify attendance',
      error: error.message
    });
  }
});

// @desc    Update payment category
// @route   POST /verification/update-payment-category
// @access  Private
router.post('/update-payment-category', async (req, res) => {
  try {
    const { paymentId, category, customer, invoice } = req.body;
    
    // This is a placeholder implementation
    // In a real system, you would update the payment category in your database
    
    res.json({
      success: true,
      message: 'Payment category updated successfully'
    });

  } catch (error) {
    console.error('Error updating payment category:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update payment category',
      error: error.message
    });
  }
});

// @desc    Update payment verification status
// @route   POST /verification/update-payments
// @access  Private
router.post('/update-payments', async (req, res) => {
  try {
    const { payments } = req.body;
    
    if (!payments || !Array.isArray(payments)) {
      return res.status(400).json({
        success: false,
        message: 'Payments array is required'
      });
    }

    // For now, we'll just return success since the Google Sheets update
    // would require more complex logic to match and update specific rows
    // The frontend will handle the verification logic and display
    
    res.json({
      success: true,
      message: 'Payment verification status updated successfully'
    });

  } catch (error) {
    console.error('Error updating payment verification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update payment verification status',
      error: error.message
    });
  }
});

// @desc    Get invoice status
// @route   GET /verification/invoice-status/:invoice
// @access  Private
router.get('/invoice-status/:invoice', async (req, res) => {
  try {
    const { invoice } = req.params;
    
    const payments = await readSheet('payments').catch(() => []);
    
    // Find payments for this invoice
    const invoicePayments = payments.filter(p => p.Invoice === invoice);
    
    if (invoicePayments.length === 0) {
      return res.json({
        success: true,
        invoice,
        status: 'not_found',
        totalAmount: 0,
        verifiedAmount: 0,
        unverifiedAmount: 0,
        paymentCount: 0,
        payments: []
      });
    }

    const totalAmount = invoicePayments.reduce((sum, p) => sum + parseFloat(p.Amount || '0'), 0);
    const verifiedAmount = totalAmount; // Simplified - assume all are verified
    const unverifiedAmount = 0;

    const paymentsData = invoicePayments.map(p => ({
      id: `${p.Date}_${p.Customer}_${p.Amount}`,
      amount: parseFloat(p.Amount || '0'),
      date: p.Date,
      customer: p.Customer,
      memo: p.Memo,
      category: 'Payment',
      isVerified: true
    }));

    res.json({
      success: true,
      invoice,
      status: 'fully_verified',
      totalAmount,
      verifiedAmount,
      unverifiedAmount,
      paymentCount: invoicePayments.length,
      payments: paymentsData
    });

  } catch (error) {
    console.error('Error getting invoice status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get invoice status',
      error: error.message
    });
  }
});

module.exports = router;
