const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const { google } = require('googleapis');
const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'), false);
    }
  },
});

// Initialize Google Sheets API
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

// Parse CSV data
function parseCSVData(buffer) {
  return new Promise((resolve, reject) => {
    const results = [];
    const stream = require('stream');
    const readableStream = new stream.Readable();
    readableStream.push(buffer);
    readableStream.push(null);

    readableStream
      .pipe(csv({
        mapHeaders: ({ header }) => (header || '').toString().replace(/^\uFEFF/, '').trim(),
        mapValues: ({ value }) => (typeof value === 'string' ? value.trim() : value)
      }))
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (error) => reject(error));
  });
}

// Ensure a sheet exists, create if missing
async function ensureSheetExists(sheetName) {
  const auth = getGoogleSheetsAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets?.some(s => s.properties?.title === sheetName);
  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: {
      requests: [
        { addSheet: { properties: { title: sheetName } } }
      ]
    }
  });
}

// Append duplicates to a dedicated sheet
async function appendDuplicatesToSheet(duplicates, sourceSheet) {
  if (!duplicates || duplicates.length === 0) return;

  const sheetName = 'duplicates';
  const auth = getGoogleSheetsAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

  await ensureSheetExists(sheetName);

  const headers = [...Object.keys(duplicates[0] || {}), 'SourceSheet'];
  const values = [
    headers,
    ...duplicates.map(row => headers.map(h => h === 'SourceSheet' ? sourceSheet : (row[h] || '')))
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    resource: { values }
  });
}

// Get existing data from Google Sheets
async function getExistingData(sheetName) {
  try {
    const auth = getGoogleSheetsAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:Z`,
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      return [];
    }

    const headers = rows[0];
    const data = rows.slice(1).map(row => {
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = row[index] || '';
      });
      return obj;
    });

    return data;
  } catch (error) {
    console.error('Error fetching existing data:', error);
    throw new Error('Failed to fetch existing data from Google Sheets');
  }
}

// Update Google Sheets with new data
async function updateGoogleSheets(sheetName, data) {
  try {
    const auth = getGoogleSheetsAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

    // Clear existing data
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${sheetName}!A:Z`,
    });

    // Prepare data for upload
    const headers = Object.keys(data[0]);
    const values = [headers, ...data.map(row => headers.map(header => row[header] || ''))];

    // Upload new data
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'RAW',
      resource: { values },
    });

    return true;
  } catch (error) {
    console.error('Error updating Google Sheets:', error);
    throw new Error('Failed to update Google Sheets');
  }
}

// Detect and remove duplicates
function removeDuplicates(newData, existingData, keyFields) {
  const existingKeys = new Set();
  const duplicates = [];
  const uniqueNewData = [];

  // Create keys for existing data
  existingData.forEach(row => {
    const key = keyFields.map(field => row[field]).join('|');
    existingKeys.add(key);
  });

  // Check new data for duplicates
  newData.forEach(row => {
    const key = keyFields.map(field => row[field]).join('|');
    if (existingKeys.has(key)) {
      duplicates.push(row);
    } else {
      uniqueNewData.push(row);
      existingKeys.add(key);
    }
  });

  return {
    uniqueData: uniqueNewData,
    duplicates,
  };
}

// Process attendance data
function processAttendanceData(data) {
  return data.map(row => ({
    Customer: row['Customer Name'] || '',
    Email: row['Customer Email'] || '',
    Date: row['Event Starts At'] ? new Date(row['Event Starts At']).toISOString().split('T')[0] : '',
    Time: row['Event Starts At'] ? new Date(row['Event Starts At']).toTimeString().split(' ')[0] : '',
    ClassType: row['Offering Type Name'] || '',
    Venue: row['Venue Name'] || '',
    Instructors: row['Instructors'] || '',
    BookingMethod: row['Booking Method'] || '',
    Membership: row['Membership Name'] || '',
    BookingSource: row['Booking Source'] || '',
    Status: row['Status'] || '',
    CheckinTimestamp: row['Checkin Timestamp'] || '',
  }));
}

// Process payment data
function processPaymentData(data) {
  return data.map(row => ({
    Date: row['Date'] || '',
    Customer: row['Customer'] || '',
    Memo: row['Memo'] || '',
    Amount: parseFloat(row['Amount']) || 0,
    Invoice: row['Invoice'] || '',
  }));
}

