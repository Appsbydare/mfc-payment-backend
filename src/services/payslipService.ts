import { googleSheetsService } from './googleSheets';
import * as XLSX from 'xlsx';
import PDFDocument from 'pdfkit';

export interface PayslipData {
  coachName: string;
  coachDesignation: string;
  period: string;
  fromDate: string;
  toDate: string;
  privateSessions: PrivateSession[];
  groupSessions: GroupSession[];
  deductions: Deduction[];
  totalPrivateRevenue: number;
  totalGroupRevenue: number;
  totalDeductions: number;
  totalPay: number;
}

export interface PrivateSession {
  clientName: string;
  date: string;
  sessionType: string;
  netPricePerSession: number;
  yourPay: number;
}

export interface GroupSession {
  clientName: string;
  date: string;
  classType: string;
  membershipUsed: string;
  yourPay: number;
}

export interface Deduction {
  deductionType: string;
  date: string;
  payDeducted: number;
}

export interface PayslipGenerationParams {
  coachName: string;
  fromDate?: string;
  toDate?: string;
}

export class PayslipService {
  private readonly MASTER_SHEET = 'payment_calc_detail';

  async generatePayslip(params: PayslipGenerationParams): Promise<{ success: boolean; data?: PayslipData; error?: string }> {
    try {
      console.log(`📊 Generating payslip for coach: ${params.coachName}`);

      // Read payment calculation details from Google Sheets
      const paymentCalcData = await googleSheetsService.readSheet(this.MASTER_SHEET);

      if (!paymentCalcData || paymentCalcData.length === 0) {
        return {
          success: false,
          error: 'No payment calculation data found'
        };
      }

      // Filter data by coach and date range
      let filteredData = paymentCalcData.filter((row: any) => {
        const rowCoach = row.Instructor || row.instructor || row.Coach || row.coach || '';
        if (rowCoach !== params.coachName) return false;

        if (params.fromDate || params.toDate) {
          const rowDate = row['Event Starts At'] || row['eventStartsAt'] || row.Date || row.date || '';
          if (!rowDate) return false;

          const date = new Date(rowDate);
          if (params.fromDate && date < new Date(params.fromDate)) return false;
          if (params.toDate && date > new Date(params.toDate)) return false;
        }
        return true;
      });

      if (filteredData.length === 0) {
        return {
          success: false,
          error: `No sessions found for coach "${params.coachName}" in the specified date range`
        };
      }

      // Categorize sessions into private and group
      const privateSessions: PrivateSession[] = [];
      const groupSessions: GroupSession[] = [];

      filteredData.forEach((row: any) => {
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

        // Determine if it's a private or group session based on membership name
        if (this.isPrivateSession(membershipName)) {
          privateSessions.push({
            ...sessionData,
            sessionType: this.getSessionType(membershipName)
          });
        } else {
          groupSessions.push({
            ...sessionData,
            classType: this.getClassType(membershipName),
            membershipUsed: membershipName
          });
        }
      });

      // Calculate totals
      const totalPrivateRevenue = privateSessions.reduce((sum, session) => sum + session.yourPay, 0);
      const totalGroupRevenue = groupSessions.reduce((sum, session) => sum + session.yourPay, 0);
      const totalDeductions = 0; // Keep empty as requested
      const totalPay = totalPrivateRevenue + totalGroupRevenue - totalDeductions;

      // Determine period string
      const period = this.getPeriodString(params.fromDate, params.toDate, filteredData);

      const payslipData: PayslipData = {
        coachName: params.coachName,
        coachDesignation: 'MMA COACH',
        period,
        fromDate: params.fromDate || '',
        toDate: params.toDate || '',
        privateSessions,
        groupSessions,
        deductions: [], // Keep empty as requested
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

    } catch (error: any) {
      console.error('❌ Error generating payslip:', error);
      return {
        success: false,
        error: error?.message || 'Failed to generate payslip'
      };
    }
  }

  async generateExcelPayslip(payslipData: PayslipData): Promise<Buffer> {
    try {
      console.log('📊 Generating Excel payslip...');

      // Create a new workbook
      const workbook = XLSX.utils.book_new();

      // Create payslip data array
      const payslipRows: any[][] = [];

      // Header section
      payslipRows.push(['Malta Fight Co. - PAYSLIP']);
      payslipRows.push([]);
      payslipRows.push(['CONTRACTOR NAME:', payslipData.coachName]);
      payslipRows.push(['CONTRACTOR DESIGNATION:', payslipData.coachDesignation]);
      payslipRows.push(['MONTH:', payslipData.period]);
      payslipRows.push(['YEAR:', new Date().getFullYear().toString()]);
      payslipRows.push([]);

      // Private Session Revenue section
      payslipRows.push(['PRIVATE SESSION REVENUE']);
      payslipRows.push(['CLIENT NAME', 'DATE', 'SESSION TYPE', 'NET PRICE PER SESSION', 'YOUR PAY']);
      
      payslipData.privateSessions.forEach(session => {
        payslipRows.push([
          session.clientName,
          session.date,
          session.sessionType,
          `€${session.netPricePerSession.toFixed(2)}`,
          `€${session.yourPay.toFixed(2)}`
        ]);
      });

      // Private sessions total
      payslipRows.push(['', '', '', 'TOTAL', `€${payslipData.totalPrivateRevenue.toFixed(2)}`]);
      payslipRows.push([]);

      // Group Session Revenue section
      payslipRows.push(['GROUP SESSION REVENUE']);
      payslipRows.push(['CLIENT NAME', 'DATE', 'CLASS TYPE', 'MEMBERSHIP USED', 'YOUR PAY']);
      
      payslipData.groupSessions.forEach(session => {
        payslipRows.push([
          session.clientName,
          session.date,
          session.classType,
          session.membershipUsed,
          `€${session.yourPay.toFixed(2)}`
        ]);
      });

      // Group sessions total
      payslipRows.push(['', '', '', 'TOTAL', `€${payslipData.totalGroupRevenue.toFixed(2)}`]);
      payslipRows.push([]);

      // Deductions section (empty as requested)
      payslipRows.push(['DEDUCTIONS']);
      payslipRows.push(['DEDUCTION TYPE', '', 'DATE', 'PAY DEDUCTED']);
      payslipRows.push(['', '', '', 'TOTAL', '€0.00']);
      payslipRows.push([]);

      // Total Pay
      payslipRows.push(['TOTAL PAY', '', '', '', `€${payslipData.totalPay.toFixed(2)}`]);

      // Create worksheet
      const worksheet = XLSX.utils.aoa_to_sheet(payslipRows);

      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Payslip');

      // Generate buffer
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      console.log('✅ Excel payslip generated successfully');
      return buffer;

    } catch (error: any) {
      console.error('❌ Error generating Excel payslip:', error);
      throw new Error(`Failed to generate Excel payslip: ${error?.message || 'Unknown error'}`);
    }
  }

  async generatePDFPayslip(payslipData: PayslipData): Promise<Buffer> {
    try {
      console.log('📊 Generating PDF payslip...');

      const doc = new PDFDocument({ margin: 50 });
      const buffers: Buffer[] = [];

      doc.on('data', buffers.push.bind(buffers));

      return new Promise((resolve, reject) => {
        doc.on('end', () => {
          const pdfBuffer = Buffer.concat(buffers);
          console.log('✅ PDF payslip generated successfully');
          resolve(pdfBuffer);
        });

        doc.on('error', reject);

        // Header
        doc.fontSize(20).text('Malta Fight Co. - PAYSLIP', { align: 'center' });
        doc.moveDown(2);

        // Contractor details
        doc.fontSize(12);
        doc.text(`CONTRACTOR NAME: ${payslipData.coachName}`, 50, 150);
        doc.text(`CONTRACTOR DESIGNATION: ${payslipData.coachDesignation}`, 50, 170);
        doc.text(`MONTH: ${payslipData.period}`, 300, 150);
        doc.text(`YEAR: ${new Date().getFullYear()}`, 300, 170);
        doc.moveDown(2);

        // Private Session Revenue
        doc.fontSize(14).text('PRIVATE SESSION REVENUE', { underline: true });
        doc.moveDown(0.5);

        if (payslipData.privateSessions.length > 0) {
          // Table headers
          doc.fontSize(10);
          doc.text('CLIENT NAME', 50, doc.y);
          doc.text('DATE', 200, doc.y);
          doc.text('SESSION TYPE', 280, doc.y);
          doc.text('NET PRICE', 400, doc.y);
          doc.text('YOUR PAY', 480, doc.y);
          doc.moveDown(0.5);

          // Table rows
          payslipData.privateSessions.forEach(session => {
            doc.text(session.clientName, 50, doc.y);
            doc.text(session.date, 200, doc.y);
            doc.text(session.sessionType, 280, doc.y);
            doc.text(`€${session.netPricePerSession.toFixed(2)}`, 400, doc.y);
            doc.text(`€${session.yourPay.toFixed(2)}`, 480, doc.y);
            doc.moveDown(0.3);
          });
        } else {
          doc.text('No private sessions found', 50, doc.y);
        }

        // Private sessions total
        doc.moveDown(0.5);
        doc.text(`TOTAL: €${payslipData.totalPrivateRevenue.toFixed(2)}`, 400, doc.y);
        doc.moveDown(1);

        // Group Session Revenue
        doc.fontSize(14).text('GROUP SESSION REVENUE', { underline: true });
        doc.moveDown(0.5);

        if (payslipData.groupSessions.length > 0) {
          // Table headers
          doc.fontSize(10);
          doc.text('CLIENT NAME', 50, doc.y);
          doc.text('DATE', 200, doc.y);
          doc.text('CLASS TYPE', 280, doc.y);
          doc.text('MEMBERSHIP', 400, doc.y);
          doc.text('YOUR PAY', 480, doc.y);
          doc.moveDown(0.5);

          // Table rows
          payslipData.groupSessions.forEach(session => {
            doc.text(session.clientName, 50, doc.y);
            doc.text(session.date, 200, doc.y);
            doc.text(session.classType, 280, doc.y);
            doc.text(session.membershipUsed, 400, doc.y);
            doc.text(`€${session.yourPay.toFixed(2)}`, 480, doc.y);
            doc.moveDown(0.3);
          });
        } else {
          doc.text('No group sessions found', 50, doc.y);
        }

        // Group sessions total
        doc.moveDown(0.5);
        doc.text(`TOTAL: €${payslipData.totalGroupRevenue.toFixed(2)}`, 400, doc.y);
        doc.moveDown(1);

        // Deductions (empty as requested)
        doc.fontSize(14).text('DEDUCTIONS', { underline: true });
        doc.moveDown(0.5);
        doc.text('No deductions recorded', 50, doc.y);
        doc.moveDown(1);

        // Total Pay
        doc.fontSize(16).text(`TOTAL PAY: €${payslipData.totalPay.toFixed(2)}`, { align: 'center' });

        doc.end();
      });

    } catch (error: any) {
      console.error('❌ Error generating PDF payslip:', error);
      throw new Error(`Failed to generate PDF payslip: ${error?.message || 'Unknown error'}`);
    }
  }

  private isPrivateSession(membershipName: string): boolean {
    const privateKeywords = ['private', '1 to 1', 'one to one', 'personal'];
    return privateKeywords.some(keyword => 
      membershipName.toLowerCase().includes(keyword.toLowerCase())
    );
  }

  private getSessionType(membershipName: string): string {
    if (membershipName.toLowerCase().includes('group')) {
      return 'Group Private Session';
    }
    return '1 to 1 Private Combat Session';
  }

  private getClassType(membershipName: string): string {
    if (membershipName.toLowerCase().includes('strikezone')) {
      return 'STRIKEZONE (13-17) LEADE';
    }
    return 'MMA';
  }

  private formatDate(dateString: string): string {
    try {
      const date = new Date(dateString);
      return date.toISOString().split('T')[0] || dateString; // YYYY-MM-DD format
    } catch {
      return dateString;
    }
  }

  private getPeriodString(fromDate?: string, toDate?: string, sessions?: any[]): string {
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
