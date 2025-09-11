import { Router } from 'express';
import { ruleService, PaymentRule, GlobalSettings } from '../services/ruleService';
import { GoogleSheetsService } from '../services/googleSheets';

const router = Router();

// Helper functions
const toDateOnly = (value: any): Date | null => {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

const inRange = (date: Date, from: Date | null, to: Date | null): boolean => {
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
};

const monthYearMatch = (date: Date, month: number | null, year: number | null): boolean => {
  if (!date) return false;
  if (month && date.getUTCMonth() + 1 !== month) return false;
  if (year && date.getUTCFullYear() !== year) return false;
  return true;
};

const classifySession = (classType: string): 'group' | 'private' => {
  const type = (classType || '').toLowerCase();
  return type.includes('private') ? 'private' : 'group';
};

const getDiscountType = (memo: string, amount: number): string | null => {
  const text = (memo || '').toLowerCase();
  if (text.includes('full discount') || text.includes('free')) return 'full';
  if (text.includes('discount') || text.includes('partial')) return 'partial';
  return null;
};

// @desc    Calculate payments
// @route   POST /api/payments/calculate
// @access  Private
router.post('/calculate', async (req, res) => {
  try {
    const { month, year, fromDate, toDate } = req.body || {};
    const from = toDateOnly(fromDate);
    const to = toDateOnly(toDate);

    // Check if Google Sheets is configured
    const isGoogleSheetsConfigured = !!(
      process.env.GOOGLE_SHEETS_SPREADSHEET_ID && 
      process.env.GOOGLE_SHEETS_CLIENT_EMAIL && 
      process.env.GOOGLE_SHEETS_PRIVATE_KEY
    );

    let attendance: any[] = [];
    let payments: any[] = [];
    let rulesSheet: any[] = [];
    let settingsSheet: any[] = [];
    let discountsSheet: any[] = [];

    if (isGoogleSheetsConfigured) {
      try {
        const googleSheetsService = new GoogleSheetsService();
        // Load sheets
        const results = await Promise.all([
          googleSheetsService.readSheet('attendance').catch(() => []),
          googleSheetsService.readSheet('Payments').catch(() => []),
          googleSheetsService.readSheet('rules').catch(() => []),
          googleSheetsService.readSheet('settings').catch(() => []),
          googleSheetsService.readSheet('discounts').catch(() => []),
        ]);
        [attendance, payments, rulesSheet, settingsSheet, discountsSheet] = results;
      } catch (error) {
        console.error('Error loading Google Sheets data:', error);
        // Continue with empty arrays
      }
    }

    // Filtered attendance
    const attendanceFiltered = attendance.filter((r: any) => {
      const d = toDateOnly(r['Date']);
      if (!d) return false;
      if (from || to) return inRange(d, from, to);
      if (!month && !year) return true;
      return monthYearMatch(d, month, year);
    });

    const groupSessions = attendanceFiltered.filter((r: any) => classifySession(r['ClassType']) === 'group');
    const privateSessions = attendanceFiltered.filter((r: any) => classifySession(r['ClassType']) === 'private');

    // Filtered payments
    const paymentsFiltered = payments.filter((p: any) => {
      const d = toDateOnly(p['Date']);
      if (!d) return false;
      if (from || to) return inRange(d, from, to);
      if (!month && !year) return true;
      return monthYearMatch(d, month, year);
    });

    // Parse payments with discount detection
    const parsedPayments = paymentsFiltered.map((p: any) => {
      const amount = parseFloat(p['Amount'] || '0') || 0;
      const discountType = getDiscountType(p['Memo'] || '', amount);
      return {
        date: toDateOnly(p['Date']),
        customer: p['Customer'] || '',
        memo: p['Memo'] || '',
        amount,
        invoice: p['Invoice'] || '',
        isDiscount: !!discountType,
        discountType,
      };
    });

    // Exclude full discounts from revenue totals
    const paymentsEffective = parsedPayments.filter((p: any) => p.discountType !== 'full');
    const totalPayments = paymentsEffective.reduce((sum: number, p: any) => sum + (p.amount || 0), 0);

    const counts = {
      attendanceTotal: attendanceFiltered.length,
      groupSessions: groupSessions.length,
      privateSessions: privateSessions.length,
      paymentsCount: parsedPayments.length,
      discountPayments: parsedPayments.filter((p: any) => p.isDiscount).length,
    };

    const revenue = {
      totalPayments,
      groupRevenue: totalPayments * 0.6, // 60% to group
      privateRevenue: totalPayments * 0.4, // 40% to private
    };

    const splits = {
      group: {
        revenue: revenue.groupRevenue,
        coach: revenue.groupRevenue * 0.435, // 43.5%
        bgm: revenue.groupRevenue * 0.30,    // 30%
        management: revenue.groupRevenue * 0.085, // 8.5%
        mfc: revenue.groupRevenue * 0.18,    // 18%
        percentage: {
          coach: 43.5,
          bgm: 30,
          management: 8.5,
          mfc: 18
        }
      },
      private: {
        revenue: revenue.privateRevenue,
        coach: revenue.privateRevenue * 0.80, // 80%
        landlord: revenue.privateRevenue * 0.15, // 15%
        management: revenue.privateRevenue * 0.00, // 0%
        mfc: revenue.privateRevenue * 0.05,   // 5%
        percentage: {
          coach: 80,
          landlord: 15,
          management: 0,
          mfc: 5
        }
      }
    };

    const discounts = {
      fullCount: parsedPayments.filter((p: any) => p.discountType === 'full').length,
      partialCount: parsedPayments.filter((p: any) => p.discountType === 'partial').length,
    };

    res.json({
      success: true,
      filters: { month, year, fromDate, toDate },
      counts,
      revenue,
      splits,
      discounts,
      notes: 'Results written to payment_calculator and payment_calc_detail tabs. Session-to-payment mapping pending.',
      coachBreakdown: [] // TODO: Implement coach breakdown
    });

  } catch (error) {
    console.error('Error calculating payments:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to calculate payments',
      filters: { month: null, year: null, fromDate: null, toDate: null },
      counts: {
        attendanceTotal: 0,
        groupSessions: 0,
        privateSessions: 0,
        paymentsCount: 0,
        discountPayments: 0,
      },
      revenue: { totalPayments: 0, groupRevenue: 0, privateRevenue: 0 },
      splits: { group: {}, private: {} },
      discounts: { fullCount: 0, partialCount: 0 },
      notes: 'Calculation failed',
      coachBreakdown: []
    });
  }
});

