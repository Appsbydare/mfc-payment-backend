import { Router } from 'express';
import { GoogleSheetsService } from '../services/googleSheets';
import { paymentVerificationService } from '../services/paymentVerificationService';
import { verificationMasterService } from '../services/verificationMasterService';

const router = Router();
const googleSheetsService = new GoogleSheetsService();

// @desc    Get verification summary for a period
// @route   GET /api/verification/summary
// @access  Private
router.get('/summary', async (req, res) => {
  try {
    const { month, year, fromDate, toDate } = req.query;
    
    // Get attendance and payment data
    const [attendanceData, paymentData] = await Promise.all([
      googleSheetsService.readSheet('attendance').catch(() => []),
      googleSheetsService.readSheet('Payments').catch(() => [])
    ]);

    // Filter data by date range
    const filterByDate = (data: any[], dateField: string) => {
      if (!data || data.length === 0) return [];
      
      return data.filter((row: any) => {
        const rowDate = new Date(row[dateField]);
        if (isNaN(rowDate.getTime())) return false;
        
        if (fromDate && toDate) {
          const from = new Date(fromDate as string);
          const to = new Date(toDate as string);
          return rowDate >= from && rowDate <= to;
        }
        
        if (month && year) {
          return rowDate.getMonth() + 1 === parseInt(month as string) && 
                 rowDate.getFullYear() === parseInt(year as string);
        }
        
        return true;
      });
    };

    const filteredAttendance = filterByDate(attendanceData, 'Date');
    const filteredPayments = filterByDate(paymentData, 'Date');

    // Calculate verification metrics
    const totalRecords = filteredAttendance.length;
    const verifiedRecords = filteredAttendance.filter((row: any) => 
      row.Category === 'Verified' || row.Category === 'Manually Verified'
    ).length;
    const unverifiedRecords = filteredAttendance.filter((row: any) => 
      row.Category === 'Pending'
    ).length;
    const manuallyVerifiedRecords = filteredAttendance.filter((row: any) => 
      row.Category === 'Manually Verified'
    ).length;

    // Calculate financial metrics
    const totalDiscountedAmount = filteredPayments
      .filter((row: any) => row.Category === 'Discount')
      .reduce((sum: number, row: any) => sum + (parseFloat(row.Amount) || 0), 0);

    const totalTaxAmount = filteredPayments
      .filter((row: any) => row.Category === 'Tax')
      .reduce((sum: number, row: any) => sum + (parseFloat(row.Amount) || 0), 0);

    const totalFuturePaymentsMFC = filteredPayments
      .filter((row: any) => row.IsVerified === 'false' || row.IsVerified === false)
      .reduce((sum: number, row: any) => sum + (parseFloat(row.Amount) || 0), 0);

    const totalVerifiedAmount = filteredPayments
      .filter((row: any) => row.IsVerified === 'true' || row.IsVerified === true)
      .reduce((sum: number, row: any) => sum + (parseFloat(row.Amount) || 0), 0);

    const totalUnverifiedAmount = totalFuturePaymentsMFC;

    // Calculate percentages
    const verificationCompletionRate = totalRecords > 0 ? 
      ((verifiedRecords / totalRecords) * 100) : 0;
    
    const totalPaymentAmount = totalVerifiedAmount + totalUnverifiedAmount;
    const mfcRetentionRate = totalPaymentAmount > 0 ? 
      ((totalUnverifiedAmount / totalPaymentAmount) * 100) : 0;

    const summary = {
      // Record counts
      totalRecords,
      verifiedRecords,
      unverifiedRecords,
      manuallyVerifiedRecords,
      
      // Financial metrics
      totalDiscountedAmount: Math.round(totalDiscountedAmount * 100) / 100,
      totalTaxAmount: Math.round(totalTaxAmount * 100) / 100,
      totalFuturePaymentsMFC: Math.round(totalFuturePaymentsMFC * 100) / 100,
      totalVerifiedAmount: Math.round(totalVerifiedAmount * 100) / 100,
      totalUnverifiedAmount: Math.round(totalUnverifiedAmount * 100) / 100,
      
      // Percentages
      verificationCompletionRate: Math.round(verificationCompletionRate * 100) / 100,
      mfcRetentionRate: Math.round(mfcRetentionRate * 100) / 100,
      
      // Breakdown by category
      categoryBreakdown: {
        verified: verifiedRecords,
        pending: unverifiedRecords,
        manuallyVerified: manuallyVerifiedRecords
      }
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
      message: error instanceof Error ? error.message : 'Failed to get verification summary',
      summary: null
    });
  }
});

