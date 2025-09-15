const express = require('express');
const { google } = require('googleapis');
const router = express.Router();

// -----------------------------
// Sample data generators (fallback when Google Sheets isn't configured)
// -----------------------------
function generateSampleAttendance() {
  const samples = [];
  const now = new Date();
  const customers = ['John Smith', 'Maria Garcia', 'David Wilson', 'Sarah Johnson', 'Mike Brown', 'Lisa Davis', 'Tom Anderson', 'Emma Wilson'];
  const classTypes = ['LEVEL ONE (7 - 12) COMBAT SESSIONS', '1 to 1 Private Combat Session', 'KICKBOXING SESSION', 'BATTLE CONDITIONED'];
  const instructors = ['Zach Bitar', 'Calvin Dean'];
  const memberships = ['Adult Pay Monthly - 3 x Week', '1 to 1 Private Combat Sessions: SINGLE SESSION', 'LevelOne - FULL SUMMER: 3 x per week'];

  for (let m = 0; m < 3; m++) {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 15);
    const ds = d.toISOString().split('T')[0];
    for (let i = 0; i < 25; i++) {
      samples.push({
        Date: ds,
        Customer: customers[Math.floor(Math.random() * customers.length)],
        Membership: memberships[Math.floor(Math.random() * memberships.length)],
        ClassType: classTypes[Math.floor(Math.random() * classTypes.length)],
        Instructors: instructors[Math.floor(Math.random() * instructors.length)],
      });
    }
  }
  return samples;
}