// @desc    Get all payment rules
// @route   GET /api/payments/rules
// @access  Private
router.get('/rules', async (req, res) => {
  try {
    const rules = await ruleService.getAllRules();
    res.json({
      success: true,
      data: rules,
      message: 'Payment rules retrieved successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to retrieve payment rules',
      errors: [error instanceof Error ? error.message : 'Unknown error']
    });
  }
});

// @desc    Get global default rules
// @route   GET /api/payments/rules/global
// @access  Private
router.get('/rules/global', async (req, res) => {
  try {
    const globalRules = await ruleService.getGlobalRules();
    res.json({
      success: true,
      data: globalRules,
      message: 'Global payment rules retrieved successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to retrieve global payment rules',
      errors: [error instanceof Error ? error.message : 'Unknown error']
    });
  }
});

// @desc    Get global default rules
// @route   GET /api/payments/rules/global
// @access  Private
router.get('/rules/global', async (req, res) => {
  try {
    const globalRules = await ruleService.getGlobalRules();
    res.json({
      success: true,
      data: globalRules,
      message: 'Global payment rules retrieved successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to retrieve global payment rules',
      errors: [error instanceof Error ? error.message : 'Unknown error']
    });
  }
});

// @desc    Update global default rules
// @route   PUT /api/payments/rules/global
// @access  Private
router.put('/rules/global', async (req, res) => {
  try {
    const { rules } = req.body;
    
    if (!Array.isArray(rules)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        errors: ['Rules must be an array']
      });
    }

    // Update each global rule
    const updatedRules: PaymentRule[] = [];
    for (const ruleData of rules) {
      if (ruleData.id) {
        const updatedRule = await ruleService.updateRule(ruleData.id, ruleData);
        updatedRules.push(updatedRule);
      } else {
        const newRule = await ruleService.createRule(ruleData);
        updatedRules.push(newRule);
      }
    }

    res.json({
      success: true,
      data: updatedRules,
      message: 'Global payment rules updated successfully'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to update global payment rules',
      errors: [error instanceof Error ? error.message : 'Unknown error']
    });
  }
});

// @desc    Get payment rule by ID
// @route   GET /api/payments/rules/:id
// @access  Private
router.get('/rules/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid rule ID',
        errors: ['Rule ID must be a valid number']
      });
    }

    const rule = await ruleService.getRuleById(id);
    if (!rule) {
      return res.status(404).json({
        success: false,
        message: 'Rule not found',
        errors: ['Rule with specified ID does not exist']
      });
    }

    res.json({
      success: true,
      data: rule,
      message: 'Payment rule retrieved successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to retrieve payment rule',
      errors: [error instanceof Error ? error.message : 'Unknown error']
    });
  }
});

