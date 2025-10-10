"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const attendanceVerificationService_1 = require("../services/attendanceVerificationService");
const invoiceVerificationService_1 = require("../services/invoiceVerificationService");
const googleSheets_1 = require("../services/googleSheets");
const router = express_1.default.Router();
router.get('/master', async (req, res) => {
    try {
        const { fromDate, toDate } = req.query;
        const masterData = await attendanceVerificationService_1.attendanceVerificationService.loadExistingDataOnly();
        let filteredData = masterData;
        if (fromDate || toDate) {
            filteredData = masterData.filter(row => {
                const rowDate = new Date(row.eventStartsAt);
                if (fromDate && rowDate < new Date(fromDate))
                    return false;
                if (toDate && rowDate > new Date(toDate))
                    return false;
                return true;
            });
        }
        const summary = {
            totalRecords: filteredData.length,
            verifiedRecords: filteredData.filter(r => r.verificationStatus === 'Verified').length,
            unverifiedRecords: filteredData.filter(r => r.verificationStatus !== 'Verified').length,
            verificationRate: filteredData.length > 0 ?
                (filteredData.filter(r => r.verificationStatus === 'Verified').length / filteredData.length) * 100 : 0,
            newRecordsAdded: 0
        };
        res.json({
            success: true,
            data: filteredData,
            summary: summary
        });
    }
    catch (error) {
        console.error('Error loading master verification data:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to load verification data'
        });
    }
});
router.post('/batch-verify', async (req, res) => {
    try {
        const { fromDate, toDate, forceReverify = true, clearExisting = false } = req.body;
        console.log('🔄 Starting batch verification process...');
        try {
            const existingMaster = await attendanceVerificationService_1.attendanceVerificationService.loadExistingMasterData();
            const { attendance, payments } = await attendanceVerificationService_1.attendanceVerificationService['loadAllData']();
            const existingKeys = new Set((existingMaster || []).map(r => r.uniqueKey));
            const newAttendanceCount = (attendance || []).filter((att) => {
                const uniqueKey = attendanceVerificationService_1.attendanceVerificationService['generateUniqueKey'](att);
                return uniqueKey && !existingKeys.has(uniqueKey);
            }).length;
            const existingInvoices = new Set((await invoiceVerificationService_1.invoiceVerificationService.loadInvoiceVerificationData()).map(inv => inv.invoiceNumber));
            const newInvoiceCount = (payments || []).filter((p) => {
                const inv = String(p.Invoice || '').trim();
                return inv && !existingInvoices.has(inv);
            }).length;
            console.log(`📊 New attendance: ${newAttendanceCount}, new payments: ${newInvoiceCount}`);
            if (!forceReverify && newAttendanceCount === 0 && newInvoiceCount === 0) {
                return res.json({
                    success: true,
                    message: 'No new attendance or payments found. Skipping verification.',
                    data: existingMaster,
                    summary: {
                        totalRecords: existingMaster.length,
                        verifiedRecords: existingMaster.filter(r => r.verificationStatus === 'Verified').length,
                        unverifiedRecords: existingMaster.filter(r => r.verificationStatus !== 'Verified').length,
                        verificationRate: existingMaster.length > 0 ?
                            (existingMaster.filter(r => r.verificationStatus === 'Verified').length / existingMaster.length) * 100 : 0,
                        newRecordsAdded: 0
                    }
                });
            }
        }
        catch (gateErr) {
            console.warn('⚠️ Batch-verify gating check failed; proceeding anyway:', gateErr?.message);
        }
        const result = await attendanceVerificationService_1.attendanceVerificationService.batchVerificationProcess({
            fromDate,
            toDate,
            forceReverify,
            clearExisting
        });
        res.json({
            success: true,
            message: `Batch verification complete. ${result.summary.newRecordsAdded || 0} new records processed.`,
            data: result.masterRows,
            summary: result.summary
        });
    }
    catch (error) {
        console.error('Error during batch verification:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Batch verification failed'
        });
    }
});
router.post('/verify', async (req, res) => {
    try {
        const { fromDate, toDate, forceReverify = true, clearExisting = false } = req.body;
        console.log('🔄 Starting verification process...');
        const existingMaster = await attendanceVerificationService_1.attendanceVerificationService.loadExistingMasterData();
        const { attendance, payments } = await attendanceVerificationService_1.attendanceVerificationService['loadAllData']();
        const filteredAttendance = attendanceVerificationService_1.attendanceVerificationService['filterAttendanceByDate'](attendance, fromDate, toDate);
        const filteredPayments = attendanceVerificationService_1.attendanceVerificationService['filterPaymentsByDate'](payments, fromDate, toDate);
        const existingKeys = new Set(existingMaster.map(row => row.uniqueKey));
        const newAttendanceCount = filteredAttendance.filter(att => {
            const uniqueKey = attendanceVerificationService_1.attendanceVerificationService['generateUniqueKey'](att);
            return !existingKeys.has(uniqueKey);
        }).length;
        if (newAttendanceCount === 0 && !forceReverify) {
            return res.json({
                success: true,
                message: 'Uploaded Data already verified!',
                data: existingMaster,
                summary: {
                    totalRecords: existingMaster.length,
                    verifiedRecords: existingMaster.filter(r => r.verificationStatus === 'Verified').length,
                    unverifiedRecords: existingMaster.filter(r => r.verificationStatus === 'Not Verified').length,
                    verificationRate: existingMaster.length > 0 ?
                        (existingMaster.filter(r => r.verificationStatus === 'Verified').length / existingMaster.length) * 100 : 0,
                    newRecordsAdded: 0
                }
            });
        }
        const result = await attendanceVerificationService_1.attendanceVerificationService.verifyAttendanceData({
            fromDate,
            toDate,
            forceReverify,
            clearExisting
        });
        console.log(`✅ Verification complete: ${result.summary.newRecordsAdded || 0} new records added`);
        res.json({
            success: true,
            message: `Verification complete. ${result.summary.newRecordsAdded || 0} new records processed.`,
            data: result.masterRows,
            summary: result.summary
        });
    }
    catch (error) {
        console.error('Error during verification:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Verification failed'
        });
    }
});
router.post('/add-discounts', async (req, res) => {
    try {
        console.log('🔍 Starting Add Discounts process...');
        const masterData = await attendanceVerificationService_1.attendanceVerificationService.loadExistingMasterData();
        if (masterData.length === 0) {
            return res.json({
                success: false,
                message: 'No verified data found. Please run verification first.'
            });
        }
        const { payments, discounts } = await attendanceVerificationService_1.attendanceVerificationService['loadAllData']();
        const updatedMasterData = await attendanceVerificationService_1.attendanceVerificationService['applyDiscountsToMasterData'](masterData, discounts, payments);
        await attendanceVerificationService_1.attendanceVerificationService.saveMasterData(updatedMasterData);
        const discountAppliedCount = updatedMasterData.filter(r => r.discount && r.discountPercentage > 0).length;
        console.log(`✅ Add Discounts complete: ${discountAppliedCount} records updated with discounts`);
        res.json({
            success: true,
            message: `Discounts added to ${discountAppliedCount} records`,
            data: updatedMasterData,
            summary: {
                totalRecords: updatedMasterData.length,
                discountAppliedCount: discountAppliedCount
            }
        });
    }
    catch (error) {
        console.error('Error adding discounts:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to add discounts'
        });
    }
});
router.post('/recalculate-discounts', async (req, res) => {
    try {
        console.log('💰 Starting Recalculate Discounts process...');
        const masterData = await attendanceVerificationService_1.attendanceVerificationService.loadExistingMasterData();
        if (masterData.length === 0) {
            return res.json({
                success: false,
                message: 'No verified data found. Please run verification first.'
            });
        }
        const updatedMasterData = await attendanceVerificationService_1.attendanceVerificationService['recalculateDiscountedAmounts'](masterData);
        await attendanceVerificationService_1.attendanceVerificationService.saveMasterData(updatedMasterData);
        const recalculatedCount = updatedMasterData.filter(r => r.discount && r.discountPercentage > 0).length;
        console.log(`✅ Recalculate Discounts complete: ${recalculatedCount} records recalculated`);
        res.json({
            success: true,
            message: `Amounts recalculated for ${recalculatedCount} discounted records`,
            data: updatedMasterData,
            summary: {
                totalRecords: updatedMasterData.length,
                recalculatedCount: recalculatedCount
            }
        });
    }
    catch (error) {
        console.error('Error recalculating discounts:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to recalculate discounts'
        });
    }
});
router.get('/summary', async (req, res) => {
    try {
        const { fromDate, toDate } = req.query;
        const masterData = await attendanceVerificationService_1.attendanceVerificationService.loadExistingMasterData();
        let filteredData = masterData;
        if (fromDate || toDate) {
            filteredData = masterData.filter(row => {
                const rowDate = new Date(row.eventStartsAt);
                if (fromDate && rowDate < new Date(fromDate))
                    return false;
                if (toDate && rowDate > new Date(toDate))
                    return false;
                return true;
            });
        }
        const summary = {
            totalRecords: filteredData.length,
            verifiedRecords: filteredData.filter(r => r.verificationStatus === 'Verified').length,
            unverifiedRecords: filteredData.filter(r => r.verificationStatus === 'Not Verified').length,
            verificationRate: filteredData.length > 0 ?
                (filteredData.filter(r => r.verificationStatus === 'Verified').length / filteredData.length) * 100 : 0,
            totalAmount: filteredData.reduce((sum, r) => sum + r.amount, 0),
            totalSessionPrice: filteredData.reduce((sum, r) => sum + r.sessionPrice, 0),
            totalCoachAmount: filteredData.reduce((sum, r) => sum + r.coachAmount, 0),
            totalBgmAmount: filteredData.reduce((sum, r) => sum + r.bgmAmount, 0),
            totalManagementAmount: filteredData.reduce((sum, r) => sum + r.managementAmount, 0),
            totalMfcAmount: filteredData.reduce((sum, r) => sum + r.mfcAmount, 0)
        };
        res.json({
            success: true,
            data: summary
        });
    }
    catch (error) {
        console.error('Error loading verification summary:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to load verification summary'
        });
    }
});
router.post('/manual-verify', async (req, res) => {
    try {
        const { uniqueKey, invoiceNumber, customerName } = req.body;
        if (!uniqueKey || !invoiceNumber) {
            return res.status(400).json({
                success: false,
                error: 'Unique key and invoice number are required'
            });
        }
        const masterData = await attendanceVerificationService_1.attendanceVerificationService.loadExistingMasterData();
        const updatedData = masterData.map(row => {
            if (row.uniqueKey === uniqueKey) {
                return {
                    ...row,
                    verificationStatus: 'Verified',
                    invoiceNumber,
                    updatedAt: new Date().toISOString()
                };
            }
            return row;
        });
        await attendanceVerificationService_1.attendanceVerificationService['saveMasterData'](updatedData);
        res.json({
            success: true,
            message: 'Record manually verified successfully'
        });
    }
    catch (error) {
        console.error('Error in manual verification:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Manual verification failed'
        });
    }
});
router.get('/unverified', async (req, res) => {
    try {
        const { fromDate, toDate } = req.query;
        const masterData = await attendanceVerificationService_1.attendanceVerificationService.loadExistingMasterData();
        let unverifiedData = masterData.filter(row => row.verificationStatus === 'Not Verified');
        if (fromDate || toDate) {
            unverifiedData = unverifiedData.filter(row => {
                const rowDate = new Date(row.eventStartsAt);
                if (fromDate && rowDate < new Date(fromDate))
                    return false;
                if (toDate && rowDate > new Date(toDate))
                    return false;
                return true;
            });
        }
        res.json({
            success: true,
            data: unverifiedData,
            count: unverifiedData.length
        });
    }
    catch (error) {
        console.error('Error loading unverified records:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to load unverified records'
        });
    }
});
router.get('/export', async (req, res) => {
    try {
        const { fromDate, toDate, format = 'csv' } = req.query;
        const masterData = await attendanceVerificationService_1.attendanceVerificationService.loadExistingMasterData();
        let filteredData = masterData;
        if (fromDate || toDate) {
            filteredData = masterData.filter(row => {
                const rowDate = new Date(row.eventStartsAt);
                if (fromDate && rowDate < new Date(fromDate))
                    return false;
                if (toDate && rowDate > new Date(toDate))
                    return false;
                return true;
            });
        }
        if (format === 'csv') {
            const headers = [
                'Customer Name', 'Event Starts At', 'Membership Name', 'Class Type', 'Instructors', 'Status',
                'Discount', 'Discount %', 'Verification Status', 'Invoice #', 'Amount',
                'Payment Date', 'Session Price', 'Coach Amount', 'BGM Amount', 'Management Amount', 'MFC Amount'
            ];
            const csvContent = [
                headers.join(','),
                ...filteredData.map(row => [
                    `"${row.customerName}"`,
                    `"${row.eventStartsAt}"`,
                    `"${row.membershipName}"`,
                    `"${row.classType || ''}"`,
                    `"${row.instructors}"`,
                    `"${row.status}"`,
                    `"${row.discount}"`,
                    row.discountPercentage,
                    `"${row.verificationStatus}"`,
                    `"${row.invoiceNumber}"`,
                    row.amount,
                    `"${row.paymentDate}"`,
                    row.sessionPrice,
                    row.coachAmount,
                    row.bgmAmount,
                    row.managementAmount,
                    row.mfcAmount
                ].join(','))
            ].join('\n');
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="attendance_verification_${new Date().toISOString().split('T')[0]}.csv"`);
            res.send(csvContent);
        }
        else {
            res.json({
                success: true,
                data: filteredData
            });
        }
    }
    catch (error) {
        console.error('Error exporting verification data:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Export failed'
        });
    }
});
router.post('/rewrite', async (req, res) => {
    try {
        const { fromDate, toDate } = req.body || {};
        const result = await attendanceVerificationService_1.attendanceVerificationService.verifyAttendanceData({ fromDate, toDate, forceReverify: true });
        return res.json({ success: true, message: 'Master sheet rewritten successfully', summary: result.summary });
    }
    catch (error) {
        console.error('Error rewriting master sheet:', error);
        res.status(500).json({ success: false, error: error.message || 'Rewrite failed' });
    }
});
router.get('/health', async (req, res) => {
    try {
        const isGoogleSheetsHealthy = await googleSheets_1.googleSheetsService.healthCheck();
        res.json({
            success: true,
            data: {
                googleSheets: isGoogleSheetsHealthy,
                service: 'operational',
                timestamp: new Date().toISOString()
            }
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: error.message || 'Health check failed'
        });
    }
});
router.delete('/master', async (req, res) => {
    try {
        await attendanceVerificationService_1.attendanceVerificationService.clearMasterData();
        res.json({
            success: true,
            message: 'Master verification data cleared successfully'
        });
    }
    catch (error) {
        console.error('Error clearing master verification data:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to clear verification data'
        });
    }
});
router.get('/test-rewrite', async (req, res) => {
    res.json({
        success: true,
        message: 'Rewrite master route is accessible',
        timestamp: new Date().toISOString()
    });
});
router.post('/rewrite-master', async (req, res) => {
    try {
        console.log('🔄 Starting rewrite master process using same logic as verify payment...');
        const { googleSheetsService } = await Promise.resolve().then(() => __importStar(require('../services/googleSheets')));
        const sheetData = await googleSheetsService.readSheet('payment_calc_detail');
        if (!sheetData || sheetData.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No data found in payment_calc_detail sheet. Please run verification first.'
            });
        }
        console.log(`📊 Found ${sheetData.length} rows in payment_calc_detail sheet`);
        const dataObjects = sheetData.map((row) => ({
            'Customer Name': row['Customer Name'] || row['customerName'] || '',
            'Event Starts At': row['Event Starts At'] || row['eventStartsAt'] || row['Event Starts'] || '',
            'Membership Name': row['Membership Name'] || row['membershipName'] || '',
            'Class Type': row['Class Type'] || row['classType'] || row['ClassType'] || '',
            'Instructors': row['Instructors'] || row['instructors'] || '',
            'Status': row['Status'] || row['status'] || '',
            'Discount': row['Discount'] || row['discount'] || '',
            'Discount %': row['Discount %'] || row['discountPercentage'] || 0,
            'Verification Status': row['Verification Status'] || row['verificationStatus'] || '',
            'Invoice #': row['Invoice #'] || row['invoiceNumber'] || '',
            'Amount': row['Amount'] || row['amount'] || 0,
            'Payment Date': row['Payment Date'] || row['paymentDate'] || '',
            'Package Price': row['Package Price'] || row['packagePrice'] || 0,
            'Session Price': row['Session Price'] || row['sessionPrice'] || 0,
            'Discounted Session Price': row['Discounted Session Price'] || row['discountedSessionPrice'] || 0,
            'Coach Amount': row['Coach Amount'] || row['coachAmount'] || 0,
            'BGM Amount': row['BGM Amount'] || row['bgmAmount'] || 0,
            'Management Amount': row['Management Amount'] || row['managementAmount'] || 0,
            'MFC Amount': row['MFC Amount'] || row['mfcAmount'] || 0,
            'UniqueKey': row['UniqueKey'] || row['uniqueKey'] || '',
            'CreatedAt': row['CreatedAt'] || row['createdAt'] || new Date().toISOString(),
            'UpdatedAt': row['UpdatedAt'] || row['updatedAt'] || new Date().toISOString()
        }));
        await googleSheetsService.writeSheet('payment_calc_detail', dataObjects);
        console.log('✅ Master sheet rewritten successfully using same logic as verify payment');
        res.json({
            success: true,
            message: `Master sheet rewritten successfully with ${dataObjects.length} records`,
            recordCount: dataObjects.length
        });
    }
    catch (error) {
        console.error('❌ Error in rewrite master:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to rewrite master sheet'
        });
    }
});
router.post('/upsert-master', async (req, res) => {
    try {
        const { rows } = req.body || {};
        if (!Array.isArray(rows) || rows.length === 0) {
            return res.status(400).json({ success: false, error: 'No rows provided' });
        }
        const existing = await googleSheets_1.googleSheetsService.readSheet('payment_calc_detail');
        const now = new Date().toISOString();
        const byKey = new Map();
        for (const r of existing) {
            const key = String(r['UniqueKey'] || r['uniqueKey'] || '').trim();
            if (key)
                byKey.set(key, { ...r });
        }
        const toSheetObject = (r) => ({
            'Customer Name': r.customerName ?? r['Customer Name'] ?? '',
            'Event Starts At': r.eventStartsAt ?? r['Event Starts At'] ?? '',
            'Membership Name': r.membershipName ?? r['Membership Name'] ?? '',
            'Class Type': r.classType ?? r['Class Type'] ?? '',
            'Instructors': r.instructors ?? r['Instructors'] ?? '',
            'Status': r.status ?? r['Status'] ?? '',
            'Discount': r.discount ?? r['Discount'] ?? '',
            'Discount %': r.discountPercentage ?? r['Discount %'] ?? 0,
            'Verification Status': (r.verificationStatus ?? r['Verification Status'] ?? ''),
            'Invoice #': r.invoiceNumber ?? r['Invoice #'] ?? '',
            'Amount': r.amount ?? r['Amount'] ?? 0,
            'Payment Date': r.paymentDate ?? r['Payment Date'] ?? '',
            'Package Price': r.packagePrice ?? r['Package Price'] ?? 0,
            'Session Price': r.sessionPrice ?? r['Session Price'] ?? 0,
            'Discounted Session Price': r.discountedSessionPrice ?? r['Discounted Session Price'] ?? 0,
            'Coach Amount': r.coachAmount ?? r['Coach Amount'] ?? 0,
            'BGM Amount': r.bgmAmount ?? r['BGM Amount'] ?? 0,
            'Management Amount': r.managementAmount ?? r['Management Amount'] ?? 0,
            'MFC Amount': r.mfcAmount ?? r['MFC Amount'] ?? 0,
            'UniqueKey': r.uniqueKey ?? r['UniqueKey'] ?? '',
            'Change History': r.changeHistory ?? r['Change History'] ?? '',
            'CreatedAt': r.createdAt ?? r['CreatedAt'] ?? now,
            'UpdatedAt': now
        });
        for (const r of rows) {
            const key = String(r.uniqueKey || r['UniqueKey'] || '').trim();
            const incoming = toSheetObject(r);
            if (!key)
                continue;
            if (byKey.has(key)) {
                const prev = byKey.get(key);
                byKey.set(key, { ...prev, ...incoming, 'CreatedAt': prev['CreatedAt'] || incoming['CreatedAt'], 'UpdatedAt': now });
            }
            else {
                byKey.set(key, incoming);
            }
        }
        const unchangedNoKey = existing.filter(r => !(String(r['UniqueKey'] || '').trim())).map(r => ({ ...r }));
        const merged = [...Array.from(byKey.values()), ...unchangedNoKey];
        await googleSheets_1.googleSheetsService.writeSheet('payment_calc_detail', merged);
        return res.json({ success: true, message: `Upserted ${rows.length} row(s)`, recordCount: merged.length });
    }
    catch (error) {
        console.error('❌ Error in upsert-master:', error);
        res.status(500).json({ success: false, error: error.message || 'Failed to upsert master rows' });
    }
});
router.get('/invoices', async (req, res) => {
    try {
        const invoices = await invoiceVerificationService_1.invoiceVerificationService.loadInvoiceVerificationData();
        res.json({
            success: true,
            data: invoices
        });
    }
    catch (error) {
        console.error('Error loading invoice verification data:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to load invoice verification data'
        });
    }
});
router.post('/invoices/initialize', async (req, res) => {
    try {
        const invoices = await invoiceVerificationService_1.invoiceVerificationService.initializeInvoiceVerification();
        await invoiceVerificationService_1.invoiceVerificationService.saveInvoiceVerificationData(invoices);
        res.json({
            success: true,
            message: 'Invoice verification data initialized successfully',
            data: invoices
        });
    }
    catch (error) {
        console.error('Error initializing invoice verification data:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to initialize invoice verification data'
        });
    }
});
router.delete('/invoices', async (req, res) => {
    try {
        await invoiceVerificationService_1.invoiceVerificationService.saveInvoiceVerificationData([]);
        res.json({
            success: true,
            message: 'Invoice verification data cleared successfully'
        });
    }
    catch (error) {
        console.error('Error clearing invoice verification data:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to clear invoice verification data'
        });
    }
});
exports.default = router;
//# sourceMappingURL=attendanceVerification.js.map