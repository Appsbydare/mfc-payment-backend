import { Router } from 'express';
import multer from 'multer';
import { GoogleSheetsService } from '../services/googleSheets';
import Papa from 'papaparse';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });
const googleSheetsService = new GoogleSheetsService();

// @desc    Import data from CSV files to Google Sheets
// @route   POST /api/data/import
// @access  Private
router.post('/import', upload.fields([
  { name: 'attendanceFile', maxCount: 1 },
  { name: 'paymentFile', maxCount: 1 }
]), async (req, res) => {
  try {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const results = {
      attendance: { processed: 0, duplicates: 0, added: 0, errors: [] as string[] },
      payments: { processed: 0, duplicates: 0, added: 0, errors: [] as string[] }
    };

    // Process attendance data
    if (files.attendanceFile && files.attendanceFile[0]) {
      try {
        const csvContent = files.attendanceFile[0].buffer.toString();
        const parsedData = Papa.parse(csvContent, { header: true, skipEmptyLines: true });
        
        if (parsedData.data && parsedData.data.length > 0) {
          // Debug: Log the first row to see the structure
          console.log('First row from CSV:', parsedData.data[0]);
          
          // Transform attendance data to match expected format
          const transformedData = parsedData.data.map((row: any) => {
            const transformed = {
              'Customer Name': row['Customer Name'] || '',
              'Customer Email': row['Customer Email'] || '',
              'Event Starts At': row['Event Starts At'] || '',
              'Offering Type Name': row['Offering Type Name'] || '',
              'Venue Name': row['Venue Name'] || '',
              'Instructors': row['Instructors'] || '',
              'Booking Method': row['Booking Method'] || '',
              'Customer Membership ID': row['Customer Membership ID'] || '',
              'Membership ID': row['Membership ID'] || '',
              'Membership Name': row['Membership Name'] || '',
              'Booking Source': row['Booking Source'] || '',
              'Status': row['Status'] || '',
              'Checkin Timestamp': row['Checkin Timestamp'] || ''
            };
            
            // Debug: Log the first transformed row
            if (transformedData.length === 0) {
              console.log('First transformed row:', transformed);
            }
            
            return transformed;
          });

          // Debug: Log the headers that will be written
          console.log('Headers to write:', Object.keys(transformedData[0]));

          // Clear the sheet first, then write new data
          await googleSheetsService.clearSheet('Attendance');
          await googleSheetsService.writeSheet('Attendance', transformedData);
          
          results.attendance.processed = transformedData.length;
          results.attendance.added = transformedData.length;
        }
      } catch (error) {
        console.error('Error processing attendance file:', error);
        results.attendance.errors.push(`Failed to process attendance file: ${error}`);
      }
    }

    // Process payment data
    if (files.paymentFile && files.paymentFile[0]) {
      try {
        const csvContent = files.paymentFile[0].buffer.toString();
        const parsedData = Papa.parse(csvContent, { header: true, skipEmptyLines: true });
        
        if (parsedData.data && parsedData.data.length > 0) {
          // Write to Google Sheets
          await googleSheetsService.writeSheet('Payments', parsedData.data);
          
          results.payments.processed = parsedData.data.length;
          results.payments.added = parsedData.data.length;
        }
      } catch (error) {
        console.error('Error processing payment file:', error);
        results.payments.errors.push(`Failed to process payment file: ${error}`);
      }
    }

    res.json({
      success: true,
      results,
      message: 'Data import completed'
    });

  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Import failed',
      results: {
        attendance: { processed: 0, duplicates: 0, added: 0, errors: [error instanceof Error ? error.message : 'Unknown error'] },
        payments: { processed: 0, duplicates: 0, added: 0, errors: [error instanceof Error ? error.message : 'Unknown error'] }
      }
    });
  }
});

// @desc    Get attendance data from Google Sheets
// @route   GET /api/data/attendance
// @access  Private
router.get('/attendance', async (req, res) => {
  try {
    const data = await googleSheetsService.readSheet('Attendance');
    res.json({
      success: true,
      data,
      count: data.length,
      message: 'Attendance data retrieved successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to retrieve attendance data',
      data: [],
      count: 0
    });
  }
});

// @desc    Get payment data from Google Sheets
// @route   GET /api/data/payments
// @access  Private
router.get('/payments', async (req, res) => {
  try {
    const data = await googleSheetsService.readSheet('Payments');
    res.json({
      success: true,
      data,
      count: data.length,
      message: 'Payment data retrieved successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to retrieve payment data',
      data: [],
      count: 0
    });
  }
});

// @desc    Get data from specific sheet
// @route   GET /api/data/sheets
// @access  Private
router.get('/sheets', async (req, res) => {
  try {
    const { sheet } = req.query;
    if (!sheet || typeof sheet !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Sheet parameter is required',
        data: [],
        count: 0
      });
    }

    const data = await googleSheetsService.readSheet(sheet);
    res.json({
      success: true,
      data,
      count: data.length,
      message: `${sheet} data retrieved successfully`
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to retrieve sheet data',
      data: [],
      count: 0
    });
  }
});

export default router; 