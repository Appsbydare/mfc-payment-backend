const express = require('express');
const { google } = require('googleapis');
const router = express.Router();

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

function getDiscountType(memo = '', amount = 0) {
  const v = memo.toString().toLowerCase();
  const isFullKeywords = v.includes('freedom pass') || v.includes('mindbody switch') || v.includes('100%');
  if (isFullKeywords || amount === 0) return 'full';
  if (isDiscountPayment(memo)) return 'partial';
  return null;
}

// @desc    Get payment reports
// @route   GET /api/reports/payments
// @access  Private
router.get('/payments', (req, res) => {
  res.json({ message: 'Get payment reports route - TODO' });
});

// @desc    Export reports
// @route   POST /api/reports/export
// @access  Private
router.post('/export', (req, res) => {
  res.json({ message: 'Export reports route - TODO' });
});

// @desc    Generate report using calculation results
// @route   POST /reports/generate
// @access  Private
router.post('/generate', async (req, res) => {
  try {
    const { reportType, filters = {} } = req.body || {};
    const { month, year, fromDate, toDate } = filters;
    const from = toDateOnly(fromDate);
    const to = toDateOnly(toDate);

    const [attendance, payments] = await Promise.all([
      readSheet('attendance'),
      readSheet('payments'),
    ]);

    const attendanceFiltered = attendance.filter(r => {
      const d = toDateOnly(r['Date']);
      if (!d) return false;
      if (from || to) return inRange(d, from, to);
      if (!month && !year) return true;
      return monthYearMatch(d, month, year);
    });
    const groupSessions = attendanceFiltered.filter(r => classifySession(r['ClassType']) === 'group');
    const privateSessions = attendanceFiltered.filter(r => classifySession(r['ClassType']) === 'private');

    const paymentsFiltered = payments.filter(p => {
      const d = toDateOnly(p['Date']);
      if (!d) return false;
      if (from || to) return inRange(d, from, to);
      if (!month && !year) return true;
      return monthYearMatch(d, month, year);
    }).map(p => ({
      date: toDateOnly(p['Date']),
      customer: p['Customer'] || '',
      memo: p['Memo'] || '',
      amount: parseFloat(p['Amount'] || '0') || 0,
      invoice: p['Invoice'] || '',
      isDiscount: isDiscountPayment(p['Memo'] || ''),
      discountType: getDiscountType(p['Memo'] || '', parseFloat(p['Amount'] || '0') || 0),
    }));

    const paymentsEffective = paymentsFiltered.filter(p => p.discountType !== 'full');

    // Customer session mix allocation
    const counts = {
      attendanceTotal: attendanceFiltered.length,
      groupSessions: groupSessions.length,
      privateSessions: privateSessions.length,
      paymentsCount: paymentsFiltered.length,
      discountPayments: paymentsFiltered.filter(p => p.isDiscount).length,
    };
    const customerSessions = {};
    attendanceFiltered.forEach(r => {
      const customer = (r['Customer'] || '').trim();
      const type = classifySession(r['ClassType']);
      if (!customerSessions[customer]) customerSessions[customer] = { group: 0, private: 0 };
      customerSessions[customer][type] += 1;
    });
    const totalPayments = paymentsEffective.reduce((s, p) => s + (p.amount || 0), 0);
    const totalSessions = counts.groupSessions + counts.privateSessions;
    let allocatedGroupRevenue = 0, allocatedPrivateRevenue = 0, unassignedAmount = 0;
    paymentsEffective.forEach(p => {
      const stats = customerSessions[(p.customer || '').trim()];
      if (stats) {
        const cTotal = (stats.group || 0) + (stats.private || 0);
        if (cTotal > 0) {
          allocatedGroupRevenue += p.amount * (stats.group / cTotal);
          allocatedPrivateRevenue += p.amount * (stats.private / cTotal);
        } else { unassignedAmount += p.amount; }
      } else { unassignedAmount += p.amount; }
    });
    if (unassignedAmount > 0) {
      const globalGroupShare = totalSessions > 0 ? (counts.groupSessions / totalSessions) : 1;
      allocatedGroupRevenue += unassignedAmount * globalGroupShare;
      allocatedPrivateRevenue += unassignedAmount * (1 - globalGroupShare);
    }

    const groupPct = { coach: 43.5, bgm: 30.0, management: 8.5, mfc: 18.0 };
    const privatePct = { coach: 80.0, landlord: 15.0, management: 0.0, mfc: 5.0 };
    const splits = {
      group: {
        revenue: +allocatedGroupRevenue.toFixed(2),
        coach: +(allocatedGroupRevenue * groupPct.coach / 100).toFixed(2),
        bgm: +(allocatedGroupRevenue * groupPct.bgm / 100).toFixed(2),
        management: +(allocatedGroupRevenue * groupPct.management / 100).toFixed(2),
        mfc: +(allocatedGroupRevenue * groupPct.mfc / 100).toFixed(2),
        percentage: groupPct,
      },
      private: {
        revenue: +allocatedPrivateRevenue.toFixed(2),
        coach: +(allocatedPrivateRevenue * privatePct.coach / 100).toFixed(2),
        landlord: +(allocatedPrivateRevenue * privatePct.landlord / 100).toFixed(2),
        management: +(allocatedPrivateRevenue * privatePct.management / 100).toFixed(2),
        mfc: +(allocatedPrivateRevenue * privatePct.mfc / 100).toFixed(2),
        percentage: privatePct,
      },
    };

    return res.json({
      success: true,
      reportType,
      filters: { month: month ? parseInt(month) : null, year: year ? parseInt(year) : null, fromDate: from ? from.toISOString().slice(0,10) : null, toDate: to ? to.toISOString().slice(0,10) : null },
      counts,
      revenue: { totalPayments: +totalPayments.toFixed(2), groupRevenue: splits.group.revenue, privateRevenue: splits.private.revenue },
      splits,
      message: 'Report generated',
    });
  } catch (err) {
    console.error('Report generation error:', err);
    res.status(500).json({ success: false, message: 'Failed to generate report' });
  }
});

module.exports = router; 