function generateSamplePayments() {
  const samples = [];
  const now = new Date();
  const customers = ['John Smith', 'Maria Garcia', 'David Wilson', 'Sarah Johnson', 'Mike Brown', 'Lisa Davis', 'Tom Anderson', 'Emma Wilson'];
  const amounts = [84.11, 37.38, 14.02, 5.89, 2.62];
  const memos = ['Adult Pay Monthly - 3 x Week', '1 to 1 Private Combat Sessions: SINGLE SESSION', 'Adult Single - Pay as You Go', 'Fee'];
  for (let m = 0; m < 3; m++) {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 15);
    const ds = d.toISOString().split('T')[0];
    for (let i = 0; i < 18; i++) {
      const amount = amounts[Math.floor(Math.random() * amounts.length)];
      samples.push({
        Date: ds,
        Customer: customers[Math.floor(Math.random() * customers.length)],
        Amount: amount.toString(),
        Invoice: (700 + Math.floor(Math.random() * 100)).toString(),
        Memo: memos[Math.floor(Math.random() * memos.length)],
      });
    }
  }
  return samples;
}

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

  // Append new data
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

    // Determine Google Sheets availability
    const isSheetsConfigured = !!(
      process.env.GOOGLE_SHEETS_SPREADSHEET_ID &&
      process.env.GOOGLE_SHEETS_CLIENT_EMAIL &&
      process.env.GOOGLE_SHEETS_PRIVATE_KEY
    );

    let attendance = [];
    let payments = [];
    let rulesSheet = [];
    let settingsSheet = [];
    let discountsSheet = [];
    let notes = '';

    if (isSheetsConfigured) {
      try {
        // Load sheets
        const results = await Promise.all([
          readSheet('attendance').catch(() => []),
          readSheet('Payments').catch(() => []),
          readSheet('rules').catch(() => []),
          readSheet('settings').catch(() => []),
          readSheet('discounts').catch(() => []),
        ]);
        [attendance, payments, rulesSheet, settingsSheet, discountsSheet] = results;

        if (attendance.length === 0 && payments.length === 0) {
          notes = 'Google Sheets connected but no data found. Using sample data for demonstration.';
          attendance = generateSampleAttendance();
          payments = generateSamplePayments();
        }
      } catch (e) {
        console.error('Failed to load Google Sheets data, using sample data:', e?.message || e);
        notes = 'Google Sheets configuration error. Using sample data for demonstration.';
        attendance = generateSampleAttendance();
        payments = generateSamplePayments();
      }
    } else {
      notes = 'Google Sheets not configured. Using sample data for demonstration.';
      attendance = generateSampleAttendance();
      payments = generateSamplePayments();
    }

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

    // Filtered payments
    const paymentsFiltered = payments.filter(p => {
      const d = toDateOnly(p['Date']);
      if (!d) return false;
      if (from || to) return inRange(d, from, to);
      if (!month && !year) return true;
      return monthYearMatch(d, month, year);
    });

    // Only use verified attendance data for calculations (based on customer requirements)
    // Verified means we have a matching payment record
    const verifiedAttendance = attendanceFiltered.filter(attendance => {
      const matchingPayment = paymentsFiltered.find(payment => 
        payment.Customer === attendance.Customer && 
        payment.Date === attendance.Date &&
        payment.Amount && 
        parseFloat(payment.Amount) !== 0 &&
        // Exclude tax/fee payments from revenue calculations
        !(payment.Memo && payment.Memo.toLowerCase().includes('fee'))
      );
      return !!matchingPayment;
    });

    // Use verified attendance for session classification
    const groupSessions = verifiedAttendance.filter(r => classifySession(r['ClassType']) === 'group');
    const privateSessions = verifiedAttendance.filter(r => classifySession(r['ClassType']) === 'private');

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

    // Exclude full discounts and fees from revenue totals and splits (as per customer requirements)
    const paymentsEffective = parsedPayments.filter(p => {
      if (p.discountType === 'full') return false;
      // Exclude fee/tax payments from revenue calculations
      const memo = (p.memo || '').toLowerCase();
      if (memo.includes('fee')) return false;
      return true;
    });
    const totalPayments = paymentsEffective.reduce((sum, p) => sum + (p.amount || 0), 0);
    const counts = {
      attendanceTotal: verifiedAttendance.length, // Only verified attendance counts
      attendanceTotalRaw: attendanceFiltered.length, // Raw attendance for reference
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

    // Percentages from rules sheet (global defaults) if available, else hard defaults
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
    const groupPctDefaults = groupDefaultRule ? {
      coach: parseNum(getVal(groupDefaultRule, ['coach_percentage']), 43.5),
      bgm: parseNum(getVal(groupDefaultRule, ['bgm_percentage']), 30.0),
      management: parseNum(getVal(groupDefaultRule, ['management_percentage']), 8.5),
      mfc: parseNum(getVal(groupDefaultRule, ['mfc_percentage']), 18.0),
    } : { coach: 43.5, bgm: 30.0, management: 8.5, mfc: 18.0 };
    const privatePctDefaults = privateDefaultRule ? {
      coach: parseNum(getVal(privateDefaultRule, ['coach_percentage']), 80.0),
      landlord: parseNum(getVal(privateDefaultRule, ['bgm_percentage', 'landlord_percentage']), 15.0),
      management: parseNum(getVal(privateDefaultRule, ['management_percentage']), 0.0),
      mfc: parseNum(getVal(privateDefaultRule, ['mfc_percentage']), 5.0),
    } : { coach: 80.0, landlord: 15.0, management: 0.0, mfc: 5.0 };

    // Helper to get rule and unit price for a row
    const getRuleForRow = (row) => {
      const membership = (row['Membership'] || '').toString().toLowerCase();
      const sessionType = classifySession(row['ClassType']) === 'private' ? 'private' : 'group';
      let rule = (rulesSheet || []).find(r => String(r.package_name || '').toLowerCase() === membership);
      if (!rule) {
        rule = (rulesSheet || []).find(r => String(r.session_type || '').toLowerCase() === sessionType && !String(r.package_name || '').trim());
      }
      return rule || {};
    };
    const getUnitPrice = (row, rule) => {
      const unit = parseFloat(String(rule?.unit_price || ''));
      const price = parseFloat(String(rule?.price || ''));
      const sessions = parseFloat(String(rule?.sessions_per_pack || rule?.sessions || ''));
      if (!isNaN(unit) && unit > 0) return unit;
      if (!isNaN(price) && !isNaN(sessions) && sessions > 0) return +(price / sessions).toFixed(2);
      return 0;
    };

    // Row-level computation using unit price
    const totals = {
      group: { revenue: 0, coach: 0, bgm: 0, management: 0, mfc: 0 },
      private: { revenue: 0, coach: 0, landlord: 0, management: 0, mfc: 0 },
    };

    // Map payments to sessions per customer and build per-attendance effective amounts
    const attendanceWithIdx = attendanceFiltered.map((r, idx) => ({ ...r, __idx: idx }));
    const customerToAttendance = {};
    attendanceWithIdx.forEach(r => {
      const customer = (r['Customer'] || '').trim();
      if (!customerToAttendance[customer]) customerToAttendance[customer] = { group: [], private: [] };
      const cat = classifySession(r['ClassType']);
      customerToAttendance[customer][cat].push(r);
    });

    const effectiveByIdx = new Map();
    paymentsEffective.forEach(p => {
      const customer = (p.customer || '').trim();
      const buckets = customerToAttendance[customer];
      if (!buckets) return;
      const gCount = buckets.group.length;
      const pCount = buckets.private.length;
      const totalCount = gCount + pCount;
      if (totalCount === 0) return;
      const gAmount = gCount > 0 ? p.amount * (gCount / totalCount) : 0;
      const prAmount = pCount > 0 ? p.amount * (pCount / totalCount) : 0;
      const perGroup = gCount > 0 ? gAmount / gCount : 0;
      const perPrivate = pCount > 0 ? prAmount / pCount : 0;
      buckets.group.forEach(r => {
        const prev = effectiveByIdx.get(r.__idx) || 0;
        effectiveByIdx.set(r.__idx, prev + perGroup);
      });
      buckets.private.forEach(r => {
        const prev = effectiveByIdx.get(r.__idx) || 0;
        effectiveByIdx.set(r.__idx, prev + perPrivate);
      });
    });

    // Build detail rows per attendance and aggregate per-coach gross
    const coachGross = {};
    const detailTemp = attendanceWithIdx.map(r => {
      const cat = classifySession(r['ClassType']);
      // Use expected unit price for revenue recognition when available
      const rule = getRuleForRow(r);
      const unitFromRule = getUnitPrice(r, rule);
      const effAllocated = +(effectiveByIdx.get(r.__idx) || 0).toFixed(2);
      const eff = unitFromRule > 0 ? unitFromRule : effAllocated;
      const instructors = (r['Instructors'] || '').split(',').map(s => s.trim()).filter(Boolean);
      const numInst = Math.max(1, instructors.length);
      const pct = cat === 'group' ? groupPctDefaults : privatePctDefaults;
      const coachAmt = +(eff * (pct.coach / 100)).toFixed(2);
      const bgmAmt = +(eff * ((cat === 'group' ? pct.bgm : pct.landlord) / 100)).toFixed(2);
      const mgmtAmt = +(eff * (pct.management / 100)).toFixed(2);
      const mfcAmt = +(eff * (pct.mfc / 100)).toFixed(2);

      // Aggregate gross per coach (split by instructors equally)
      const sharePerCoach = numInst > 0 ? eff / numInst : eff;
      (instructors.length ? instructors : ['Unassigned']).forEach(name => {
        if (!coachGross[name]) coachGross[name] = { groupGross: 0, privateGross: 0, groupUnits: 0, privateUnits: 0 };
        if (cat === 'group') {
          coachGross[name].groupGross += sharePerCoach;
          coachGross[name].groupUnits += 1 / numInst;
        } else {
          coachGross[name].privateGross += sharePerCoach;
          coachGross[name].privateUnits += 1 / numInst;
        }
      });

      return {
        CalcId: '', // filled later
        RowId: 0,   // filled later
        Date: r['Date'] || '',
        Customer: r['Customer'] || '',
        Coach: instructors.join(', '),
        ClassType: r['ClassType'] || '',
        SessionCategory: cat,
        PackageName: r['Membership'] || '',
        Invoice: '',
        PaymentAmount: effAllocated,
        IsDiscount: '',
        DiscountType: '',
        DiscountAmount: '',
        EffectiveAmount: eff,
        RuleId: String(rule?.id || ''),
        IsFixedRate: String(rule?.is_fixed_rate || ''),
        PackagePrice: rule && rule.price ? +parseFloat(String(rule.price)).toFixed(2) : '',
        UnitPrice: unitFromRule,
        Units: (1 / numInst).toFixed(2),
        CoachPercent: pct.coach,
        BgmPercent: cat === 'group' ? pct.bgm : pct.landlord,
        ManagementPercent: pct.management,
        MfcPercent: pct.mfc,
        CoachAmount: coachAmt,
        BgmAmount: bgmAmt,
        ManagementAmount: mgmtAmt,
        MfcAmount: mfcAmt,
        SourceAttendanceRowId: r.__idx + 1,
        SourcePaymentRowId: '',
        Status: 'calculated',
        ExceptionFlag: '',
        ExceptionReason: '',
        Notes: '',
      };
    });

    // Accumulate totals by category using row-level eff
    detailTemp.forEach(row => {
      if (row.SessionCategory === 'group') {
        totals.group.revenue += row.EffectiveAmount || 0;
        totals.group.coach += row.CoachAmount || 0;
        totals.group.bgm += row.BgmAmount || 0;
        totals.group.management += row.ManagementAmount || 0;
        totals.group.mfc += row.MfcAmount || 0;
      } else {
        totals.private.revenue += row.EffectiveAmount || 0;
        totals.private.coach += row.CoachAmount || 0;
        totals.private.landlord += row.BgmAmount || 0;
        totals.private.management += row.ManagementAmount || 0;
        totals.private.mfc += row.MfcAmount || 0;
      }
    });

    const groupRevenue = +totals.group.revenue.toFixed(2);
    const privateRevenue = +totals.private.revenue.toFixed(2);

    const splits = {
      group: {
        revenue: groupRevenue,
        coach: +totals.group.coach.toFixed(2),
        bgm: +totals.group.bgm.toFixed(2),
        management: +totals.group.management.toFixed(2),
        mfc: +totals.group.mfc.toFixed(2),
        percentage: groupPctDefaults,
      },
      private: {
        revenue: privateRevenue,
        coach: +totals.private.coach.toFixed(2),
        landlord: +totals.private.landlord.toFixed(2),
        management: +totals.private.management.toFixed(2),
        mfc: +totals.private.mfc.toFixed(2),
        percentage: privatePctDefaults,
      },
    };

    // Build coach breakdown from coachGross
    const coachBreakdown = Object.entries(coachGross).map(([name, g]) => {
      const groupPayment = +((g.groupGross || 0) * (groupPctDefaults.coach / 100)).toFixed(2);
      const privatePayment = +((g.privateGross || 0) * (privatePctDefaults.coach / 100)).toFixed(2);
      const bgmPayment = +(((g.groupGross || 0) * (groupPctDefaults.bgm / 100)) + ((g.privateGross || 0) * (privatePctDefaults.landlord / 100))).toFixed(2);
      const managementPayment = +(((g.groupGross || 0) * (groupPctDefaults.management / 100)) + ((g.privateGross || 0) * (privatePctDefaults.management / 100))).toFixed(2);
      const mfcRetained = +(((g.groupGross || 0) * (groupPctDefaults.mfc / 100)) + ((g.privateGross || 0) * (privatePctDefaults.mfc / 100))).toFixed(2);
      return {
        coach: name,
        groupAttendances: +(g.groupUnits || 0).toFixed(2),
        privateAttendances: +(g.privateUnits || 0).toFixed(2),
        groupGross: +(g.groupGross || 0).toFixed(2),
        privateGross: +(g.privateGross || 0).toFixed(2),
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

    // Convert temp detail to final and assign CalcId/RowId
    let rowIdCounter = 1;
    const detailRows = detailTemp.map(r => ({
      ...r,
      CalcId: calcId,
      RowId: rowIdCounter++,
    }));

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
      calcId,
      notes: notes || 'Results written to payment_calculator and payment_calc_detail tabs. Session-to-payment mapping pending.',
    });
  } catch (error) {
    console.error('Error calculating payments:', error);
    return res.status(500).json({ success: false, message: 'Failed to calculate payments' });
  }
});

