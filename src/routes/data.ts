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
      attendance: { processed: 0, added: 0, errors: [] as string[] },
      payments: { processed: 0, added: 0, errors: [] as string[] }
    };

    // Process attendance data
    if (files.attendanceFile && files.attendanceFile[0]) {
      try {
        const csvContent = files.attendanceFile[0].buffer.toString();
        const parsedData = Papa.parse(csvContent, { header: true, skipEmptyLines: true });
        
        if (parsedData.data && parsedData.data.length > 0) {
          // Debug: Log the first row to see the structure
          console.log('First row from CSV:', parsedData.data[0]);
          console.log('CSV headers:', Object.keys(parsedData.data[0] as any));
          console.log('Customer Name value from CSV:', (parsedData.data[0] as any)['Customer Name']);
          
          // Transform attendance data to match expected Google Sheets format
          const importTimestamp = new Date().toISOString();
          const transformedData = parsedData.data.map((row: any, index: number) => {
            const transformed = {
              'Customer': row['Customer Name'] || '',
              'Email': row['Customer Email'] || '',
              'Date': row['Event Starts At'] ? new Date(row['Event Starts At']).toISOString().split('T')[0] : '',
              'Time': row['Event Starts At'] ? new Date(row['Event Starts At']).toTimeString().split(' ')[0] : '',
              'ClassType': row['Offering Type Name'] || '',
              'Venue': row['Venue Name'] || '',
              'Instructors': row['Instructors'] || '',
              'BookingMethod': row['Booking Method'] || '',
              'Membership': row['Membership Name'] || '',
              'BookingSource': row['Booking Source'] || '',
              'Status': row['Status'] || '',
              'CheckinTimestamp': row['Checkin Timestamp'] || '',
              'ImportTimestamp': importTimestamp,
              'VerificationStatus': 'Pending', // Default status
              'Category': 'Pending', // Default category
              'InvoiceNumber': '', // Will be filled during verification
              'ManualVerificationDate': '', // Will be filled if manually verified
              'LinkedPaymentIds': '' // Will store comma-separated payment IDs
            };
            
            // Debug: Log the first transformed row
            if (index === 0) {
              console.log('First transformed row:', transformed);
              console.log('Customer value:', transformed['Customer']);
              console.log('Customer length:', transformed['Customer'].length);
            }
            
            return transformed;
          });

          // Debug: Log the headers that will be written
          console.log('Headers to write:', Object.keys(transformedData[0]));
          console.log('First transformed row values:', Object.values(transformedData[0]));
          console.log('First transformed row object:', transformedData[0]);
          console.log('Customer field value:', transformedData[0]['Customer']);
          console.log('Customer field type:', typeof transformedData[0]['Customer']);

          // Clear the sheet first, then write new data
          await googleSheetsService.clearSheet('attendance');
          await googleSheetsService.writeSheet('attendance', transformedData);
          
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
          // Transform payment data to match expected Google Sheets format
          const importTimestamp = new Date().toISOString();
          const transformedData = parsedData.data.map((row: any) => ({
            'Date': row['Date'] || '',
            'Customer': row['Customer'] || '',
            'Memo': row['Memo'] || '',
            'Amount': parseFloat(row['Amount']) || 0,
            'Invoice': row['Invoice'] || '',
            'ImportTimestamp': importTimestamp,
            'VerificationStatus': 'Unverified', // Default status
            'Category': 'Payment', // Default category (can be Discount, Tax, etc.)
            'LinkedAttendanceIds': '', // Will store comma-separated attendance IDs
            'IsVerified': false // Boolean flag for quick filtering
          }));
          
          // Clear the sheet first, then write new data
          await googleSheetsService.clearSheet('Payments');
          await googleSheetsService.writeSheet('Payments', transformedData);
          
          results.payments.processed = transformedData.length;
          results.payments.added = transformedData.length;
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
        attendance: { processed: 0, added: 0, errors: [error instanceof Error ? error.message : 'Unknown error'] },
        payments: { processed: 0, added: 0, errors: [error instanceof Error ? error.message : 'Unknown error'] }
      }
    });
  }
});

// @desc    Get attendance data from Google Sheets
// @route   GET /api/data/attendance
// @access  Private
router.get('/attendance', async (req, res) => {
  try {
    const data = await googleSheetsService.readSheet('attendance');
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