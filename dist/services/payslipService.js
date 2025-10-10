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
                const customerName = row['Customer Name'] || row['Customer'] || row['customer'] || '';
                const eventDate = row['Event Starts At'] || row['eventStartsAt'] || row.Date || row.date || '';
                const sessionPrice = parseFloat(row['Session Price'] || row['sessionPrice'] || 0) || 0;
                const discountedPrice = parseFloat(row['Discounted Session Price'] || row['discountedSessionPrice'] || 0) || 0;
                const coachAmount = parseFloat(row['Coach Amount'] || row['coachAmount'] || 0) || 0;
                const sessionTypeFromSheet = String(row['Session Type'] || row['sessionType'] || '');
                const classTypeFromSheet = String(row['Class Type'] || row['ClassType'] || row['classType'] || '');
                const isPrivate = /private/i.test(sessionTypeFromSheet);
                const base = {
                    clientName: customerName,
                    date: this.formatDate(eventDate),
                    netPricePerSession: discountedPrice > 0 ? discountedPrice : sessionPrice,
                    yourPay: coachAmount
                };
                if (isPrivate) {
                    privateSessions.push({ ...base, sessionType: sessionTypeFromSheet });
                }
                else {
                    groupSessions.push({ ...base, classType: classTypeFromSheet, membershipUsed: membershipName });
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
                // Header band
                doc.save();
                doc.rect(0, 0, doc.page.width, 60).fill('#111827');
                doc.fillColor('#F9FAFB').fontSize(20).text('Malta Fight Co. - PAYSLIP', 0, 18, { align: 'center' });
                doc.restore();
                // Contractor details
                doc.fontSize(12).fillColor('#000');
                doc.text(`CONTRACTOR NAME: ${payslipData.coachName}`, 50, 80);
                doc.text(`CONTRACTOR DESIGNATION: ${payslipData.coachDesignation}`, 50, 100);
                doc.text(`MONTH: ${payslipData.period}`, 350, 80);
                doc.text(`YEAR: ${new Date().getFullYear()}`, 350, 100);
                doc.moveDown(2);
                // Table rendering helpers
                const left = 40;
                const tableWidth = 520;
                const colWidths = [150, 80, 130, 120, 40]; // sums to 520
                const cols = [left, left + colWidths[0], left + colWidths[0] + colWidths[1], left + colWidths[0] + colWidths[1] + colWidths[2], left + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3]];
                const baseRowHeight = 16;
                const pageBottom = doc.page.height - 50;
                const drawHeaderRow = (y, headers) => {
                    doc.save();
                    doc.rect(left, y, tableWidth, baseRowHeight).fill('#000');
                    doc.fillColor('#fff').fontSize(10);
                    let x = left; headers.forEach((h, i) => { doc.text(h, x + 4, y + 4, { width: colWidths[i], ellipsis: true }); x += colWidths[i]; });
                    doc.restore();
                    return y + baseRowHeight;
                };
                const drawRow = (y, cells) => {
                    // compute row height based on wrapped text
                    doc.fontSize(9);
                    const paddX = 4, paddY = 3;
                    let maxH = baseRowHeight;
                    cells.forEach((c, i) => {
                        const h = doc.heightOfString(String(c), { width: colWidths[i] - paddX * 2, lineGap: 1 });
                        maxH = Math.max(maxH, h + paddY * 2);
                    });
                    // grid box
                    doc.save();
                    doc.strokeColor('#B0B0B0').lineWidth(0.5).rect(left, y, tableWidth, maxH).stroke();
                    doc.fillColor('#000');
                    // draw wrapped text per cell
                    let x = left; cells.forEach((c, i) => {
                        doc.text(String(c), x + paddX, y + paddY, { width: colWidths[i] - paddX * 2, lineGap: 1 });
                        x += colWidths[i];
                    });
                    doc.restore();
                    return y + maxH;
                };
                const ensurePage = (y) => {
                    if (y + baseRowHeight > pageBottom) {
                        doc.addPage();
                        return 100; // reset area for next tables
                    }
                    return y;
                };
                // PRIVATE SESSION TABLE
                doc.fontSize(14).text('PRIVATE SESSION REVENUE', { underline: true });
                let y = doc.y + 8;
                y = drawHeaderRow(y, ['CLIENT NAME','DATE','SESSION TYPE','NET PRICE','YOUR PAY']);
                if (payslipData.privateSessions.length === 0) {
                    y = drawRow(y, ['No private sessions', '', '', '', '']);
                } else {
                    payslipData.privateSessions.forEach(s => {
                        y = ensurePage(y);
                        y = drawRow(y, [s.clientName, s.date, s.sessionType, `€${s.netPricePerSession.toFixed(2)}`, `€${s.yourPay.toFixed(2)}`]);
                    });
                }
                // Private total row (dark)
                y = ensurePage(y);
                doc.save();
                doc.rect(left, y, tableWidth, baseRowHeight).fill('#111827');
                doc.fillColor('#F9FAFB').fontSize(10).text('TOTAL', cols[3] + 4, y + 4);
                doc.text(`€${payslipData.totalPrivateRevenue.toFixed(2)}`, cols[4] + 4, y + 4);
                doc.restore();
                y += baseRowHeight + 10;
                // GROUP SESSION TABLE
                doc.fontSize(14).text('GROUP SESSION REVENUE', { underline: true });
                y = doc.y + 8;
                y = drawHeaderRow(y, ['CLIENT NAME','DATE','CLASS TYPE','MEMBERSHIP','YOUR PAY']);
                if (payslipData.groupSessions.length === 0) {
                    y = drawRow(y, ['No group sessions', '', '', '', '']);
                } else {
                    payslipData.groupSessions.forEach(s => {
                        y = ensurePage(y);
                        y = drawRow(y, [s.clientName, s.date, s.classType, s.membershipUsed, `€${s.yourPay.toFixed(2)}`]);
                    });
                }
                // Group total row (dark)
                y = ensurePage(y);
                doc.save();
                doc.rect(left, y, tableWidth, baseRowHeight).fill('#111827');
                doc.fillColor('#F9FAFB').fontSize(10).text('TOTAL', cols[3] + 4, y + 4);
                doc.text(`€${payslipData.totalGroupRevenue.toFixed(2)}`, cols[4] + 4, y + 4);
                doc.restore();
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