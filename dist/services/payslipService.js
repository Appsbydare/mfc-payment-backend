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
exports.PayslipService = void 0;
const googleSheets_1 = require("./googleSheets");
const XLSX = __importStar(require("xlsx"));
const ExcelJS = __importStar(require("exceljs"));
const pdfkit_1 = __importDefault(require("pdfkit"));
class PayslipService {
    MASTER_SHEET = 'payment_calc_detail';
    async generatePayslip(params) {
        try {
            console.log(`📊 Generating payslip for coach: ${params.coachName}`);
            const paymentCalcData = await googleSheets_1.googleSheetsService.readSheet(this.MASTER_SHEET);
            if (!paymentCalcData || paymentCalcData.length === 0) {
                return {
                    success: false,
                    error: 'No payment calculation data found'
                };
            }
            let filteredData = paymentCalcData.filter((row) => {
                const rowCoach = row.Instructors || row.Instructor || row.instructors || row.instructor || row.Coach || row.coach || '';
                if (rowCoach !== params.coachName)
                    return false;
                if (params.fromDate || params.toDate) {
                    const rowDate = row['Event Starts At'] || row['eventStartsAt'] || row.Date || row.date || '';
                    if (!rowDate)
                        return false;
                    const date = new Date(rowDate);
                    if (params.fromDate && date < new Date(params.fromDate))
                        return false;
                    if (params.toDate && date > new Date(params.toDate))
                        return false;
                }
                return true;
            });
            if (filteredData.length === 0) {
                return {
                    success: false,
                    error: `No sessions found for coach "${params.coachName}" in the specified date range`
                };
            }
            const privateSessions = [];
            const groupSessions = [];
            filteredData.forEach((row) => {
                const membershipName = row['Membership Name'] || row['membershipName'] || '';
                const customerName = row['Customer Name'] || row['customerName'] || '';
                const eventDate = row['Event Starts At'] || row['eventStartsAt'] || row.Date || row.date || '';
                const sessionPrice = parseFloat(row['Session Price'] || row['sessionPrice'] || 0) || 0;
                const discountedPrice = parseFloat(row['Discounted Session Price'] || row['discountedSessionPrice'] || 0) || 0;
                const coachAmount = parseFloat(row['Coach Amount'] || row['coachAmount'] || 0) || 0;
                const sessionData = {
                    clientName: customerName,
                    date: this.formatDate(eventDate),
                    netPricePerSession: discountedPrice > 0 ? discountedPrice : sessionPrice,
                    yourPay: coachAmount
                };
                if (this.isPrivateSession(membershipName)) {
                    privateSessions.push({
                        ...sessionData,
                        sessionType: this.getSessionType(membershipName)
                    });
                }
                else {
                    groupSessions.push({
                        ...sessionData,
                        classType: this.getClassType(membershipName),
                        membershipUsed: membershipName
                    });
                }
            });
            const totalPrivateRevenue = privateSessions.reduce((sum, session) => sum + session.yourPay, 0);
            const totalGroupRevenue = groupSessions.reduce((sum, session) => sum + session.yourPay, 0);
            const totalDeductions = 0;
            const totalPay = totalPrivateRevenue + totalGroupRevenue - totalDeductions;
            const period = this.getPeriodString(params.fromDate, params.toDate, filteredData);
            const payslipData = {
                coachName: params.coachName,
                coachDesignation: 'MMA COACH',
                period,
                fromDate: params.fromDate || '',
                toDate: params.toDate || '',
                privateSessions,
                groupSessions,
                deductions: [],
                totalPrivateRevenue,
                totalGroupRevenue,
                totalDeductions,
                totalPay
            };
            console.log(`✅ Generated payslip data: ${privateSessions.length} private sessions, ${groupSessions.length} group sessions, total: €${totalPay.toFixed(2)}`);
            return {
                success: true,
                data: payslipData
            };
        }
        catch (error) {
            console.error('❌ Error generating payslip:', error);
            return {
                success: false,
                error: error?.message || 'Failed to generate payslip'
            };
        }
    }
    async generateExcelPayslip(payslipData) {
        try {
            console.log('📊 Generating Excel payslip (formatted)...');
            const wb = new ExcelJS.Workbook();
            const ws = wb.addWorksheet('Payslip');
            const currency = (v) => `€${Number(v).toFixed(2)}`;
            // Column widths
            ws.columns = [
                { header: '', key: 'a', width: 28 },
                { header: '', key: 'b', width: 16 },
                { header: '', key: 'c', width: 28 },
                { header: '', key: 'd', width: 18 },
                { header: '', key: 'e', width: 14 },
            ];
            // Title
            ws.mergeCells('A1:E1');
            ws.getCell('A1').value = 'Malta Fight Co. - PAYSLIP';
            ws.getCell('A1').font = { bold: true, size: 16 };
            ws.getCell('A1').alignment = { horizontal: 'center' };
            // Header details
            ws.getCell('A3').value = 'CONTRACTOR NAME:';
            ws.getCell('B3').value = payslipData.coachName;
            ws.getCell('D3').value = 'MONTH:';
            ws.getCell('E3').value = payslipData.period;
            ws.getCell('A4').value = 'CONTRACTOR DESIGNATION:';
            ws.getCell('B4').value = payslipData.coachDesignation;
            ws.getCell('D4').value = 'YEAR:';
            ws.getCell('E4').value = new Date().getFullYear();
            // Private section header
            ws.mergeCells('A6:E6');
            ws.getCell('A6').value = 'PRIVATE SESSION REVENUE';
            ws.getCell('A6').font = { bold: true };
            // Table header
            ws.addRow(['CLIENT NAME', 'DATE', 'SESSION TYPE', 'NET PRICE PER SESSION', 'YOUR PAY']).font = { bold: true };
            // Rows
            payslipData.privateSessions.forEach(s => {
                ws.addRow([s.clientName, s.date, s.sessionType, currency(s.netPricePerSession), currency(s.yourPay)]);
            });
            // Private total
            ws.addRow(['', '', '', 'TOTAL', currency(payslipData.totalPrivateRevenue)]).font = { bold: true };
            ws.addRow([]);
            // Group section
            ws.mergeCells(`A${ws.rowCount + 1}:E${ws.rowCount + 1}`);
            ws.getCell(`A${ws.rowCount}`).value = 'GROUP SESSION REVENUE';
            ws.getCell(`A${ws.rowCount}`).font = { bold: true };
            ws.addRow(['CLIENT NAME', 'DATE', 'CLASS TYPE', 'MEMBERSHIP USED', 'YOUR PAY']).font = { bold: true };
            payslipData.groupSessions.forEach(s => {
                ws.addRow([s.clientName, s.date, s.classType, s.membershipUsed, currency(s.yourPay)]);
            });
            ws.addRow(['', '', '', 'TOTAL', currency(payslipData.totalGroupRevenue)]).font = { bold: true };
            ws.addRow([]);
            // Deductions
            ws.mergeCells(`A${ws.rowCount + 1}:E${ws.rowCount + 1}`);
            ws.getCell(`A${ws.rowCount}`).value = 'DEDUCTIONS';
            ws.getCell(`A${ws.rowCount}`).font = { bold: true };
            ws.addRow(['DEDUCTION TYPE', '', 'DATE', 'PAY DEDUCTED']).font = { bold: true };
            ws.addRow(['', '', '', 'TOTAL', currency(0)]).font = { bold: true };
            ws.addRow([]);
            // Total pay footer
            ws.addRow(['TOTAL PAY', '', '', '', currency(payslipData.totalPay)]).font = { bold: true };
            const buffer = await wb.xlsx.writeBuffer();
            console.log('✅ Excel payslip generated successfully');
            return Buffer.from(buffer);
        }
        catch (error) {
            console.error('❌ Error generating Excel payslip:', error);
            throw new Error(`Failed to generate Excel payslip: ${error?.message || 'Unknown error'}`);
        }
    }
    async generatePDFPayslip(payslipData) {
        try {
            console.log('📊 Generating PDF payslip...');
            const doc = new pdfkit_1.default({ margin: 50 });
            const buffers = [];
            doc.on('data', buffers.push.bind(buffers));
            return new Promise((resolve, reject) => {
                doc.on('end', () => {
                    const pdfBuffer = Buffer.concat(buffers);
                    console.log('✅ PDF payslip generated successfully');
                    resolve(pdfBuffer);
                });
                doc.on('error', reject);
                doc.fontSize(20).text('Malta Fight Co. - PAYSLIP', { align: 'center' });
                doc.moveDown(2);
                doc.fontSize(12);
                doc.text(`CONTRACTOR NAME: ${payslipData.coachName}`, 50, 150);
                doc.text(`CONTRACTOR DESIGNATION: ${payslipData.coachDesignation}`, 50, 170);
                doc.text(`MONTH: ${payslipData.period}`, 350, 150);
                doc.text(`YEAR: ${new Date().getFullYear()}`, 350, 170);
                doc.moveDown(2);
                doc.fontSize(14).text('PRIVATE SESSION REVENUE', { underline: true });
                doc.moveDown(0.5);
                if (payslipData.privateSessions.length > 0) {
                    doc.fontSize(10).text('CLIENT NAME', 50, doc.y);
                    doc.text('DATE', 200, doc.y);
                    doc.text('SESSION TYPE', 320, doc.y);
                    doc.text('NET PRICE', 480, doc.y);
                    doc.text('YOUR PAY', 540, doc.y);
                    doc.moveDown(0.5);
                    payslipData.privateSessions.forEach(session => {
                        doc.text(session.clientName, 50, doc.y);
                        doc.text(session.date, 200, doc.y);
                        doc.text(session.sessionType, 320, doc.y);
                        doc.text(`€${session.netPricePerSession.toFixed(2)}`, 480, doc.y);
                        doc.text(`€${session.yourPay.toFixed(2)}`, 540, doc.y);
                        doc.moveDown(0.3);
                    });
                }
                else {
                    doc.text('No private sessions found', 50, doc.y);
                }
                doc.moveDown(0.5);
                doc.text(`TOTAL: €${payslipData.totalPrivateRevenue.toFixed(2)}`, 480, doc.y);
                doc.moveDown(1);
                doc.fontSize(14).text('GROUP SESSION REVENUE', { underline: true });
                doc.moveDown(0.5);
                if (payslipData.groupSessions.length > 0) {
                    doc.fontSize(10).text('CLIENT NAME', 50, doc.y);
                    doc.text('DATE', 200, doc.y);
                    doc.text('CLASS TYPE', 320, doc.y);
                    doc.text('MEMBERSHIP', 480, doc.y);
                    doc.text('YOUR PAY', 540, doc.y);
                    doc.moveDown(0.5);
                    payslipData.groupSessions.forEach(session => {
                        doc.text(session.clientName, 50, doc.y);
                        doc.text(session.date, 200, doc.y);
                        doc.text(session.classType, 320, doc.y);
                        doc.text(session.membershipUsed, 480, doc.y);
                        doc.text(`€${session.yourPay.toFixed(2)}`, 540, doc.y);
                        doc.moveDown(0.3);
                    });
                }
                else {
                    doc.text('No group sessions found', 50, doc.y);
                }
                doc.moveDown(0.5);
                doc.text(`TOTAL: €${payslipData.totalGroupRevenue.toFixed(2)}`, 480, doc.y);
                doc.moveDown(1);
                doc.fontSize(14).text('DEDUCTIONS', { underline: true });
                doc.moveDown(0.5);
                doc.text('No deductions recorded', 50, doc.y);
                doc.moveDown(1);
                doc.fontSize(16).text(`TOTAL PAY: €${payslipData.totalPay.toFixed(2)}`, { align: 'center' });
                doc.end();
            });
        }
        catch (error) {
            console.error('❌ Error generating PDF payslip:', error);
            throw new Error(`Failed to generate PDF payslip: ${error?.message || 'Unknown error'}`);
        }
    }
    isPrivateSession(membershipName) {
        const privateKeywords = ['private', '1 to 1', 'one to one', 'personal'];
        return privateKeywords.some(keyword => membershipName.toLowerCase().includes(keyword.toLowerCase()));
    }
    getSessionType(membershipName) {
        if (membershipName.toLowerCase().includes('group')) {
            return 'Group Private Session';
        }
        return '1 to 1 Private Combat Session';
    }
    getClassType(membershipName) {
        if (membershipName.toLowerCase().includes('strikezone')) {
            return 'STRIKEZONE (13-17) LEADE';
        }
        return 'MMA';
    }
    formatDate(dateString) {
        try {
            const date = new Date(dateString);
            return date.toISOString().split('T')[0] || dateString;
        }
        catch {
            return dateString;
        }
    }
    getPeriodString(fromDate, toDate, sessions) {
        if (fromDate && toDate) {
            const from = new Date(fromDate);
            const to = new Date(toDate);
            return `${from.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} - ${to.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`;
        }
        if (sessions && sessions.length > 0) {
            const dates = sessions
                .map(s => new Date(s['Event Starts At'] || s['eventStartsAt'] || s.Date || s.date))
                .filter(d => !isNaN(d.getTime()))
                .sort((a, b) => a.getTime() - b.getTime());
            if (dates.length > 0) {
                const first = dates[0];
                const last = dates[dates.length - 1];
                if (first && last) {
                    return `${first.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} - ${last.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`;
                }
            }
        }
        return new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    }
}
exports.PayslipService = PayslipService;
//# sourceMappingURL=payslipService.js.map