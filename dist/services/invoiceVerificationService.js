"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.invoiceVerificationService = exports.InvoiceVerificationService = void 0;
const googleSheets_1 = require("./googleSheets");
class InvoiceVerificationService {
    constructor() {
        this.INVOICE_VERIFICATION_SHEET = 'Inv_Verification';
        this.PAYMENTS_SHEET = 'Payments';
    }
    async initializeInvoiceVerification() {
        try {
            console.log('🔄 Initializing invoice verification data...');
            const [payments, rules] = await Promise.all([
                googleSheets_1.googleSheetsService.readSheet(this.PAYMENTS_SHEET),
                googleSheets_1.googleSheetsService.readSheet('rules').catch(() => [])
            ]);
            console.log(`📊 Loaded ${payments.length} payment records and ${rules.length} rules`);
            const invoiceMap = new Map();
            for (const payment of payments) {
                const invoice = String(payment.Invoice || '').trim();
                if (!invoice)
                    continue;
                if (!invoiceMap.has(invoice)) {
                    invoiceMap.set(invoice, []);
                }
                invoiceMap.get(invoice).push(payment);
            }
            console.log(`📋 Found ${invoiceMap.size} unique invoices`);
            const invoiceVerifications = [];
            for (const [invoiceNumber, invoicePayments] of invoiceMap) {
                const customerName = this.normalizeCustomerName(invoicePayments[0].Customer);
                const totalAmount = invoicePayments.reduce((sum, payment) => sum + Number(payment.Amount || 0), 0);
                const createdAt = invoicePayments.reduce((earliest, payment) => {
                    const paymentDate = new Date(payment.Date);
                    return paymentDate < earliest ? paymentDate : earliest;
                }, new Date(invoicePayments[0].Date));
                let totalSessions = 0;
                const memo = String(invoicePayments[0].Memo || '').toLowerCase();
                const sessionPrice = this.estimateSessionPriceFromRules(rules, memo);
                if (sessionPrice > 0 && totalAmount > 0) {
                    totalSessions = Math.round(totalAmount / sessionPrice);
                }
                const invoiceVerification = {
                    invoiceNumber,
                    customerName,
                    totalAmount: this.round2(totalAmount),
                    usedAmount: 0,
                    remainingBalance: this.round2(totalAmount),
                    status: 'Available',
                    sessionsUsed: 0,
                    totalSessions: totalSessions,
                    lastUsedDate: '',
                    createdAt: createdAt.toISOString(),
                    updatedAt: new Date().toISOString()
                };
                invoiceVerifications.push(invoiceVerification);
            }
            invoiceVerifications.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
            console.log(`✅ Created ${invoiceVerifications.length} invoice verification records`);
            return invoiceVerifications;
        }
        catch (error) {
            console.error('❌ Error initializing invoice verification:', error);
            throw new Error(`Failed to initialize invoice verification: ${error?.message || 'Unknown error'}`);
        }
    }
    async loadInvoiceVerificationData() {
        try {
            console.log('📖 Loading existing invoice verification data...');
            const data = await googleSheets_1.googleSheetsService.readSheet(this.INVOICE_VERIFICATION_SHEET);
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
        }
        catch (error) {
            console.log('📝 No existing invoice verification data found, will initialize');
            return [];
        }
    }
    async saveInvoiceVerificationData(invoices) {
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
                await googleSheets_1.googleSheetsService.writeSheet(this.INVOICE_VERIFICATION_SHEET, emptyData);
            }
            else {
                await googleSheets_1.googleSheetsService.writeSheet(this.INVOICE_VERIFICATION_SHEET, sheetData);
            }
            console.log('✅ Invoice verification data saved successfully');
        }
        catch (error) {
            console.error('❌ Error saving invoice verification data:', error);
            throw new Error(`Failed to save invoice verification data: ${error?.message || 'Unknown error'}`);
        }
    }
    async findAvailableInvoice(customerName, requiredAmount, existingInvoices) {
        const normalizedCustomer = this.normalizeCustomerName(customerName);
        const availableInvoices = existingInvoices.filter(invoice => invoice.customerName === normalizedCustomer &&
            invoice.remainingBalance >= requiredAmount &&
            invoice.status !== 'Fully Used');
        if (availableInvoices.length === 0) {
            console.log(`❌ No available invoice for ${customerName} with balance >= ${requiredAmount}`);
            return null;
        }
        const selectedInvoice = availableInvoices[0];
        console.log(`✅ Found available invoice ${selectedInvoice.invoiceNumber} with balance ${selectedInvoice.remainingBalance} for ${customerName}`);
        return selectedInvoice;
    }
    async useInvoiceAmount(invoiceNumber, amount, existingInvoices) {
        const updatedInvoices = existingInvoices.map(invoice => {
            if (invoice.invoiceNumber !== invoiceNumber)
                return invoice;
            const newUsedAmount = this.round2(invoice.usedAmount + amount);
            const newRemainingBalance = this.round2(invoice.remainingBalance - amount);
            const newSessionsUsed = invoice.sessionsUsed + 1;
            let totalSessions = invoice.totalSessions;
            if (totalSessions === 0 && invoice.totalAmount > 0 && amount > 0) {
                totalSessions = Math.round(invoice.totalAmount / amount);
            }
            let newStatus = 'Available';
            if (newRemainingBalance <= 0) {
                newStatus = 'Fully Used';
            }
            else if (newUsedAmount > 0) {
                newStatus = 'Partially Used';
            }
            return {
                ...invoice,
                usedAmount: newUsedAmount,
                remainingBalance: newRemainingBalance,
                sessionsUsed: newSessionsUsed,
                totalSessions: totalSessions,
                status: newStatus,
                lastUsedDate: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
        });
        const updatedInvoice = updatedInvoices.find(i => i.invoiceNumber === invoiceNumber);
        console.log(`💰 Used ${amount} from invoice ${invoiceNumber}, remaining balance: ${updatedInvoice?.remainingBalance}, sessions: ${updatedInvoice?.sessionsUsed}/${updatedInvoice?.totalSessions}`);
        return updatedInvoices;
    }
    async markInvoiceUnverified(customerName, requiredAmount, existingInvoices) {
        const normalizedCustomer = this.normalizeCustomerName(customerName);
        const insufficientInvoices = existingInvoices.filter(invoice => invoice.customerName === normalizedCustomer &&
            invoice.remainingBalance < requiredAmount &&
            invoice.remainingBalance > 0);
        const updatedInvoices = existingInvoices.map(invoice => {
            if (insufficientInvoices.some(ins => ins.invoiceNumber === invoice.invoiceNumber)) {
                return {
                    ...invoice,
                    status: 'Unverified',
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
    normalizeInvoiceVerificationRow(row) {
        return {
            invoiceNumber: String(row['Invoice Number'] || ''),
            customerName: String(row['Customer Name'] || ''),
            totalAmount: this.round2(Number(row['Total Amount'] || 0)),
            usedAmount: this.round2(Number(row['Used Amount'] || 0)),
            remainingBalance: this.round2(Number(row['Remaining Balance'] || 0)),
            status: String(row['Status'] || 'Available'),
            sessionsUsed: Number(row['Sessions Used'] || 0),
            totalSessions: Number(row['Total Sessions'] || 0),
            lastUsedDate: String(row['Last Used Date'] || ''),
            createdAt: String(row['Created At'] || new Date().toISOString()),
            updatedAt: String(row['Updated At'] || new Date().toISOString())
        };
    }
    normalizeCustomerName(customerName) {
        return String(customerName || '').trim().toLowerCase();
    }
    estimateSessionPriceFromRules(rules, memo) {
        if (!rules || rules.length === 0 || !memo)
            return 0;
        for (const rule of rules) {
            const packageName = String(rule.package_name || '').toLowerCase();
            const attendanceAlias = String(rule.attendance_alias || '').toLowerCase();
            const unitPrice = Number(rule.unit_price || 0);
            if (unitPrice > 0 && (memo.includes(packageName) || memo.includes(attendanceAlias))) {
                return unitPrice;
            }
        }
        const validPrices = rules
            .map(r => Number(r.unit_price || 0))
            .filter(p => p > 0);
        if (validPrices.length > 0) {
            return validPrices.reduce((sum, price) => sum + price, 0) / validPrices.length;
        }
        return 0;
    }
    round2(n) {
        return Math.round((n || 0) * 100) / 100;
    }
}
exports.InvoiceVerificationService = InvoiceVerificationService;
exports.invoiceVerificationService = new InvoiceVerificationService();
//# sourceMappingURL=invoiceVerificationService.js.map