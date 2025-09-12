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

module.exports = router;


