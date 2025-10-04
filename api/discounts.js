const express = require('express');
const { google } = require('googleapis');
const router = express.Router();

// Minimal CORS for serverless route (helps when platform-level CORS misses preflight). Testing24

router.use((req, res, next) => {
  const origin = process.env.CORS_ORIGIN || 'https://mfc-payment-frontend.vercel.app';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

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

async function writeSheet(sheetName, data) {
  if (!Array.isArray(data)) return;
  const auth = getGoogleSheetsAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

  if (data.length === 0) {
    // Clear sheet when empty
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${sheetName}!A:Z`,
    });
    return;
  }

  const headers = Object.keys(data[0]);
  const values = [headers, ...data.map(row => headers.map(h => (row[h] ?? '')))]
    .map(r => r.map(v => (v === null || v === undefined ? '' : v)));

  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `${sheetName}!A:Z` });
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'OVERWRITE',
    resource: { values },
  });
}

// GET /discounts -> read from 'discounts' sheet and map
router.get('/', async (req, res) => {
  try {
    const raw = await readSheet('discounts');
    const discounts = (raw || []).map((row, idx) => ({
      id: row.id || (idx + 1),
      discount_code: row.discount_code || row['discount_code'] || '',
      name: row.name || row['name'] || '',
      applicable_percentage: parseFloat(row.applicable_percentage || row['applicable_percentage'] || '0') || 0,
      coach_payment_type: String(row.coach_payment_type || row['coach_payment_type'] || 'partial').toLowerCase(),
      match_type: String(row.match_type || row['match_type'] || 'exact').toLowerCase(),
      active: row.active === true || String(row.active).toUpperCase() === 'TRUE' || row.active === '1' || row.active === 1,
      notes: row.notes || row['notes'] || '',
      created_at: row.created_at || row['created_at'] || new Date().toISOString(),
      updated_at: row.updated_at || row['updated_at'] || new Date().toISOString(),
    })).filter(d => d.discount_code && d.name);

    return res.json({ success: true, data: discounts });
  } catch (e) {
    console.error('Discounts list error:', e);
    return res.status(500).json({ success: false, message: 'Failed to load discounts' });
  }
});

// POST /discounts -> create a discount
router.post('/', async (req, res) => {
  try {
    const input = req.body || {};
    const rows = await readSheet('discounts');
    const nextId = rows.reduce((m, r) => Math.max(m, parseInt(r.id || '0') || 0), 0) + 1;
    const newRow = {
      id: String(nextId),
      discount_code: String(input.discount_code || '').trim(),
      name: String(input.name || '').trim(),
      applicable_percentage: input.applicable_percentage ?? 0,
      coach_payment_type: String(input.coach_payment_type || 'partial').toLowerCase(),
      match_type: String(input.match_type || 'exact').toLowerCase(),
      active: input.active === true || String(input.active).toUpperCase() === 'TRUE' ? 'TRUE' : '',
      notes: String(input.notes || ''),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const headers = rows[0] ? Object.keys(rows[0]) : Object.keys(newRow);
    const normalized = rows.map(r => ({ ...headers.reduce((o, k) => ({ ...o, [k]: r[k] ?? '' }), {}) }));
    normalized.push({ ...headers.reduce((o, k) => ({ ...o, [k]: '' }), {}), ...newRow });
    await writeSheet('discounts', normalized);
    return res.status(201).json({ success: true, data: newRow, message: 'Discount created successfully' });
  } catch (e) {
    console.error('Create discount error:', e);
    return res.status(500).json({ success: false, message: 'Failed to create discount' });
  }
});

// PUT /discounts/:id -> update discount
router.put('/:id', async (req, res) => {
  try {
    const id = String(req.params.id);
    const updates = req.body || {};
    const rows = await readSheet('discounts');
    if (!rows || rows.length === 0) return res.status(404).json({ success: false, message: 'Discount not found' });
    const idx = rows.findIndex(r => String(r.id) === id);
    if (idx === -1) return res.status(404).json({ success: false, message: 'Discount not found' });

    const updated = {
      ...rows[idx],
      ...updates,
      updated_at: new Date().toISOString(),
    };
    rows[idx] = updated;
    await writeSheet('discounts', rows);
    return res.json({ success: true, data: updated, message: 'Discount updated successfully' });
  } catch (e) {
    console.error('Update discount error:', e);
    return res.status(500).json({ success: false, message: 'Failed to update discount' });
  }
});

// DELETE /discounts/:id -> delete discount
router.delete('/:id', async (req, res) => {
  try {
    const id = String(req.params.id);
    const rows = await readSheet('discounts');
    const filtered = rows.filter(r => String(r.id) !== id);
    if (filtered.length === rows.length) return res.status(404).json({ success: false, message: 'Discount not found' });
    await writeSheet('discounts', filtered);
    return res.json({ success: true, message: 'Discount deleted successfully' });
  } catch (e) {
    console.error('Delete discount error:', e);
    return res.status(500).json({ success: false, message: 'Failed to delete discount' });
  }
});

// POST /discounts/classify -> classify memo against discounts
router.post('/classify', async (req, res) => {
  try {
    const { memo } = req.body || {};
    if (!memo) return res.status(400).json({ success: false, message: 'Memo text is required' });
    const rows = await readSheet('discounts');
    const memoLower = String(memo).toLowerCase();

    // Prioritize exact, then contains, then regex
    const order = ['exact', 'contains', 'regex'];
    let match = null;
    for (const type of order) {
      for (const r of rows) {
        const codeLower = String(r.discount_code || '').toLowerCase();
        const mt = String(r.match_type || 'exact').toLowerCase();
        if (mt !== type) continue;
        if (mt === 'exact' && memoLower === codeLower) { match = { r, confidence: 1.0 }; break; }
        if (mt === 'contains' && memoLower.includes(codeLower)) { match = { r, confidence: 0.8 }; break; }
        if (mt === 'regex') {
          try {
            const reg = new RegExp(r.discount_code, 'i');
            if (reg.test(memo)) { match = { r, confidence: 0.9 }; break; }
          } catch {}
        }
      }
      if (match) break;
    }

    if (!match) return res.json({ success: true, data: null });
    const mapped = {
      discount: {
        id: match.r.id,
        discount_code: match.r.discount_code,
        name: match.r.name,
        applicable_percentage: parseFloat(match.r.applicable_percentage || '0') || 0,
        coach_payment_type: String(match.r.coach_payment_type || 'partial').toLowerCase(),
        match_type: String(match.r.match_type || 'exact').toLowerCase(),
        active: String(match.r.active).toUpperCase() === 'TRUE',
        notes: match.r.notes || '',
      },
      confidence: match.confidence,
    };
    return res.json({ success: true, data: mapped });
  } catch (e) {
    console.error('Classify discount error:', e);
    return res.status(500).json({ success: false, message: 'Failed to classify discount' });
  }
});

// POST /discounts/initialize -> create sheet with defaults when empty
router.post('/initialize', async (req, res) => {
  try {
    const rows = await readSheet('discounts');
    if (rows && rows.length > 0) {
      return res.json({ success: true, message: 'Discounts sheet already exists', data: rows });
    }
    const defaults = [
      { id: '1', discount_code: 'MindBody Switch', name: 'MindBody Switch', applicable_percentage: 0, coach_payment_type: 'full', match_type: 'exact', active: 'TRUE', notes: '' },
      { id: '2', discount_code: 'Freedom Pass', name: 'Freedom Pass', applicable_percentage: 0, coach_payment_type: 'full', match_type: 'exact', active: 'TRUE', notes: '' },
    ];
    await writeSheet('discounts', defaults);
    return res.json({ success: true, data: defaults, message: 'Discounts sheet initialized with defaults' });
  } catch (e) {
    console.error('Initialize discounts error:', e);
    return res.status(500).json({ success: false, message: 'Failed to initialize discounts sheet' });
  }
});

module.exports = router;


