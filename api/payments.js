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

function toDateOnly(value) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function monthYearMatch(date, month, year) {
  if (!date) return false;
  const m = date.getUTCMonth() + 1;
  const y = date.getUTCFullYear();
  if (month && parseInt(month) !== m) return false;
  if (year && parseInt(year) !== y) return false;
  return true;
}

function inRange(date, fromDate, toDate) {
  if (!date) return false;
  if (fromDate && date < fromDate) return false;
  if (toDate && date > toDate) return false;
  return true;
}

function classifySession(classType) {
  const v = (classType || '').toString().toLowerCase();
  if (v.includes('private') || v.includes('1-1') || v.includes('1 to 1') || v.includes('one to one')) return 'private';
  return 'group';
}

function isDiscountPayment(memo = '') {
  const v = memo.toString().toLowerCase();
  const keywords = [
    'discount',
    'freedom pass',
    'mindbody switch',
    'summer school',
    'loyalty scheme',
    'fortnight special',
    'summer academy',
  ];
  return keywords.some(k => v.includes(k));
}

// @desc    Calculate payments (scaffold)
// @route   POST /payments/calculate
// @access  Private
router.post('/calculate', async (req, res) => {
  try {
    const { month, year, fromDate, toDate } = req.body || {};
    const from = toDateOnly(fromDate);
    const to = toDateOnly(toDate);

    // Load sheets
    const [attendance, payments] = await Promise.all([
      readSheet('attendance'),
      readSheet('payments'),
    ]);

    // Filtered attendance
    const attendanceFiltered = attendance.filter(r => {
      const d = toDateOnly(r['Date']);
      if (!d) return false;
      if (from || to) return inRange(d, from, to);
      if (!month && !year) return true;
      return monthYearMatch(d, month, year);
    });

    const groupSessions = attendanceFiltered.filter(r => classifySession(r['ClassType']) === 'group');
    const privateSessions = attendanceFiltered.filter(r => classifySession(r['ClassType']) === 'private');

    // Filtered payments
    const paymentsFiltered = payments.filter(p => {
      const d = toDateOnly(p['Date']);
      if (!d) return false;
      if (from || to) return inRange(d, from, to);
      if (!month && !year) return true;
      return monthYearMatch(d, month, year);
    });

    const parsedPayments = paymentsFiltered.map(p => ({
      date: toDateOnly(p['Date']),
      customer: p['Customer'] || '',
      memo: p['Memo'] || '',
      amount: parseFloat(p['Amount'] || '0') || 0,
      invoice: p['Invoice'] || '',
      isDiscount: isDiscountPayment(p['Memo'] || ''),
    }));

    const totalPayments = parsedPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
    const counts = {
      attendanceTotal: attendanceFiltered.length,
      groupSessions: groupSessions.length,
      privateSessions: privateSessions.length,
      paymentsCount: parsedPayments.length,
      discountPayments: parsedPayments.filter(p => p.isDiscount).length,
    };

    // Scaffolded revenue splits (actual mapping to sessions will be added next)
    const splits = {
      group: { coach: 0, bgm: 0, management: 0, mfc: 0 },
      private: { coach: 0, landlord: 0, management: 0, mfc: 0 },
    };

    return res.json({
      success: true,
      filters: { month: month ? parseInt(month) : null, year: year ? parseInt(year) : null, fromDate: from ? from.toISOString().slice(0,10) : null, toDate: to ? to.toISOString().slice(0,10) : null },
      counts,
      revenue: { totalPayments },
      splits,
      notes: 'This is an initial scaffold. Mapping payments to sessions and applying rules comes next.',
    });
  } catch (error) {
    console.error('Error calculating payments:', error);
    return res.status(500).json({ success: false, message: 'Failed to calculate payments' });
  }
});

// @desc    Get payment history (placeholder)
router.get('/history', (req, res) => {
  res.json({ message: 'Get payment history route - TODO' });
});

// @desc    Generate payment report (placeholder)
router.post('/generate-report', (req, res) => {
  res.json({ message: 'Generate payment report route - TODO' });
});

// @desc    Get payment rules (placeholder)
router.get('/rules', (req, res) => {
  res.json({ message: 'Get payment rules route - TODO' });
});

module.exports = router;