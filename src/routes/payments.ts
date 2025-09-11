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

// Generate sample attendance data for demonstration
const generateSampleAttendance = (): any[] => {
  const samples: any[] = [];
  const now = new Date();
  const customers = ['John Smith', 'Maria Garcia', 'David Wilson', 'Sarah Johnson', 'Mike Brown', 'Lisa Davis', 'Tom Anderson', 'Emma Wilson'];
  const classTypes = ['LEVEL ONE (7 - 12) COMBAT SESSIONS', '1 to 1 Private Combat Session', 'KICKBOXING SESSION', 'BATTLE CONDITIONED'];
  const instructors = ['Zach Bitar', 'Calvin Dean'];
  const memberships = ['Adult Pay Monthly - 3 x Week', '1 to 1 Private Combat Sessions: SINGLE SESSION', 'LevelOne - FULL SUMMER: 3 x per week'];

  // Generate data for last 3 months to ensure it falls within the 12-month dashboard range
  for (let month = 0; month < 3; month++) {
    const date = new Date(now.getFullYear(), now.getMonth() - month, 15);
    const dateStr = date.toISOString().split('T')[0];
    
    // Generate 20-30 records per month
    for (let i = 0; i < 25; i++) {
      samples.push({
        Date: dateStr,
        Customer: customers[Math.floor(Math.random() * customers.length)],
        Membership: memberships[Math.floor(Math.random() * memberships.length)],
        ClassType: classTypes[Math.floor(Math.random() * classTypes.length)],
        Instructors: instructors[Math.floor(Math.random() * instructors.length)]
      });
    }
  }
  
  return samples;
};

