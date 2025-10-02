import { GoogleSheetsService } from './googleSheets';

export interface InvoiceVerificationRecord {
  invoiceNumber: string;
  customerName: string;
  totalAmount: number;
  usedAmount: number;
  remainingBalance: number;
  status: 'Available' | 'Partially Used' | 'Fully Used' | 'Unverified';
  sessionsUsed: number;
  totalSessions: number;
  lastUsedDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceUsageRecord {
  invoiceNumber: string;
  customerName: string;
  sessionDate: string;
  sessionPrice: number;
  sessionsCount: number;
  usedAmount: number;
  remainingBalance: number;
  status: string;
}

export class InvoiceVerificationService {
  private readonly INVOICE_VERIFICATION_SHEET = 'Inv_Verification';
  private readonly PAYMENTS_SHEET = 'Payments';
  private readonly ATTENDANCE_SHEET = 'attendance';
  private sheets: GoogleSheetsService;

  constructor() {
    this.sheets = new GoogleSheetsService();
  }

  /**
   * Initialize invoice verification data from payments sheet
   */
  async initializeInvoiceVerification(): Promise<InvoiceVerificationRecord[]> {
    try {
      console.log('🔄 Initializing invoice verification data...');
      const payments = await this.sheets.readSheet(this.PAYMENTS_SHEET);
      console.log(`📊 Loaded ${payments.length} payment records`);

      const invoiceMap = new Map<string, any[]>();
      for (const payment of payments) {
        const invoice = String(payment.Invoice || payment.invoice || '').trim();
        if (!invoice) continue;

        if (!invoiceMap.has(invoice)) {
          invoiceMap.set(invoice, []);
        }
        invoiceMap.get(invoice)!.push(payment);
      }

      console.log(`📋 Found ${invoiceMap.size} unique invoices`);

      const invoiceVerifications: InvoiceVerificationRecord[] = [];
      for (const [invoiceNumber, invoicePayments] of invoiceMap) {
        const customerName = this.normalizeCustomerName(invoicePayments[0].Customer || invoicePayments[0]['Customer']);
        const totalAmount = invoicePayments.reduce((sum, payment) => sum + Number(payment.Amount || 0), 0);
        const createdAt = invoicePayments.reduce((earliest, payment) => {
          const paymentDate = new Date(payment.Date || payment.date);
          return paymentDate < earliest ? paymentDate : earliest;
        }, new Date(invoicePayments[0].Date || invoicePayments[0].date));

        const invoiceVerification: InvoiceVerificationRecord = {
          invoiceNumber,
          customerName,
          totalAmount: this.round2(totalAmount),
          usedAmount: 0,
          remainingBalance: this.round2(totalAmount),
          status: 'Available',
          sessionsUsed: 0,
          totalSessions: 0,
          lastUsedDate: '',
          createdAt: createdAt.toISOString(),
          updatedAt: new Date().toISOString()
        };

        invoiceVerifications.push(invoiceVerification);
      }

      invoiceVerifications.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      console.log(`✅ Created ${invoiceVerifications.length} invoice verification records`);
      return invoiceVerifications;

    } catch (error) {
      console.error('❌ Error initializing invoice verification:', error);
      throw new Error(`Failed to initialize invoice verification: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Load existing invoice verification data from Google Sheets
   */
  async loadInvoiceVerificationData(): Promise<InvoiceVerificationRecord[]> {
    try {
      console.log('📖 Loading existing invoice verification data...');
      const data = await this.sheets.readSheet(this.INVOICE_VERIFICATION_SHEET);

      if (!data || data.length === 0) {
        console.log('📝 Invoice verification sheet is empty, will initialize');
        return [];
      }

      const firstRow = data[0];
      if (!firstRow || !firstRow['Invoice Number'] || !firstRow['Customer Name']) {
        console.log('📝 Invoice verification sheet has no headers, will initialize');
        return [];
      }

      return data.map(row => this.normalizeInvoiceVerificationRow(row));
    } catch (error) {
      console.log('📝 No existing invoice verification data found, will initialize');
      return [];
    }
  }

  /**
   * Save invoice verification data to Google Sheets
   */
  async saveInvoiceVerificationData(invoices: InvoiceVerificationRecord[]): Promise<void> {
    try {
      console.log(`💾 Saving ${invoices.length} invoice verification records...`);

      const sheetData = invoices.map(invoice => ({
        'Invoice Number': invoice.invoiceNumber,
        'Customer Name': invoice.customerName,
        'Total Amount': invoice.totalAmount,
        'Used Amount': invoice.usedAmount,
        'Remaining Balance': invoice.remainingBalance,
        'Status': invoice.status,
        'Sessions Used': invoice.sessionsUsed,
        'Total Sessions': invoice.totalSessions,
        'Last Used Date': invoice.lastUsedDate,
        'Created At': invoice.createdAt,
        'Updated At': invoice.updatedAt
      }));

      if (sheetData.length === 0) {
        console.log('📝 Creating empty invoice verification sheet with headers...');
        const emptyData = [{
          'Invoice Number': '',
          'Customer Name': '',
          'Total Amount': '',
          'Used Amount': '',
          'Remaining Balance': '',
          'Status': '',
          'Sessions Used': '',
          'Total Sessions': '',
          'Last Used Date': '',
          'Created At': '',
          'Updated At': ''
        }];
        await this.sheets.writeSheet(this.INVOICE_VERIFICATION_SHEET, emptyData);
      } else {
        await this.sheets.writeSheet(this.INVOICE_VERIFICATION_SHEET, sheetData);
      }

      console.log('✅ Invoice verification data saved successfully');

    } catch (error) {
      console.error('❌ Error saving invoice verification data:', error);
      throw new Error(`Failed to save invoice verification data: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Verify invoices against attendance data and calculate cumulative usage
   */
  async verifyInvoicesWithAttendance(): Promise<{
    verifiedRecords: number;
    totalRecords: number;
    invoiceUsage: InvoiceUsageRecord[];
  }> {
    try {
      console.log('🔍 Starting invoice verification with attendance data...');

      // Load existing invoice data
      let existingInvoices = await this.loadInvoiceVerificationData();
      if (existingInvoices.length === 0) {
        console.log('📝 No existing invoices found, initializing...');
        existingInvoices = await this.initializeInvoiceVerification();
        await this.saveInvoiceVerificationData(existingInvoices);
      }

      // Load attendance data
      const attendance = await this.sheets.readSheet(this.ATTENDANCE_SHEET);
      console.log(`📊 Loaded ${attendance.length} attendance records`);

      const invoiceUsage: InvoiceUsageRecord[] = [];
      let verifiedRecords = 0;

      // Process each attendance record
      for (const att of attendance) {
        if (!att.InvoiceNumber || att.VerificationStatus === 'Not Verified') {
          continue;
        }

        const invoiceNumber = String(att.InvoiceNumber).trim();
        const customerName = this.normalizeCustomerName(att.Customer);
        const sessionPrice = Number(att.sessionPrice || att.SessionPrice || 0);
        const sessionsCount = 1; // Each attendance record represents one session

        // Find matching invoice
        const matchingInvoice = existingInvoices.find(inv =>
          inv.invoiceNumber === invoiceNumber &&
          inv.customerName === customerName
        );

        if (matchingInvoice && matchingInvoice.remainingBalance >= sessionPrice) {
          // Update invoice usage
          existingInvoices = await this.useInvoiceAmount(invoiceNumber, sessionPrice, existingInvoices);

          // Create usage record
          const updatedInvoice = existingInvoices.find(inv => inv.invoiceNumber === invoiceNumber);
          invoiceUsage.push({
            invoiceNumber,
            customerName,
            sessionDate: att.Date || att.date || '',
            sessionPrice,
            sessionsCount,
            usedAmount: updatedInvoice?.usedAmount || 0,
            remainingBalance: updatedInvoice?.remainingBalance || 0,
            status: updatedInvoice?.status || 'Unknown'
          });

          verifiedRecords++;
        } else if (matchingInvoice && matchingInvoice.remainingBalance < sessionPrice) {
          // Mark invoice as unverified due to insufficient balance
          existingInvoices = await this.markInvoiceUnverified(invoiceNumber, existingInvoices);
        }
      }

      // Save updated invoice data
      await this.saveInvoiceVerificationData(existingInvoices);

      console.log(`✅ Invoice verification completed: ${verifiedRecords}/${attendance.length} records verified`);
      return {
        verifiedRecords,
        totalRecords: attendance.length,
        invoiceUsage
      };

    } catch (error) {
      console.error('❌ Error verifying invoices with attendance:', error);
      throw new Error(`Failed to verify invoices: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Find available invoice for a customer with sufficient balance
   */
  async findAvailableInvoice(customerName: string, requiredAmount: number, existingInvoices: InvoiceVerificationRecord[]): Promise<InvoiceVerificationRecord | null> {
    const normalizedCustomer = this.normalizeCustomerName(customerName);

    const availableInvoices = existingInvoices.filter(invoice =>
      invoice.customerName === normalizedCustomer &&
      invoice.remainingBalance >= requiredAmount &&
      invoice.status !== 'Fully Used'
    );

    if (availableInvoices.length === 0) {
      console.log(`❌ No available invoice for ${customerName} with balance >= ${requiredAmount}`);
      return null;
    }

    const selectedInvoice = availableInvoices[0];
    console.log(`✅ Found available invoice ${selectedInvoice.invoiceNumber} with balance ${selectedInvoice.remainingBalance} for ${customerName}`);

    return selectedInvoice;
  }

  /**
   * Update invoice usage when amount is consumed
   */
  async useInvoiceAmount(invoiceNumber: string, amount: number, existingInvoices: InvoiceVerificationRecord[]): Promise<InvoiceVerificationRecord[]> {
    const updatedInvoices = existingInvoices.map(invoice => {
      if (invoice.invoiceNumber !== invoiceNumber) return invoice;

      const newUsedAmount = this.round2(invoice.usedAmount + amount);
      const newRemainingBalance = this.round2(invoice.remainingBalance - amount);
      const newSessionsUsed = invoice.sessionsUsed + 1;

      let newStatus: InvoiceVerificationRecord['status'] = 'Available';
      if (newRemainingBalance <= 0) {
        newStatus = 'Fully Used';
      } else if (newUsedAmount > 0) {
        newStatus = 'Partially Used';
      }

      return {
        ...invoice,
        usedAmount: newUsedAmount,
        remainingBalance: newRemainingBalance,
        sessionsUsed: newSessionsUsed,
        status: newStatus,
        lastUsedDate: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    });

    console.log(`💰 Used ${amount} from invoice ${invoiceNumber}, remaining balance: ${updatedInvoices.find(i => i.invoiceNumber === invoiceNumber)?.remainingBalance}`);

    return updatedInvoices;
  }

  /**
   * Mark invoices as unverified when insufficient balance
   */
  async markInvoiceUnverified(invoiceNumber: string, existingInvoices: InvoiceVerificationRecord[]): Promise<InvoiceVerificationRecord[]> {
    const updatedInvoices = existingInvoices.map(invoice => {
      if (invoice.invoiceNumber === invoiceNumber && invoice.remainingBalance > 0) {
        return {
          ...invoice,
          status: 'Unverified',
          updatedAt: new Date().toISOString()
        };
      }
      return invoice;
    });

    console.log(`⚠️ Marked invoice ${invoiceNumber} as unverified due to insufficient balance`);

    return updatedInvoices;
  }

  /**
   * Get invoice verification summary
   */
  async getInvoiceVerificationSummary(): Promise<{
    totalInvoices: number;
    availableInvoices: number;
    partiallyUsedInvoices: number;
    fullyUsedInvoices: number;
    unverifiedInvoices: number;
    totalAmount: number;
    usedAmount: number;
    remainingAmount: number;
  }> {
    const invoices = await this.loadInvoiceVerificationData();

    const summary = {
      totalInvoices: invoices.length,
      availableInvoices: invoices.filter(i => i.status === 'Available').length,
      partiallyUsedInvoices: invoices.filter(i => i.status === 'Partially Used').length,
      fullyUsedInvoices: invoices.filter(i => i.status === 'Fully Used').length,
      unverifiedInvoices: invoices.filter(i => i.status === 'Unverified').length,
      totalAmount: this.round2(invoices.reduce((sum, i) => sum + i.totalAmount, 0)),
      usedAmount: this.round2(invoices.reduce((sum, i) => sum + i.usedAmount, 0)),
      remainingAmount: this.round2(invoices.reduce((sum, i) => sum + i.remainingBalance, 0))
    };

    return summary;
  }

  /**
   * Normalize invoice verification row data
   */
  private normalizeInvoiceVerificationRow(row: any): InvoiceVerificationRecord {
    return {
      invoiceNumber: String(row['Invoice Number'] || ''),
      customerName: String(row['Customer Name'] || ''),
      totalAmount: this.round2(Number(row['Total Amount'] || 0)),
      usedAmount: this.round2(Number(row['Used Amount'] || 0)),
      remainingBalance: this.round2(Number(row['Remaining Balance'] || 0)),
      status: String(row['Status'] || 'Available') as InvoiceVerificationRecord['status'],
      sessionsUsed: Number(row['Sessions Used'] || 0),
      totalSessions: Number(row['Total Sessions'] || 0),
      lastUsedDate: String(row['Last Used Date'] || ''),
      createdAt: String(row['Created At'] || new Date().toISOString()),
      updatedAt: String(row['Updated At'] || new Date().toISOString())
    };
  }

  /**
   * Normalize customer names for comparison
   */
  private normalizeCustomerName(customerName: string): string {
    return String(customerName || '').trim().toLowerCase();
  }

  /**
   * Round number to 2 decimal places
   */
  private round2(n: number): number {
    return Math.round((n || 0) * 100) / 100;
  }
}

export const invoiceVerificationService = new InvoiceVerificationService();