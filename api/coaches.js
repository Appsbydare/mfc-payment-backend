const express = require('express');
const { google } = require('googleapis');
const router = express.Router();

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

// Get coaches data from Google Sheets
async function getCoachesData() {
  try {
    const auth = getGoogleSheetsAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'coaches!A:Z',
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      return [];
    }

    const headers = rows[0];
    const data = rows.slice(1).map((row, index) => {
      const obj = { id: index + 1 }; // Add ID for frontend use
      headers.forEach((header, headerIndex) => {
        obj[header] = row[headerIndex] || '';
      });
      return obj;
    });

    return data;
  } catch (error) {
    console.error('Error fetching coaches data:', error);
    throw new Error('Failed to fetch coaches data from Google Sheets');
  }
}

// Update coaches data in Google Sheets
async function updateCoachesData(coaches) {
  try {
    const auth = getGoogleSheetsAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

    // Prepare headers and data
    const headers = ['Instructors', 'Email', 'Hourly Rate', 'Status'];
    const values = [
      headers,
      ...coaches.map(coach => [
        coach.Instructors || coach.name || '',
        coach.Email || coach.email || '',
        coach['Hourly Rate'] || coach.rate || '',
        coach.Status || (coach.active ? 'Active' : 'Inactive') || 'Active'
      ])
    ];

    // Clear existing data
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: 'coaches!A:Z',
    });

    // Write new data
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'coaches!A1',
      valueInputOption: 'RAW',
      resource: { values },
    });

    return true;
  } catch (error) {
    console.error('Error updating coaches data:', error);
    throw new Error('Failed to update coaches data in Google Sheets');
  }
}

// GET /api/coaches - Get all coaches
router.get('/', async (req, res) => {
  try {
    const coaches = await getCoachesData();
    res.json({
      success: true,
      data: coaches,
      count: coaches.length
    });
  } catch (error) {
    console.error('Error in GET /coaches:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch coaches'
    });
  }
});

// POST /api/coaches - Create a new coach
router.post('/', async (req, res) => {
  try {
    const { name, email, rate, active = true } = req.body;

    if (!name || !email || !rate) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and rate are required'
      });
    }

    // Get existing coaches
    const existingCoaches = await getCoachesData();
    
    // Add new coach
    const newCoach = {
      Instructors: name,
      Email: email,
      'Hourly Rate': rate,
      Status: active ? 'Active' : 'Inactive'
    };

    const updatedCoaches = [...existingCoaches, newCoach];
    
    // Update Google Sheets
    await updateCoachesData(updatedCoaches);

    res.json({
      success: true,
      data: newCoach,
      message: 'Coach created successfully'
    });
  } catch (error) {
    console.error('Error in POST /coaches:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create coach'
    });
  }
});

// PUT /api/coaches/:id - Update a coach
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, rate, active = true } = req.body;

    if (!name || !email || !rate) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and rate are required'
      });
    }

    // Get existing coaches
    const existingCoaches = await getCoachesData();
    const coachIndex = parseInt(id) - 1; // Convert to 0-based index

    if (coachIndex < 0 || coachIndex >= existingCoaches.length) {
      return res.status(404).json({
        success: false,
        message: 'Coach not found'
      });
    }

    // Update coach
    const updatedCoach = {
      Instructors: name,
      Email: email,
      'Hourly Rate': rate,
      Status: active ? 'Active' : 'Inactive'
    };

    existingCoaches[coachIndex] = updatedCoach;
    
    // Update Google Sheets
    await updateCoachesData(existingCoaches);

    res.json({
      success: true,
      data: updatedCoach,
      message: 'Coach updated successfully'
    });
  } catch (error) {
    console.error('Error in PUT /coaches/:id:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update coach'
    });
  }
});

// DELETE /api/coaches/:id - Delete a coach
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Get existing coaches
    const existingCoaches = await getCoachesData();
    const coachIndex = parseInt(id) - 1; // Convert to 0-based index

    if (coachIndex < 0 || coachIndex >= existingCoaches.length) {
      return res.status(404).json({
        success: false,
        message: 'Coach not found'
      });
    }

    // Remove coach
    const deletedCoach = existingCoaches.splice(coachIndex, 1)[0];
    
    // Update Google Sheets
    await updateCoachesData(existingCoaches);

    res.json({
      success: true,
      data: deletedCoach,
      message: 'Coach deleted successfully'
    });
  } catch (error) {
    console.error('Error in DELETE /coaches/:id:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete coach'
    });
  }
});

module.exports = router;
