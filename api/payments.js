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

// Write an array of objects to a sheet (clears A:Z, writes headers + rows)
async function writeSheet(sheetName, data) {
  if (!Array.isArray(data) || data.length === 0) return;

  const auth = getGoogleSheetsAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

  const headers = Object.keys(data[0]);
  const values = [headers, ...data.map(row => headers.map(h => (row[h] ?? '')))]
    .map(r => r.map(v => (v === null || v === undefined ? '' : v)));

  // Clear old content
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${sheetName}!A:Z`,
  });

  // Append new
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'OVERWRITE',
    resource: { values },
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

// @desc    Calculate payments (scaffold)
// @route   POST /payments/calculate
// @access  Private
router.post('/calculate', async (req, res) => {
  try {
    const { month, year, fromDate, toDate } = req.body || {};
    const from = toDateOnly(fromDate);
    const to = toDateOnly(toDate);

    // Load sheets
    const [attendance, payments, rulesSheet, settingsSheet, discountsSheet] = await Promise.all([
      readSheet('attendance'),
      readSheet('payments'),
      readSheet('rules').catch(() => []),
      readSheet('settings').catch(() => []),
      readSheet('discounts').catch(() => []),
    ]);

    // Helpers to read flexible column names from sheets
    const getVal = (row, keys) => {
      for (const k of keys) {
        if (row[k] !== undefined) return row[k];
        // try case-insensitive match
        const found = Object.keys(row).find(x => x.toLowerCase() === k.toLowerCase());
        if (found) return row[found];
      }
      return undefined;
    };

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

    // Build discount matchers from sheet if present
    const discountsMatchers = (Array.isArray(discountsSheet) ? discountsSheet : [])
      .map(r => ({
        alias: (getVal(r, ['alias']) || '').toString().trim().toLowerCase(),
        matchType: (getVal(r, ['match_type']) || '').toString().trim().toLowerCase(),
        discountType: (getVal(r, ['discount_type']) || '').toString().trim().toLowerCase(),
        active: (getVal(r, ['active']) || '').toString().trim().toLowerCase(),
      }))
      .filter(r => r.alias && (r.active === 'true' || r.active === '1' || r.active === 'yes'));

    const detectDiscount = (memo, amount) => {
      const text = (memo || '').toString().toLowerCase();
      if (discountsMatchers.length > 0) {
        let type = null;
        for (const m of discountsMatchers) {
          const isMatch = m.matchType === 'exact' ? text === m.alias : text.includes(m.alias);
          if (isMatch) {
            if (m.discountType === 'full') return { isDiscount: true, discountType: 'full' };
            if (m.discountType === 'partial') type = 'partial';
          }
        }
        return { isDiscount: !!type, discountType: type };
      }
      // Fallback to static detection
      const fallbackType = getDiscountType(memo, amount);
      return { isDiscount: !!fallbackType, discountType: fallbackType };
    };

    const parsedPayments = paymentsFiltered.map(p => {
      const amount = parseFloat(p['Amount'] || '0') || 0;
      const dd = detectDiscount(p['Memo'] || '', amount);
      return ({
        date: toDateOnly(p['Date']),
        customer: p['Customer'] || '',
        memo: p['Memo'] || '',
        amount,
        invoice: p['Invoice'] || '',
        isDiscount: dd.isDiscount,
        discountType: dd.discountType,
      });
    });

    // Exclude full discounts from revenue totals and splits
    const paymentsEffective = parsedPayments.filter(p => p.discountType !== 'full');
    const totalPayments = paymentsEffective.reduce((sum, p) => sum + (p.amount || 0), 0);
    const counts = {
      attendanceTotal: attendanceFiltered.length,
      groupSessions: groupSessions.length,
      privateSessions: privateSessions.length,
      paymentsCount: parsedPayments.length,
      discountPayments: parsedPayments.filter(p => p.isDiscount).length,
    };

    const discounts = {
      fullCount: parsedPayments.filter(p => p.discountType === 'full').length,
      fullAmount: parsedPayments.filter(p => p.discountType === 'full').reduce((s, p) => s + (p.amount || 0), 0),
      partialCount: parsedPayments.filter(p => p.discountType === 'partial').length,
      partialAmount: parsedPayments.filter(p => p.discountType === 'partial').reduce((s, p) => s + (p.amount || 0), 0),
    };

    // Proportional revenue allocation by session counts (heuristic until session-payment mapping is implemented)
    // Allocate payments to group/private by customer's session mix within range
    const customerSessions = {};
    attendanceFiltered.forEach(r => {
      const customer = (r['Customer'] || '').trim();
      const type = classifySession(r['ClassType']);
      if (!customerSessions[customer]) customerSessions[customer] = { group: 0, private: 0 };
      customerSessions[customer][type] += 1;
    });

    const totalSessions = counts.groupSessions + counts.privateSessions;
    let allocatedGroupRevenue = 0;
    let allocatedPrivateRevenue = 0;
    let unassignedAmount = 0;

    paymentsEffective.forEach(p => {
      const stats = customerSessions[(p.customer || '').trim()];
      if (stats) {
        const cTotal = (stats.group || 0) + (stats.private || 0);
        if (cTotal > 0) {
          allocatedGroupRevenue += p.amount * (stats.group / cTotal);
          allocatedPrivateRevenue += p.amount * (stats.private / cTotal);
        } else {
          unassignedAmount += p.amount;
        }
      } else {
        unassignedAmount += p.amount;
      }
    });

    if (unassignedAmount > 0) {
      const globalGroupShare = totalSessions > 0 ? (counts.groupSessions / totalSessions) : 1;
      allocatedGroupRevenue += unassignedAmount * globalGroupShare;
      allocatedPrivateRevenue += unassignedAmount * (1 - globalGroupShare);
    }

    const groupRevenue = allocatedGroupRevenue;
    const privateRevenue = allocatedPrivateRevenue;

    // Percentages from rules sheet if available, else defaults
    const parseNum = (v, d = 0) => {
      const n = parseFloat(String(v).replace('%',''));
      return isNaN(n) ? d : n;
    };
    const groupDefaultRule = (rulesSheet || []).find(r =>
      (String(getVal(r, ['session_type'])).toLowerCase() === 'group') &&
      !String(getVal(r, ['package_name'])).trim()
    );
    const privateDefaultRule = (rulesSheet || []).find(r =>
      (String(getVal(r, ['session_type'])).toLowerCase() === 'private') &&
      !String(getVal(r, ['package_name'])).trim()
    );
    const groupPct = groupDefaultRule ? {
      coach: parseNum(getVal(groupDefaultRule, ['coach_percentage']), 43.5),
      bgm: parseNum(getVal(groupDefaultRule, ['bgm_percentage']), 30.0),
      management: parseNum(getVal(groupDefaultRule, ['management_percentage']), 8.5),
      mfc: parseNum(getVal(groupDefaultRule, ['mfc_percentage']), 18.0),
    } : { coach: 43.5, bgm: 30.0, management: 8.5, mfc: 18.0 };
    const privatePct = privateDefaultRule ? {
      coach: parseNum(getVal(privateDefaultRule, ['coach_percentage']), 80.0),
      landlord: parseNum(getVal(privateDefaultRule, ['bgm_percentage', 'landlord_percentage']), 15.0),
      management: parseNum(getVal(privateDefaultRule, ['management_percentage']), 0.0),
      mfc: parseNum(getVal(privateDefaultRule, ['mfc_percentage']), 5.0),
    } : { coach: 80.0, landlord: 15.0, management: 0.0, mfc: 5.0 };

    const splits = {
      group: {
        revenue: groupRevenue,
        coach: +(groupRevenue * groupPct.coach / 100).toFixed(2),
        bgm: +(groupRevenue * groupPct.bgm / 100).toFixed(2),
        management: +(groupRevenue * groupPct.management / 100).toFixed(2),
        mfc: +(groupRevenue * groupPct.mfc / 100).toFixed(2),
        percentage: groupPct,
      },
      private: {
        revenue: privateRevenue,
        coach: +(privateRevenue * privatePct.coach / 100).toFixed(2),
        landlord: +(privateRevenue * privatePct.landlord / 100).toFixed(2),
        management: +(privateRevenue * privatePct.management / 100).toFixed(2),
        mfc: +(privateRevenue * privatePct.mfc / 100).toFixed(2),
        percentage: privatePct,
      },
    };

    // Coach-level breakdown using attendance weighting
    const coachUnits = {};
    groupSessions.forEach(r => {
      const instructors = (r['Instructors'] || '').split(',').map(s => s.trim()).filter(Boolean);
      const unit = instructors.length > 0 ? 1 / instructors.length : 1;
      (instructors.length ? instructors : ['Unassigned']).forEach(name => {
        if (!coachUnits[name]) coachUnits[name] = { group: 0, private: 0 };
        coachUnits[name].group += unit;
      });
    });
    privateSessions.forEach(r => {
      const instructors = (r['Instructors'] || '').split(',').map(s => s.trim()).filter(Boolean);
      const unit = instructors.length > 0 ? 1 / instructors.length : 1;
      (instructors.length ? instructors : ['Unassigned']).forEach(name => {
        if (!coachUnits[name]) coachUnits[name] = { group: 0, private: 0 };
        coachUnits[name].private += unit;
      });
    });

    const totalGroupUnits = Object.values(coachUnits).reduce((s, c) => s + (c.group || 0), 0);
    const totalPrivateUnits = Object.values(coachUnits).reduce((s, c) => s + (c.private || 0), 0);
    const groupCoachPool = splits.group.coach;
    const privateCoachPool = splits.private.coach;

    const coachBreakdown = Object.entries(coachUnits).map(([name, units]) => {
      const groupShare = totalGroupUnits > 0 ? (units.group / totalGroupUnits) : 0;
      const privateShare = totalPrivateUnits > 0 ? (units.private / totalPrivateUnits) : 0;

      const coachGroupGross = +(groupRevenue * groupShare).toFixed(2);
      const coachPrivateGross = +(privateRevenue * privateShare).toFixed(2);

      const groupPayment = +(coachGroupGross * (groupPct.coach / 100)).toFixed(2);
      const privatePayment = +(coachPrivateGross * (privatePct.coach / 100)).toFixed(2);

      const bgmPayment = +((coachGroupGross * (groupPct.bgm / 100)) + (coachPrivateGross * (privatePct.landlord / 100))).toFixed(2);
      const managementPayment = +((coachGroupGross * (groupPct.management / 100)) + (coachPrivateGross * (privatePct.management / 100))).toFixed(2);
      const mfcRetained = +((coachGroupGross * (groupPct.mfc / 100)) + (coachPrivateGross * (privatePct.mfc / 100))).toFixed(2);

      return {
        coach: name,
        groupAttendances: +units.group.toFixed(2),
        privateAttendances: +units.private.toFixed(2),
        groupGross: coachGroupGross,
        privateGross: coachPrivateGross,
        groupPayment,
        privatePayment,
        totalPayment: +(groupPayment + privatePayment).toFixed(2),
        bgmPayment,
        managementPayment,
        mfcRetained,
      };
    }).sort((a, b) => b.totalPayment - a.totalPayment);

    // Build write payloads for Google Sheets tabs
    const iso = new Date().toISOString();
    const calcId = `CALC-${iso.replace(/[-:.TZ]/g, '')}`;
    const sysVersion = (() => {
      const row = (settingsSheet || []).find(r => String(getVal(r, ['key'])).toLowerCase() === 'system_version');
      return row ? String(getVal(row, ['value']) || '1.0.0') : '1.0.0';
    })();

    const filtersOut = { month: month ? parseInt(month) : null, year: year ? parseInt(year) : null, fromDate: from ? from.toISOString().slice(0,10) : null, toDate: to ? to.toISOString().slice(0,10) : null };

    // Allocate partial discount amount to coaches by their share of total gross
    const totalGross = groupRevenue + privateRevenue;
    const partialDiscountTotal = discounts.partialAmount || 0;

    const summaryRows = (coachBreakdown || []).map(row => ({
      CalcId: calcId,
      Month: filtersOut.month || '',
      FromDate: filtersOut.fromDate || '',
      ToDate: filtersOut.toDate || '',
      Coach: row.coach,
      GroupAttendances: row.groupAttendances,
      PrivateAttendances: row.privateAttendances,
      GroupGross: row.groupGross,
      PrivateGross: row.privateGross,
      DiscountsApplied: totalGross > 0 ? +((partialDiscountTotal) * ((row.groupGross + row.privateGross) / totalGross)).toFixed(2) : 0,
      GroupPayment: row.groupPayment,
      PrivatePayment: row.privatePayment,
      TotalPayment: row.totalPayment,
      BgmPayment: row.bgmPayment,
      ManagementPayment: row.managementPayment,
      MfcRetained: row.mfcRetained,
      Notes: 'Calculated via API',
      RulesVersion: sysVersion,
      RunBy: 'api',
      RunAtISO: iso,
    }));

    // Minimal detail rows: two per coach (group/private)
    let rowIdCounter = 1;
    const detailRows = [];
    Object.entries(coachUnits).forEach(([name, units]) => {
      // group
      const coachGroupGross = +(groupRevenue * (totalGroupUnits > 0 ? (units.group / totalGroupUnits) : 0)).toFixed(2);
      const coachPrivateGross = +(privateRevenue * (totalPrivateUnits > 0 ? (units.private / totalPrivateUnits) : 0)).toFixed(2);

      detailRows.push({
        CalcId: calcId,
        RowId: rowIdCounter++,
        Date: '',
        Customer: '',
        Coach: name,
        ClassType: '',
        SessionCategory: 'group',
        PackageName: '',
        Invoice: '',
        PaymentAmount: '',
        IsDiscount: '',
        DiscountType: '',
        DiscountAmount: '',
        EffectiveAmount: coachGroupGross,
        RuleId: '',
        IsFixedRate: '',
        UnitPrice: '',
        Units: Number(units.group || 0).toFixed(2),
        CoachPercent: groupPct.coach,
        BgmPercent: groupPct.bgm,
        ManagementPercent: groupPct.management,
        MfcPercent: groupPct.mfc,
        CoachAmount: (coachBreakdown.find(r => r.coach === name)?.groupPayment) || 0,
        BgmAmount: +(coachGroupGross * (groupPct.bgm / 100)).toFixed(2),
        ManagementAmount: +(coachGroupGross * (groupPct.management / 100)).toFixed(2),
        MfcAmount: +(coachGroupGross * (groupPct.mfc / 100)).toFixed(2),
        SourceAttendanceRowId: '',
        SourcePaymentRowId: '',
        Status: 'calculated',
        ExceptionFlag: '',
        ExceptionReason: '',
        Notes: 'Aggregated row',
      });
      // private
      detailRows.push({
        CalcId: calcId,
        RowId: rowIdCounter++,
        Date: '',
        Customer: '',
        Coach: name,
        ClassType: '',
        SessionCategory: 'private',
        PackageName: '',
        Invoice: '',
        PaymentAmount: '',
        IsDiscount: '',
        DiscountType: '',
        DiscountAmount: '',
        EffectiveAmount: coachPrivateGross,
        RuleId: '',
        IsFixedRate: '',
        UnitPrice: '',
        Units: Number(units.private || 0).toFixed(2),
        CoachPercent: privatePct.coach,
        BgmPercent: privatePct.landlord,
        ManagementPercent: privatePct.management,
        MfcPercent: privatePct.mfc,
        CoachAmount: (coachBreakdown.find(r => r.coach === name)?.privatePayment) || 0,
        BgmAmount: +(coachPrivateGross * (privatePct.landlord / 100)).toFixed(2),
        ManagementAmount: +(coachPrivateGross * (privatePct.management / 100)).toFixed(2),
        MfcAmount: +(coachPrivateGross * (privatePct.mfc / 100)).toFixed(2),
        SourceAttendanceRowId: '',
        SourcePaymentRowId: '',
        Status: 'calculated',
        ExceptionFlag: '',
        ExceptionReason: '',
        Notes: 'Aggregated row',
      });
    });

    try {
      await writeSheet('payment_calculator', summaryRows);
    } catch (e) {
      console.error('Failed writing payment_calculator:', e?.message || e);
    }
    try {
      await writeSheet('payment_calc_detail', detailRows);
    } catch (e) {
      console.error('Failed writing payment_calc_detail:', e?.message || e);
    }

    return res.json({
      success: true,
      filters: filtersOut,
      counts,
      revenue: { totalPayments, groupRevenue: +groupRevenue.toFixed(2), privateRevenue: +privateRevenue.toFixed(2) },
      splits,
      discounts,
      coachBreakdown,
      notes: 'Results written to payment_calculator and payment_calc_detail tabs. Session-to-payment mapping pending.',
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