// @desc    Verify payments against attendance (row-level) - REMOVED
// @route   POST /payments/verify - REMOVED
// @access  Private - REMOVED
// Payment verification endpoint has been removed as requested

// @desc    Get payment history (placeholder)
router.get('/history', (req, res) => {
  res.json({ message: 'Get payment history route - TODO' });
});

// @desc    Generate payment report (placeholder)
router.post('/generate-report', (req, res) => {
  res.json({ message: 'Generate payment report route - TODO' });
});

// @desc    Get payment rules
router.get('/rules', async (req, res) => {
  try {
    const rules = await readSheet('rules');
    return res.json({ 
      success: true, 
      data: rules,
      message: 'Payment rules retrieved successfully'
    });
  } catch (e) {
    console.error('Payment rules error:', e);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to load payment rules' 
    });
  }
});

// @desc    Get global payment rules
router.get('/rules/global', async (req, res) => {
  try {
    const rules = await readSheet('rules');
    const globalRules = rules.filter(r => !String(r.package_name || '').trim());
    return res.json({ 
      success: true, 
      data: globalRules,
      message: 'Global payment rules retrieved successfully'
    });
  } catch (e) {
    console.error('Global payment rules error:', e);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to load global payment rules' 
    });
  }
});

// @desc    Create payment rule
router.post('/rules', async (req, res) => {
  try {
    const input = req.body || {};
    const rules = await readSheet('rules');
    const nextId = rules.reduce((m, r) => Math.max(m, parseInt(r.id || r.ID || '0') || 0), 0) + 1;
    input.id = String(nextId);
    input.created_at = new Date().toISOString();
    input.updated_at = new Date().toISOString();
    
    const newRules = [...rules, input];
    await writeSheet('rules', newRules);
    
    return res.json({ 
      success: true, 
      data: input,
      message: 'Payment rule created successfully'
    });
  } catch (e) {
    console.error('Create payment rule error:', e);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to create payment rule' 
    });
  }
});