// @desc    Create new payment rule
// @route   POST /api/payments/rules
// @access  Private
router.post('/rules', async (req, res) => {
  try {
    const ruleData = req.body;
    const newRule = await ruleService.createRule(ruleData);
    
    res.status(201).json({
      success: true,
      data: newRule,
      message: 'Payment rule created successfully'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to create payment rule',
      errors: [error instanceof Error ? error.message : 'Unknown error']
    });
  }
});

// @desc    Update payment rule
// @route   PUT /api/payments/rules/:id
// @access  Private
router.put('/rules/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid rule ID',
        errors: ['Rule ID must be a valid number']
      });
    }

    const ruleData = req.body;
    const updatedRule = await ruleService.updateRule(id, ruleData);
    
    res.json({
      success: true,
      data: updatedRule,
      message: 'Payment rule updated successfully'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to update payment rule',
      errors: [error instanceof Error ? error.message : 'Unknown error']
    });
  }
});

// @desc    Delete payment rule
// @route   DELETE /api/payments/rules/:id
// @access  Private
router.delete('/rules/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid rule ID',
        errors: ['Rule ID must be a valid number']
      });
    }

    await ruleService.deleteRule(id);
    
    res.json({
      success: true,
      message: 'Payment rule deleted successfully'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to delete payment rule',
      errors: [error instanceof Error ? error.message : 'Unknown error']
    });
  }
});



// @desc    Get global settings
// @route   GET /api/payments/settings
// @access  Private
router.get('/settings', async (req, res) => {
  try {
    const settings = await ruleService.getGlobalSettings();
    res.json({
      success: true,
      data: settings,
      message: 'Global settings retrieved successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to retrieve global settings',
      errors: [error instanceof Error ? error.message : 'Unknown error']
    });
  }
});

// @desc    Update global settings
// @route   PUT /api/payments/settings
// @access  Private
router.put('/settings', async (req, res) => {
  try {
    const settings: GlobalSettings[] = req.body;
    
    if (!Array.isArray(settings)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        errors: ['Settings must be an array']
      });
    }

    await ruleService.updateGlobalSettings(settings);
    
    res.json({
      success: true,
      message: 'Global settings updated successfully'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to update global settings',
      errors: [error instanceof Error ? error.message : 'Unknown error']
    });
  }
});

// @desc    Get coach payments
// @route   GET /api/payments/coaches
// @access  Private
router.get('/coaches', (req, res) => {
  res.json({ message: 'Get coach payments - TODO' });
});

// @desc    Get BGM payments
// @route   GET /api/payments/bgm
// @access  Private
router.get('/bgm', (req, res) => {
  res.json({ message: 'Get BGM payments - TODO' });
});

// @desc    Verify payments against attendance (row-level)
// @route   POST /api/payments/verify
// @access  Private
router.post('/verify', async (req, res) => {
  try {
    const { month, year, fromDate, toDate } = req.body || {};
    
    // Check if Google Sheets is configured
    const isGoogleSheetsConfigured = !!(
      process.env.GOOGLE_SHEETS_SPREADSHEET_ID && 
      process.env.GOOGLE_SHEETS_CLIENT_EMAIL && 
      process.env.GOOGLE_SHEETS_PRIVATE_KEY
    );

    let attendanceData: any[] = [];
    let paymentData: any[] = [];

    if (isGoogleSheetsConfigured) {
      try {
        const googleSheetsService = new GoogleSheetsService();
        // Get attendance and payment data
        const results = await Promise.all([
          googleSheetsService.readSheet('attendance').catch(() => []),
          googleSheetsService.readSheet('Payments').catch(() => [])
        ]);
        [attendanceData, paymentData] = results;
      } catch (error) {
        console.error('Error loading Google Sheets data for verification:', error);
        // Continue with empty arrays
      }
    }

    // Simple verification logic - mark as verified if there's a matching payment
    const verificationRows = attendanceData.map((attendance: any) => {
      const matchingPayment = paymentData.find((payment: any) => 
        payment.Customer === attendance.Customer && 
        payment.Date === attendance.Date
      );
      
      return {
        Date: attendance.Date || '',
        Customer: attendance.Customer || '',
        Membership: attendance.Membership || '',
        ClassType: attendance.ClassType || '',
        Instructors: attendance.Instructors || '',
        Verified: !!matchingPayment,
        Category: matchingPayment ? 'Verified' : 'Pending',
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

    const summary = {
      attendanceCount: verificationRows.length,
      verifiedCount: verificationRows.filter((r: any) => r.Verified).length,
      unverifiedCount: verificationRows.filter((r: any) => !r.Verified).length,
    };

    res.json({
      success: true,
      rows: verificationRows,
      summary,
      message: 'Verification completed successfully'
    });

  } catch (error) {
    console.error('Error verifying payments:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to verify payments',
      rows: [],
      summary: {}
    });
  }
});

export default router; 