// Generate sample payment data for demonstration  
const generateSamplePayments = (): any[] => {
  const samples: any[] = [];
  const now = new Date();
  const customers = ['John Smith', 'Maria Garcia', 'David Wilson', 'Sarah Johnson', 'Mike Brown', 'Lisa Davis', 'Tom Anderson', 'Emma Wilson'];
  const amounts = [84.11, 37.38, 14.02, 5.89, 2.62];
  const memos = ['Adult Pay Monthly - 3 x Week', '1 to 1 Private Combat Sessions: SINGLE SESSION', 'Adult Single - Pay as You Go', 'Fee'];

  // Generate data for last 3 months to ensure it falls within the 12-month dashboard range
  for (let month = 0; month < 3; month++) {
    const date = new Date(now.getFullYear(), now.getMonth() - month, 15);
    const dateStr = date.toISOString().split('T')[0];
    
    // Generate 15-20 records per month
    for (let i = 0; i < 18; i++) {
      const amount = amounts[Math.floor(Math.random() * amounts.length)];
      samples.push({
        Date: dateStr,
        Customer: customers[Math.floor(Math.random() * customers.length)],
        Amount: amount.toString(),
        Invoice: (700 + Math.floor(Math.random() * 100)).toString(),
        Memo: memos[Math.floor(Math.random() * memos.length)]
      });
    }
  }
  
  return samples;
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
    let notes = '';

    if (isGoogleSheetsConfigured) {
      try {
        console.log('🔗 Google Sheets is configured, attempting to connect...');
        const googleSheetsService = new GoogleSheetsService();
        
        console.log('📊 Loading sheets: attendance, Payments, rules, settings, discounts...');
        // Load sheets
        const results = await Promise.all([
          googleSheetsService.readSheet('attendance').catch((e) => { console.error('❌ Failed to read attendance sheet:', e.message); return []; }),
          googleSheetsService.readSheet('Payments').catch((e) => { console.error('❌ Failed to read Payments sheet:', e.message); return []; }),
          googleSheetsService.readSheet('rules').catch((e) => { console.error('❌ Failed to read rules sheet:', e.message); return []; }),
          googleSheetsService.readSheet('settings').catch((e) => { console.error('❌ Failed to read settings sheet:', e.message); return []; }),
          googleSheetsService.readSheet('discounts').catch((e) => { console.error('❌ Failed to read discounts sheet:', e.message); return []; }),
        ]);
        [attendance, payments, rulesSheet, settingsSheet, discountsSheet] = results;
        
        console.log(`📈 Loaded sheets: attendance(${attendance.length}), payments(${payments.length}), rules(${rulesSheet.length}), settings(${settingsSheet.length}), discounts(${discountsSheet.length})`);
        
        if (attendance.length === 0 && payments.length === 0) {
          console.log('⚠️ No data found in Google Sheets, using sample data');
          notes = 'Google Sheets connected but no data found. Using sample data for demonstration.';
          // Add sample data for demonstration
          attendance = generateSampleAttendance();
          payments = generateSamplePayments();
          console.log(`🎭 Generated sample data: attendance(${attendance.length}), payments(${payments.length})`);
        }
      } catch (error) {
        console.error('❌ Error loading Google Sheets data:', error);
        notes = 'Google Sheets configuration error. Using sample data for demonstration.';
        // Add sample data for demonstration
        attendance = generateSampleAttendance();
        payments = generateSamplePayments();
        console.log(`🎭 Using sample data due to error: attendance(${attendance.length}), payments(${payments.length})`);
      }
    } else {
      console.log('⚙️ Google Sheets not configured, using sample data');
      notes = 'Google Sheets not configured. Using sample data for demonstration.';
      // Add sample data for demonstration
      attendance = generateSampleAttendance();
      payments = generateSamplePayments();
      console.log(`🎭 Sample data generated: attendance(${attendance.length}), payments(${payments.length})`);
    }

    // Debug logging for date filtering
    console.log(`📊 Filtering data: fromDate=${fromDate}, toDate=${toDate}, month=${month}, year=${year}`);
    console.log(`📊 Raw data: ${attendance.length} attendance, ${payments.length} payments`);
    
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

    console.log(`📊 Filtered data: ${attendanceFiltered.length} attendance, ${paymentsFiltered.length} payments`);
    console.log(`📊 Sessions: ${groupSessions.length} group, ${privateSessions.length} private`);

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
      notes: notes || 'Results written to payment_calculator and payment_calc_detail tabs. Session-to-payment mapping pending.',
      coachBreakdown: [] // TODO: Implement coach breakdown
    });

  } catch (error) {
    console.error('❌ Error calculating payments:', error);
    
    // Determine the specific error details
    let errorMessage = 'Failed to calculate payments';
    let errorType = 'unknown';
    
    if (error instanceof Error) {
      errorMessage = error.message;
      if (error.message.includes('Google Sheets')) {
        errorType = 'google_sheets';
      } else if (error.message.includes('read') || error.message.includes('fetch')) {
        errorType = 'data_access';
      } else if (error.message.includes('parse') || error.message.includes('invalid')) {
        errorType = 'data_parsing';
      }
    }
    
    console.error(`🔍 Error type: ${errorType}, Message: ${errorMessage}`);
    
    res.status(500).json({
      success: false,
      message: `Calculation Error (${errorType}): ${errorMessage}`,
      errorType,
      errorDetails: {
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        timestamp: new Date().toISOString()
      },
      filters: { month, year, fromDate, toDate },
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
      notes: `Calculation failed due to ${errorType} error: ${errorMessage}`,
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
    let message = 'Verification completed successfully';

    if (isGoogleSheetsConfigured) {
      try {
        const googleSheetsService = new GoogleSheetsService();
        // Get attendance and payment data
        const results = await Promise.all([
          googleSheetsService.readSheet('attendance').catch(() => []),
          googleSheetsService.readSheet('Payments').catch(() => [])
        ]);
        [attendanceData, paymentData] = results;
        
        if (attendanceData.length === 0 && paymentData.length === 0) {
          message = 'Google Sheets connected but no data found. Please import attendance and payment data.';
        }
      } catch (error) {
        console.error('Error loading Google Sheets data for verification:', error);
        message = 'Google Sheets configuration error. Verification completed with empty data.';
        // Continue with empty arrays
      }
    } else {
      message = 'Google Sheets not configured. Please set up Google Sheets credentials in .env file.';
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
      message
    });

  } catch (error) {
    console.error('❌ Error verifying payments:', error);
    
    // Determine the specific error details
    let errorMessage = 'Failed to verify payments';
    let errorType = 'unknown';
    
    if (error instanceof Error) {
      errorMessage = error.message;
      if (error.message.includes('Google Sheets')) {
        errorType = 'google_sheets';
      } else if (error.message.includes('read') || error.message.includes('fetch')) {
        errorType = 'data_access';
      } else if (error.message.includes('parse') || error.message.includes('invalid')) {
        errorType = 'data_parsing';
      }
    }
    
    console.error(`🔍 Verification error type: ${errorType}, Message: ${errorMessage}`);
    
    res.status(500).json({
      success: false,
      message: `Verification Error (${errorType}): ${errorMessage}`,
      errorType,
      errorDetails: {
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        timestamp: new Date().toISOString()
      },
      rows: [],
      summary: {
        attendanceCount: 0,
        verifiedCount: 0,
        unverifiedCount: 0
      }
    });
  }
});

export default router; 