// @desc    Import data from CSV files
// @route   POST /data/import
// @access  Private
router.post('/import', upload.fields([
  { name: 'attendanceFile', maxCount: 1 },
  { name: 'paymentFile', maxCount: 1 }
]), async (req, res) => {
  try {
    const results = {
      attendance: { processed: 0, duplicates: 0, added: 0, errors: [] },
      payments: { processed: 0, duplicates: 0, added: 0, errors: [] }
    };

    // Process attendance data
    if (req.files.attendanceFile) {
      try {
        const attendanceData = await parseCSVData(req.files.attendanceFile[0].buffer);
        const processedAttendance = processAttendanceData(attendanceData);
        
        // Get existing attendance data
        const existingAttendance = await getExistingData('attendance');
        
        // Remove duplicates
        const attendanceResult = removeDuplicates(
          processedAttendance, 
          existingAttendance, 
          ['Customer', 'Email', 'Date', 'Time', 'ClassType']
        );

        // Combine existing and new unique data
        const allAttendanceData = [...existingAttendance, ...attendanceResult.uniqueData];

        // Update Google Sheets
        await updateGoogleSheets('attendance', allAttendanceData);

        // Mark verification state as dirty so UI can indicate unverified data exists
        try {
          const existingSettings = await getExistingData('settings').catch(() => []);
          const map = new Map(existingSettings.map(r => [String(r.key || r.Key).toLowerCase(), r]));
          const setVal = (k, v) => map.set(k.toLowerCase(), { key: k, value: String(v) });
          setVal('has_unverified_data', 'true');
          setVal('unverified_reason', 'attendance_import');
          await updateGoogleSheets('settings', Array.from(map.values()));
        } catch (e) {
          console.error('Failed to flag unverified state after attendance import:', e);
        }

        // Append duplicates to the duplicates sheet for later review
        await appendDuplicatesToSheet(attendanceResult.duplicates, 'attendance');

        results.attendance = {
          processed: processedAttendance.length,
          duplicates: attendanceResult.duplicates.length,
          added: attendanceResult.uniqueData.length,
          errors: []
        };
      } catch (error) {
        results.attendance.errors.push(error.message);
      }
    }

    // Process payment data
    if (req.files.paymentFile) {
      try {
        const paymentData = await parseCSVData(req.files.paymentFile[0].buffer);
        const processedPayments = processPaymentData(paymentData);
        
        // Get existing payment data
        const existingPayments = await getExistingData('payments');
        
        // Remove duplicates
        const paymentResult = removeDuplicates(
          processedPayments, 
          existingPayments, 
          ['Date', 'Customer', 'Memo', 'Amount', 'Invoice']
        );

        // Combine existing and new unique data
        const allPaymentData = [...existingPayments, ...paymentResult.uniqueData];

        // Update Google Sheets
        await updateGoogleSheets('payments', allPaymentData);

        // Mark verification state as dirty
        try {
          const existingSettings = await getExistingData('settings').catch(() => []);
          const map = new Map(existingSettings.map(r => [String(r.key || r.Key).toLowerCase(), r]));
          const setVal = (k, v) => map.set(k.toLowerCase(), { key: k, value: String(v) });
          setVal('has_unverified_data', 'true');
          setVal('unverified_reason', 'payments_import');
          await updateGoogleSheets('settings', Array.from(map.values()));
        } catch (e) {
          console.error('Failed to flag unverified state after payments import:', e);
        }

        // Append duplicates to the duplicates sheet for later review
        await appendDuplicatesToSheet(paymentResult.duplicates, 'payments');

        results.payments = {
          processed: processedPayments.length,
          duplicates: paymentResult.duplicates.length,
          added: paymentResult.uniqueData.length,
          errors: []
        };
      } catch (error) {
        results.payments.errors.push(error.message);
      }
    }

    res.json({
      success: true,
      message: 'Data import completed successfully',
      results
    });

  } catch (error) {
    console.error('Data import error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to import data',
      error: error.message
    });
  }
});

// @desc    Get data from Google Sheets
// @route   GET /data/sheets
// @access  Private
router.get('/sheets', async (req, res) => {
  try {
    const { sheet } = req.query;
    // Allow flexible sheets including 'discounts', 'rules', and others used by the app
    if (!sheet || typeof sheet !== 'string' || !sheet.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Sheet parameter is required'
      });
    }

    const data = await getExistingData(sheet);
    
    res.json({
      success: true,
      data,
      count: data.length
    });

  } catch (error) {
    console.error('Error fetching sheet data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch data from Google Sheets',
      error: error.message
    });
  }
});

// @desc    Export data
// @route   GET /data/export
// @access  Private
router.get('/export', async (req, res) => {
  try {
    const { sheet, format = 'json' } = req.query;
    
    if (!sheet || !['attendance', 'payments'].includes(sheet)) {
      return res.status(400).json({
        success: false,
        message: 'Sheet parameter is required and must be either "attendance" or "payments"'
      });
    }

    const data = await getExistingData(sheet);

    if (format === 'csv') {
      const headers = Object.keys(data[0] || {});
      const csvContent = [
        headers.join(','),
        ...data.map(row => headers.map(header => `"${row[header] || ''}"`).join(','))
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${sheet}_export.csv"`);
      res.send(csvContent);
    } else {
      res.json({
        success: true,
        data,
        count: data.length
      });
    }

  } catch (error) {
    console.error('Error exporting data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export data',
      error: error.message
    });
  }
});

// @desc    Get attendance data
// @route   GET /data/attendance
// @access  Private
router.get('/attendance', async (req, res) => {
  try {
    const data = await getExistingData('attendance');
    
    res.json({
      success: true,
      data,
      count: data.length,
      message: 'Attendance data retrieved successfully'
    });

  } catch (error) {
    console.error('Error fetching attendance data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch attendance data from Google Sheets',
      error: error.message
    });
  }
});

module.exports = router; 