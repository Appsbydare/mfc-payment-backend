"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const googleSheets_1 = require("../services/googleSheets");
const papaparse_1 = __importDefault(require("papaparse"));
const router = (0, express_1.Router)();
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage() });
const googleSheetsService = new googleSheets_1.GoogleSheetsService();
router.post('/import', upload.fields([
    { name: 'attendanceFile', maxCount: 1 },
    { name: 'paymentFile', maxCount: 1 }
]), async (req, res) => {
    try {
        const files = req.files;
        const results = {
            attendance: { processed: 0, added: 0, errors: [] },
            payments: { processed: 0, added: 0, errors: [] }
        };
        if (files.attendanceFile && files.attendanceFile[0]) {
            try {
                const csvContent = files.attendanceFile[0].buffer.toString();
                const parsedData = papaparse_1.default.parse(csvContent, { header: true, skipEmptyLines: true });
                if (parsedData.data && parsedData.data.length > 0) {
                    console.log('First row from CSV:', parsedData.data[0]);
                    console.log('CSV headers:', Object.keys(parsedData.data[0]));
                    console.log('Customer Name value from CSV:', parsedData.data[0]['Customer Name']);
                    const importTimestamp = new Date().toISOString();
                    const transformedData = parsedData.data.map((row, index) => {
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
                            'VerificationStatus': 'Pending',
                            'Category': 'Pending',
                            'InvoiceNumber': '',
                            'ManualVerificationDate': '',
                            'LinkedPaymentIds': ''
                        };
                        if (index === 0) {
                            console.log('First transformed row:', transformed);
                            console.log('Customer value:', transformed['Customer']);
                            console.log('Customer length:', transformed['Customer'].length);
                        }
                        return transformed;
                    });
                    console.log('Headers to write:', Object.keys(transformedData[0]));
                    console.log('First transformed row values:', Object.values(transformedData[0]));
                    console.log('First transformed row object:', transformedData[0]);
                    console.log('Customer field value:', transformedData[0]['Customer']);
                    console.log('Customer field type:', typeof transformedData[0]['Customer']);
                    await googleSheetsService.clearSheet('attendance');
                    await googleSheetsService.writeSheet('attendance', transformedData);
                    results.attendance.processed = transformedData.length;
                    results.attendance.added = transformedData.length;
                }
            }
            catch (error) {
                console.error('Error processing attendance file:', error);
                results.attendance.errors.push(`Failed to process attendance file: ${error}`);
            }
        }
        if (files.paymentFile && files.paymentFile[0]) {
            try {
                const csvContent = files.paymentFile[0].buffer.toString();
                const parsedData = papaparse_1.default.parse(csvContent, { header: true, skipEmptyLines: true });
                if (parsedData.data && parsedData.data.length > 0) {
                    const importTimestamp = new Date().toISOString();
                    const transformedData = parsedData.data.map((row) => ({
                        'Date': row['Date'] || '',
                        'Customer': row['Customer'] || '',
                        'Memo': row['Memo'] || '',
                        'Amount': parseFloat(row['Amount']) || 0,
                        'Invoice': row['Invoice'] || '',
                        'ImportTimestamp': importTimestamp,
                        'VerificationStatus': 'Unverified',
                        'Category': 'Payment',
                        'LinkedAttendanceIds': '',
                        'IsVerified': false
                    }));
                    await googleSheetsService.clearSheet('Payments');
                    await googleSheetsService.writeSheet('Payments', transformedData);
                    results.payments.processed = transformedData.length;
                    results.payments.added = transformedData.length;
                }
            }
            catch (error) {
                console.error('Error processing payment file:', error);
                results.payments.errors.push(`Failed to process payment file: ${error}`);
            }
        }
        res.json({
            success: true,
            results,
            message: 'Data import completed'
        });
    }
    catch (error) {
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
router.get('/attendance', async (req, res) => {
    try {
        const data = await googleSheetsService.readSheet('attendance');
        res.json({
            success: true,
            data,
            count: data.length,
            message: 'Attendance data retrieved successfully'
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: error instanceof Error ? error.message : 'Failed to retrieve attendance data',
            data: [],
            count: 0
        });
    }
});
router.get('/payments', async (req, res) => {
    try {
        const data = await googleSheetsService.readSheet('Payments');
        res.json({
            success: true,
            data,
            count: data.length,
            message: 'Payment data retrieved successfully'
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: error instanceof Error ? error.message : 'Failed to retrieve payment data',
            data: [],
            count: 0
        });
    }
});
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
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: error instanceof Error ? error.message : 'Failed to retrieve sheet data',
            data: [],
            count: 0
        });
    }
});
exports.default = router;
//# sourceMappingURL=data.js.map