// @desc    Get unverified invoices for a customer
// @route   GET /api/verification/unverified-invoices/:customer
// @access  Private
router.get('/unverified-invoices/:customer', async (req, res) => {
  try {
    const { customer } = req.params;
    
    const paymentData = await googleSheetsService.readSheet('Payments').catch(() => []);
    
    // Get unverified payments for the customer
    const unverifiedPayments = paymentData.filter((row: any) => 
      row.Customer === customer && 
      (row.IsVerified === 'false' || row.IsVerified === false)
    );

    // Group by invoice number
    const invoiceGroups: { [key: string]: any[] } = {};
    unverifiedPayments.forEach((payment: any) => {
      const invoice = payment.Invoice || 'No Invoice';
      if (!invoiceGroups[invoice]) {
        invoiceGroups[invoice] = [];
      }
      invoiceGroups[invoice].push(payment);
    });

    // Calculate totals per invoice
    const invoiceOptions = Object.entries(invoiceGroups).map(([invoice, payments]) => ({
      invoice,
      totalAmount: payments.reduce((sum: number, p: any) => sum + (parseFloat(p.Amount) || 0), 0),
      paymentCount: payments.length,
      payments: payments.map((p: any) => ({
        id: p.id || `${p.Date}_${p.Customer}_${p.Amount}`,
        amount: parseFloat(p.Amount) || 0,
        date: p.Date,
        memo: p.Memo,
        category: p.Category
      }))
    }));

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
      message: error instanceof Error ? error.message : 'Failed to get unverified invoices',
      invoiceOptions: []
    });
  }
});

// @desc    Manually verify attendance record
// @route   POST /api/verification/manual-verify-attendance
// @access  Private
router.post('/manual-verify-attendance', async (req, res) => {
  try {
    const { attendanceId, invoiceNumber, customer } = req.body;
    
    if (!attendanceId || !invoiceNumber || !customer) {
      return res.status(400).json({
        success: false,
        message: 'attendanceId, invoiceNumber, and customer are required'
      });
    }

    // Get current attendance data
    const attendanceData = await googleSheetsService.readSheet('attendance');
    
    // Find and update the attendance record
    let matchedAttendance: any | null = null;
    const updatedAttendance = attendanceData.map((row: any) => {
      const isMatch = row.id === attendanceId ||
        (row.Customer === customer && row.Date && row.Time && row.ClassType);
      if (isMatch) {
        matchedAttendance = row;
        return {
          ...row,
          Category: 'Manually Verified',
          InvoiceNumber: invoiceNumber,
          ManualVerificationDate: new Date().toISOString(),
          VerificationStatus: 'Verified'
        };
      }
      return row;
    });

    // Update the sheet
    await googleSheetsService.clearSheet('attendance');
    await googleSheetsService.writeSheet('attendance', updatedAttendance);

    // Update related payment records
    const paymentData = await googleSheetsService.readSheet('Payments');
    const updatedPayments = paymentData.map((row: any) => {
      if (row.Invoice === invoiceNumber && row.Customer === customer) {
        return {
          ...row,
          IsVerified: true,
          VerificationStatus: 'Verified',
          LinkedAttendanceIds: row.LinkedAttendanceIds ? 
            `${row.LinkedAttendanceIds},${attendanceId}` : attendanceId
        };
      }
      return row;
    });

    await googleSheetsService.clearSheet('Payments');
    await googleSheetsService.writeSheet('Payments', updatedPayments);

    // Also reflect manual verification into Master table if possible
    try {
      if (matchedAttendance) {
        await verificationMasterService.applyManualVerification(matchedAttendance, invoiceNumber);
      }
    } catch (e) {
      console.error('Failed updating Master during manual verification:', e);
    }

    res.json({
      success: true,
      message: 'Attendance record manually verified successfully'
    });

  } catch (error) {
    console.error('Error manually verifying attendance:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to manually verify attendance'
    });
  }
});

