"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const payslipService_1 = require("../services/payslipService");
const router = (0, express_1.Router)();
const payslipService = new payslipService_1.PayslipService();
const { generateBgmReport } = require("../services/bgmReportService");
const { generateManagementReport } = require("../services/managementReportService");
router.post('/monthly', (req, res) => {
    res.json({ message: 'Generate monthly report - TODO' });
});
router.post('/payslip', async (req, res) => {
    try {
        const { coachName, fromDate, toDate, format = 'excel' } = req.body;
        if (!coachName) {
            return res.status(400).json({
                success: false,
                error: 'Coach name is required'
            });
        }
        console.log(`📋 Generating payslip for coach: ${coachName}, format: ${format}`);
        const payslipData = await payslipService.generatePayslip({
            coachName,
            fromDate,
            toDate
        });
        if (!payslipData.success) {
            return res.status(400).json({
                success: false,
                error: payslipData.error || 'Failed to generate payslip data'
            });
        }
        if (!payslipData.data) {
            return res.status(400).json({
                success: false,
                error: 'No payslip data available'
            });
        }
        if (format === 'excel') {
            const excelBuffer = await payslipService.generateExcelPayslip(payslipData.data);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${coachName.replace(/\s+/g, '_')}_payslip_${new Date().toISOString().split('T')[0]}.xlsx"`);
            res.send(excelBuffer);
        }
        else if (format === 'pdf') {
            const pdfBuffer = await payslipService.generatePDFPayslip(payslipData.data);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${coachName.replace(/\s+/g, '_')}_payslip_${new Date().toISOString().split('T')[0]}.pdf"`);
            res.send(pdfBuffer);
        }
        else {
            return res.status(400).json({
                success: false,
                error: 'Invalid format. Supported formats: excel, pdf'
            });
        }
    }
    catch (error) {
        console.error('❌ Error generating payslip:', error);
        res.status(500).json({
            success: false,
            error: error?.message || 'Failed to generate payslip'
        });
    }
});
router.get('/history', (req, res) => {
    res.json({ message: 'Get report history - TODO' });
});
// New endpoints for BGM and Management reports
router.post('/bgm', async (req, res) => {
    try {
        const { fromDate, toDate, format = 'excel' } = req.body || {};
        const buffer = await generateBgmReport({ fromDate, toDate, format });
        if (format === 'pdf') {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="bgm_report_${new Date().toISOString().split('T')[0]}.pdf"`);
        }
        else {
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="bgm_report_${new Date().toISOString().split('T')[0]}.xlsx"`);
        }
        res.send(buffer);
    }
    catch (error) {
        res.status(500).json({ success: false, message: error?.message || 'Failed to generate BGM report' });
    }
});
router.post('/management', async (req, res) => {
    try {
        const { fromDate, toDate, format = 'excel' } = req.body || {};
        const buffer = await generateManagementReport({ fromDate, toDate, format });
        if (format === 'pdf') {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="management_report_${new Date().toISOString().split('T')[0]}.pdf"`);
        }
        else {
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="management_report_${new Date().toISOString().split('T')[0]}.xlsx"`);
        }
        res.send(buffer);
    }
    catch (error) {
        res.status(500).json({ success: false, message: error?.message || 'Failed to generate Management report' });
    }
});
exports.default = router;
//# sourceMappingURL=reports.js.map