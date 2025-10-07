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
export declare class InvoiceVerificationService {
    private readonly INVOICE_VERIFICATION_SHEET;
    private readonly PAYMENTS_SHEET;
    initializeInvoiceVerification(): Promise<InvoiceVerification[]>;
    loadInvoiceVerificationData(): Promise<InvoiceVerification[]>;
    saveInvoiceVerificationData(invoices: InvoiceVerification[]): Promise<void>;
    findAvailableInvoice(customerName: string, requiredAmount: number, existingInvoices: InvoiceVerification[]): Promise<InvoiceVerification | null>;
    useInvoiceAmount(invoiceNumber: string, amount: number, existingInvoices: InvoiceVerification[]): Promise<InvoiceVerification[]>;
    markInvoiceUnverified(customerName: string, requiredAmount: number, existingInvoices: InvoiceVerification[]): Promise<InvoiceVerification[]>;
    private normalizeInvoiceVerificationRow;
    private normalizeCustomerName;
    private estimateSessionPriceFromRules;
    private round2;
}
export declare const invoiceVerificationService: InvoiceVerificationService;
//# sourceMappingURL=invoiceVerificationService.d.ts.map