// @desc    Update payment category
// @route   POST /api/verification/update-payment-category
// @access  Private
router.post('/update-payment-category', async (req, res) => {
  try {
    const { paymentId, category, customer, invoice } = req.body;
    
    if (!paymentId || !category) {
      return res.status(400).json({
        success: false,
        message: 'paymentId and category are required'
      });
    }

    // Get current payment data
    const paymentData = await googleSheetsService.readSheet('Payments');
    
    // Find and update the payment record
    const updatedPayments = paymentData.map((row: any) => {
      if (row.id === paymentId || 
          (row.Customer === customer && row.Invoice === invoice && row.Amount)) {
        return {
          ...row,
          Category: category,
          UpdatedAt: new Date().toISOString()
        };
      }
      return row;
    });

    // Update the sheet
    await googleSheetsService.clearSheet('Payments');
    await googleSheetsService.writeSheet('Payments', updatedPayments);

    res.json({
      success: true,
      message: 'Payment category updated successfully'
    });

  } catch (error) {
    console.error('Error updating payment category:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to update payment category'
    });
  }
});

// @desc    Get invoice verification status
// @route   GET /api/verification/invoice-status/:invoice
// @access  Private
router.get('/invoice-status/:invoice', async (req, res) => {
  try {
    const { invoice } = req.params;
    
    const paymentData = await googleSheetsService.readSheet('Payments').catch(() => []);
    
    // Get all payments for this invoice
    const invoicePayments = paymentData.filter((row: any) => row.Invoice === invoice);
    
    if (invoicePayments.length === 0) {
      return res.json({
        success: true,
        invoice,
        status: 'not_found',
        message: 'Invoice not found'
      });
    }

    const totalAmount = invoicePayments.reduce((sum: number, row: any) => 
      sum + (parseFloat(row.Amount) || 0), 0);
    
    const verifiedAmount = invoicePayments
      .filter((row: any) => row.IsVerified === 'true' || row.IsVerified === true)
      .reduce((sum: number, row: any) => sum + (parseFloat(row.Amount) || 0), 0);
    
    const unverifiedAmount = totalAmount - verifiedAmount;
    
    const status = unverifiedAmount === 0 ? 'fully_verified' : 
                  verifiedAmount === 0 ? 'unverified' : 'partially_verified';

    res.json({
      success: true,
      invoice,
      status,
      totalAmount: Math.round(totalAmount * 100) / 100,
      verifiedAmount: Math.round(verifiedAmount * 100) / 100,
      unverifiedAmount: Math.round(unverifiedAmount * 100) / 100,
      paymentCount: invoicePayments.length,
      payments: invoicePayments.map((p: any) => ({
        id: p.id || `${p.Date}_${p.Customer}_${p.Amount}`,
        amount: parseFloat(p.Amount) || 0,
        date: p.Date,
        customer: p.Customer,
        memo: p.Memo,
        category: p.Category,
        isVerified: p.IsVerified === 'true' || p.IsVerified === true
      }))
    });

  } catch (error) {
    console.error('Error getting invoice status:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to get invoice status'
    });
  }
});

// @desc    Enhanced verification with discount integration
// @route   POST /api/verification/enhanced
// @access  Private
router.post('/enhanced', async (req, res) => {
  try {
    const { month, year, fromDate, toDate } = req.body;
    
    const result = await paymentVerificationService.verifyPayments({
      month,
      year,
      fromDate,
      toDate
    });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error in enhanced verification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to perform enhanced verification'
    });
  }
});

export default router;

// --- Master verification routes ---

// @desc    Get Master Attendance Verification rows (from payment_calc_detail)
// @route   GET /api/verification/master
// @access  Private
router.get('/master', async (req, res) => {
  try {
    const rows = await verificationMasterService.getMasterRows();
    res.json({ success: true, data: rows, count: rows.length });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to read master verification rows' });
  }
});

// @desc    Sync new Attendance rows into Master (append-only)
// @route   POST /api/verification/master-sync
// @access  Private
router.post('/master-sync', async (req, res) => {
  try {
    const result = await verificationMasterService.syncMaster();
    const message = result.appended > 0 ? `Appended ${result.appended} new rows` : 'Uploaded Data already verified!';
    res.json({ success: true, appended: result.appended, message });
  } catch (error) {
    console.error('Master sync failed:', error);
    res.status(500).json({ success: false, message: 'Master sync failed' });
  }
});

