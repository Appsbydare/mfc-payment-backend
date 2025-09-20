import { googleSheetsService } from './googleSheets';

export interface InvoiceVerification {
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

export interface PaymentRecord {
  Invoice: string;
  Customer: string;
  Amount: number;
  Date: string;
  Memo?: string;
}

export class InvoiceVerificationService {
  private readonly INVOICE_VERIFICATION_SHEET = 'Inv_Verification';
  private readonly PAYMENTS_SHEET = 'Payments';

  /**
   * Initialize invoice verification data from payments
   */
  async initializeInvoiceVerification(): Promise<InvoiceVerification[]> {
    try {
      console.log('🔄 Initializing invoice verification data...');
      
      // Load all payments
      const payments = await googleSheetsService.readSheet(this.PAYMENTS_SHEET);
      console.log(`📊 Loaded ${payments.length} payment records`);
      
      // Group payments by invoice number
      const invoiceMap = new Map<string, PaymentRecord[]>();
      
      for (const payment of payments) {
        const invoice = String(payment.Invoice || '').trim();
        if (!invoice) continue;
        
        if (!invoiceMap.has(invoice)) {
          invoiceMap.set(invoice, []);
        }
        invoiceMap.get(invoice)!.push(payment as PaymentRecord);
      }
      
      console.log(`📋 Found ${invoiceMap.size} unique invoices`);
      
      // Create invoice verification records
      const invoiceVerifications: InvoiceVerification[] = [];
      
      for (const [invoiceNumber, invoicePayments] of invoiceMap) {
        // Get customer name from first payment (assuming all payments for same invoice are from same customer)
        const customerName = this.normalizeCustomerName(invoicePayments[0].Customer);
        
        // Calculate total amount for this invoice
        const totalAmount = invoicePayments.reduce((sum, payment) => sum + Number(payment.Amount || 0), 0);
        
        // Get earliest payment date
        const createdAt = invoicePayments.reduce((earliest, payment) => {
          const paymentDate = new Date(payment.Date);
          return paymentDate < earliest ? paymentDate : earliest;
        }, new Date(invoicePayments[0].Date));
        
        const invoiceVerification: InvoiceVerification = {
          invoiceNumber,
          customerName,
          totalAmount: this.round2(totalAmount),
          usedAmount: 0,
          remainingBalance: this.round2(totalAmount),
          status: 'Available',
          sessionsUsed: 0,
          totalSessions: 0, // Will be calculated based on package
          lastUsedDate: '',
          createdAt: createdAt.toISOString(),
          updatedAt: new Date().toISOString()
        };
        
        invoiceVerifications.push(invoiceVerification);
      }
      
      // Sort by creation date (FIFO)
      invoiceVerifications.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      
      console.log(`✅ Created ${invoiceVerifications.length} invoice verification records`);
      return invoiceVerifications;
      
    } catch (error: any) {
      console.error('❌ Error initializing invoice verification:', error);
      throw new Error(`Failed to initialize invoice verification: ${error?.message || 'Unknown error'}`);
    }
  }

  /**
   * Load existing invoice verification data from Google Sheets
   */
  async loadInvoiceVerificationData(): Promise<InvoiceVerification[]> {
    try {
      console.log('📖 Loading existing invoice verification data...');
      const data = await googleSheetsService.readSheet(this.INVOICE_VERIFICATION_SHEET);
      
      return data.map(row => this.normalizeInvoiceVerificationRow(row));
    } catch (error) {
      console.log('📝 No existing invoice verification data found, will initialize');
      return [];
    }
  }

  /**
   * Save invoice verification data to Google Sheets
   */
  async saveInvoiceVerificationData(invoices: InvoiceVerification[]): Promise<void> {
    try {
      console.log(`💾 Saving ${invoices.length} invoice verification records...`);
      
      // Convert to Google Sheets format
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
      
      await googleSheetsService.writeSheet(this.INVOICE_VERIFICATION_SHEET, sheetData);
      console.log('✅ Invoice verification data saved successfully');
      
    } catch (error: any) {
      console.error('❌ Error saving invoice verification data:', error);
      throw new Error(`Failed to save invoice verification data: ${error?.message || 'Unknown error'}`);
    }
  }