// @desc    Update payment rule
router.put('/rules/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const input = req.body || {};
    const rules = await readSheet('rules');
    
    const ruleIndex = rules.findIndex(r => String(r.id || r.ID) === String(id));
    if (ruleIndex === -1) {
      return res.status(404).json({ 
        success: false, 
        message: 'Rule not found' 
      });
    }
    
    input.id = id;
    input.updated_at = new Date().toISOString();
    rules[ruleIndex] = { ...rules[ruleIndex], ...input };
    
    await writeSheet('rules', rules);
    
    return res.json({ 
      success: true, 
      data: rules[ruleIndex],
      message: 'Payment rule updated successfully'
    });
  } catch (e) {
    console.error('Update payment rule error:', e);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to update payment rule' 
    });
  }
});

// @desc    Delete payment rule
router.delete('/rules/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const rules = await readSheet('rules');
    
    const filteredRules = rules.filter(r => String(r.id || r.ID) !== String(id));
    if (filteredRules.length === rules.length) {
      return res.status(404).json({ 
        success: false, 
        message: 'Rule not found' 
      });
    }
    
    await writeSheet('rules', filteredRules);
    
    return res.json({ 
      success: true, 
      message: 'Payment rule deleted successfully'
    });
  } catch (e) {
    console.error('Delete payment rule error:', e);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to delete payment rule' 
    });
  }
});

// @desc    Get payment settings
router.get('/settings', async (req, res) => {
  try {
    const settings = await readSheet('settings');
    return res.json({ 
      success: true, 
      data: settings,
      message: 'Payment settings retrieved successfully'
    });
  } catch (e) {
    console.error('Payment settings error:', e);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to load payment settings' 
    });
  }
});

// @desc    Update payment settings
router.put('/settings', async (req, res) => {
  try {
    const input = Array.isArray(req.body) ? req.body : [req.body];
    const settings = await readSheet('settings');
    const map = new Map(settings.map(r => [String(r.key).toLowerCase(), r]));
    
    input.forEach(item => {
      const key = String(item.key).toLowerCase();
      map.set(key, { 
        key: item.key, 
        value: String(item.value ?? ''), 
        description: item.description || '' 
      });
    });
    
    const newSettings = Array.from(map.values());
    await writeSheet('settings', newSettings);
    
    return res.json({ 
      success: true, 
      message: 'Payment settings updated successfully'
    });
  } catch (e) {
    console.error('Update payment settings error:', e);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to update payment settings' 
    });
  }
});

module.exports = router;