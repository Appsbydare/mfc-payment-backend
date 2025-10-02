import { Router } from 'express';
import { invoiceVerificationService, InvoiceVerificationRecord } from '../services/invoiceVerificationService';

const router = Router();

/**
 * @desc    Initialize invoice verification data from payments sheet
 * @route   POST /api/invoice-verification/initialize
 * @access  Private
 */
router.post('/initialize', async (req, res) => {
  try {
    console.log('🔄 Initializing invoice verification data...');
    const invoices = await invoiceVerificationService.initializeInvoiceVerification();
    await invoiceVerificationService.saveInvoiceVerificationData(invoices);

    res.json({
      success: true,
      data: invoices,
      count: invoices.length,
      message: 'Invoice verification data initialized successfully'
    });
  } catch (error) {
    console.error('❌ Error initializing invoice verification:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to initialize invoice verification data',
      data: [],
      count: 0
    });
  }
});

/**
 * @desc    Get all invoice verification data
 * @route   GET /api/invoice-verification
 * @access  Private
 */
router.get('/', async (req, res) => {
  try {
    const invoices = await invoiceVerificationService.loadInvoiceVerificationData();

    res.json({
      success: true,
      data: invoices,
      count: invoices.length,
      message: 'Invoice verification data retrieved successfully'
    });
  } catch (error) {
    console.error('❌ Error loading invoice verification data:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to load invoice verification data',
      data: [],
      count: 0
    });
  }
});

/**
 * @desc    Verify invoices against attendance data
 * @route   POST /api/invoice-verification/verify-with-attendance
 * @access  Private
 */
router.post('/verify-with-attendance', async (req, res) => {
  try {
    console.log('🔍 Starting invoice verification with attendance data...');
    const result = await invoiceVerificationService.verifyInvoicesWithAttendance();

    res.json({
      success: true,
      data: result.invoiceUsage,
      verifiedRecords: result.verifiedRecords,
      totalRecords: result.totalRecords,
      message: `Invoice verification completed: ${result.verifiedRecords}/${result.totalRecords} records verified`
    });
  } catch (error) {
    console.error('❌ Error verifying invoices with attendance:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to verify invoices with attendance',
      data: [],
      verifiedRecords: 0,
      totalRecords: 0
    });
  }
});

/**
 * @desc    Get invoice verification summary
 * @route   GET /api/invoice-verification/summary
 * @access  Private
 */
router.get('/summary', async (req, res) => {
  try {
    const summary = await invoiceVerificationService.getInvoiceVerificationSummary();

    res.json({
      success: true,
      data: summary,
      message: 'Invoice verification summary retrieved successfully'
    });
  } catch (error) {
    console.error('❌ Error getting invoice verification summary:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to get invoice verification summary',
      data: null
    });
  }
});

/**
 * @desc    Find available invoice for customer and amount
 * @route   POST /api/invoice-verification/find-available
 * @access  Private
 */
router.post('/find-available', async (req, res) => {
  try {
    const { customerName, requiredAmount } = req.body;

    if (!customerName || !requiredAmount) {
      return res.status(400).json({
        success: false,
        message: 'Customer name and required amount are required',
        data: null
      });
    }

    const existingInvoices = await invoiceVerificationService.loadInvoiceVerificationData();
    const availableInvoice = await invoiceVerificationService.findAvailableInvoice(
      customerName,
      requiredAmount,
      existingInvoices
    );

    if (!availableInvoice) {
      return res.status(404).json({
        success: false,
        message: `No available invoice found for ${customerName} with sufficient balance for ${requiredAmount}`,
        data: null
      });
    }

    res.json({
      success: true,
      data: availableInvoice,
      message: `Found available invoice ${availableInvoice.invoiceNumber} for ${customerName}`
    });
  } catch (error) {
    console.error('❌ Error finding available invoice:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to find available invoice',
      data: null
    });
  }
});

/**
 * @desc    Use amount from specific invoice
 * @route   POST /api/invoice-verification/use-amount
 * @access  Private
 */
router.post('/use-amount', async (req, res) => {
  try {
    const { invoiceNumber, amount } = req.body;

    if (!invoiceNumber || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Invoice number and amount are required',
        data: null
      });
    }

    const existingInvoices = await invoiceVerificationService.loadInvoiceVerificationData();
    const updatedInvoices = await invoiceVerificationService.useInvoiceAmount(
      invoiceNumber,
      amount,
      existingInvoices
    );

    await invoiceVerificationService.saveInvoiceVerificationData(updatedInvoices);

    const updatedInvoice = updatedInvoices.find(inv => inv.invoiceNumber === invoiceNumber);

    res.json({
      success: true,
      data: updatedInvoice,
      message: `Used ${amount} from invoice ${invoiceNumber}. Remaining balance: ${updatedInvoice?.remainingBalance}`
    });
  } catch (error) {
    console.error('❌ Error using invoice amount:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to use invoice amount',
      data: null
    });
  }
});

/**
 * @desc    Mark invoice as unverified due to insufficient balance
 * @route   POST /api/invoice-verification/mark-unverified
 * @access  Private
 */
router.post('/mark-unverified', async (req, res) => {
  try {
    const { invoiceNumber } = req.body;

    if (!invoiceNumber) {
      return res.status(400).json({
        success: false,
        message: 'Invoice number is required',
        data: null
      });
    }

    const existingInvoices = await invoiceVerificationService.loadInvoiceVerificationData();
    const updatedInvoices = await invoiceVerificationService.markInvoiceUnverified(
      invoiceNumber,
      existingInvoices
    );

    await invoiceVerificationService.saveInvoiceVerificationData(updatedInvoices);

    res.json({
      success: true,
      data: updatedInvoices.filter(inv => inv.invoiceNumber === invoiceNumber),
      message: `Marked invoice ${invoiceNumber} as unverified`
    });
  } catch (error) {
    console.error('❌ Error marking invoice as unverified:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to mark invoice as unverified',
      data: []
    });
  }
});

export default router;