  /**
   * Find available invoice for customer with sufficient balance
   */
  async findAvailableInvoice(
    customerName: string, 
    requiredAmount: number, 
    existingInvoices: InvoiceVerification[]
  ): Promise<InvoiceVerification | null> {
    
    const normalizedCustomer = this.normalizeCustomerName(customerName);
    
    // Filter invoices for this customer with sufficient balance
    const availableInvoices = existingInvoices.filter(invoice => 
      invoice.customerName === normalizedCustomer && 
      invoice.remainingBalance >= requiredAmount &&
      invoice.status !== 'Fully Used'
    );
    
    if (availableInvoices.length === 0) {
      console.log(`❌ No available invoice for ${customerName} with balance >= ${requiredAmount}`);
      return null;
    }
    
    // Return oldest invoice (FIFO)
    const selectedInvoice = availableInvoices[0];
    console.log(`✅ Found available invoice ${selectedInvoice.invoiceNumber} with balance ${selectedInvoice.remainingBalance} for ${customerName}`);
    
    return selectedInvoice;
  }

  /**
   * Use invoice amount and update balance
   */
  async useInvoiceAmount(
    invoiceNumber: string, 
    amount: number, 
    existingInvoices: InvoiceVerification[]
  ): Promise<InvoiceVerification[]> {
    
    const updatedInvoices = existingInvoices.map(invoice => {
      if (invoice.invoiceNumber !== invoiceNumber) return invoice;
      
      const newUsedAmount = this.round2(invoice.usedAmount + amount);
      const newRemainingBalance = this.round2(invoice.remainingBalance - amount);
      const newSessionsUsed = invoice.sessionsUsed + 1;
      
      let newStatus: InvoiceVerification['status'] = 'Available';
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
   * Mark invoice as unverified when no sufficient balance
   */
  async markInvoiceUnverified(
    customerName: string,
    requiredAmount: number,
    existingInvoices: InvoiceVerification[]
  ): Promise<InvoiceVerification[]> {
    
    const normalizedCustomer = this.normalizeCustomerName(customerName);
    
    // Find invoices for this customer that don't have sufficient balance
    const insufficientInvoices = existingInvoices.filter(invoice => 
      invoice.customerName === normalizedCustomer && 
      invoice.remainingBalance < requiredAmount &&
      invoice.remainingBalance > 0
    );
    
    // Mark them as unverified
    const updatedInvoices = existingInvoices.map(invoice => {
      if (insufficientInvoices.some(ins => ins.invoiceNumber === invoice.invoiceNumber)) {
        return {
          ...invoice,
          status: 'Unverified' as InvoiceVerification['status'],
          updatedAt: new Date().toISOString()
        };
      }
      return invoice;
    });
    
    if (insufficientInvoices.length > 0) {
      console.log(`⚠️ Marked ${insufficientInvoices.length} invoices as unverified for ${customerName} (insufficient balance for ${requiredAmount})`);
    }
    
    return updatedInvoices;
  }

  /**
   * Normalize invoice verification row from Google Sheets
   */
  private normalizeInvoiceVerificationRow(row: any): InvoiceVerification {
    return {
      invoiceNumber: String(row['Invoice Number'] || ''),
      customerName: String(row['Customer Name'] || ''),
      totalAmount: this.round2(Number(row['Total Amount'] || 0)),
      usedAmount: this.round2(Number(row['Used Amount'] || 0)),
      remainingBalance: this.round2(Number(row['Remaining Balance'] || 0)),
      status: String(row['Status'] || 'Available') as InvoiceVerification['status'],
      sessionsUsed: Number(row['Sessions Used'] || 0),
      totalSessions: Number(row['Total Sessions'] || 0),
      lastUsedDate: String(row['Last Used Date'] || ''),
      createdAt: String(row['Created At'] || new Date().toISOString()),
      updatedAt: String(row['Updated At'] || new Date().toISOString())
    };
  }

  /**
   * Normalize customer name for consistent matching
   */
  private normalizeCustomerName(customerName: string): string {
    return String(customerName || '').trim().toLowerCase();
  }

  /**
   * Round to 2 decimal places
   */
  private round2(n: number): number {
    return Math.round((n || 0) * 100) / 100;
  }
}

export const invoiceVerificationService = new InvoiceVerificationService();
