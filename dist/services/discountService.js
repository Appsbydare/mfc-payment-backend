"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.discountService = exports.DiscountService = void 0;
const googleSheets_1 = require("./googleSheets");
class DiscountService {
    constructor() {
        this.discounts = [];
        this.lastRefresh = null;
        this.googleSheetsService = new googleSheets_1.GoogleSheetsService();
    }
    async refreshDiscounts() {
        try {
            this.discounts = await this.googleSheetsService.readSheet('discounts');
            this.lastRefresh = new Date();
            console.log(`✅ Loaded ${this.discounts.length} discounts from Google Sheets`);
        }
        catch (error) {
            console.error('❌ Failed to refresh discounts:', error);
            throw new Error('Failed to load discounts from Google Sheets');
        }
    }
    async getActiveDiscounts() {
        if (!this.lastRefresh || this.discounts.length === 0) {
            await this.refreshDiscounts();
        }
        return this.discounts.filter(d => d.active);
    }
    async classifyDiscount(memo) {
        const activeDiscounts = await this.getActiveDiscounts();
        const sortedDiscounts = activeDiscounts.sort((a, b) => {
            const priority = { exact: 1, contains: 2, regex: 3 };
            return priority[a.match_type] - priority[b.match_type];
        });
        for (const discount of sortedDiscounts) {
            const match = this.matchDiscount(memo, discount);
            if (match) {
                return match;
            }
        }
        return null;
    }
    matchDiscount(memo, discount) {
        const memoLower = memo.toLowerCase();
        const codeLower = discount.discount_code.toLowerCase();
        switch (discount.match_type) {
            case 'exact':
                if (memoLower === codeLower) {
                    return {
                        discount,
                        matched_text: memo,
                        confidence: 1.0
                    };
                }
                break;
            case 'contains':
                if (memoLower.includes(codeLower)) {
                    return {
                        discount,
                        matched_text: memo,
                        confidence: 0.8
                    };
                }
                break;
            case 'regex':
                try {
                    const regex = new RegExp(codeLower, 'i');
                    if (regex.test(memo)) {
                        return {
                            discount,
                            matched_text: memo,
                            confidence: 0.9
                        };
                    }
                }
                catch (error) {
                    console.warn(`Invalid regex pattern for discount ${discount.discount_code}:`, error);
                }
                break;
        }
        return null;
    }
    async extractDiscountDataFromPayments(payments) {
        const invoiceGroups = new Map();
        payments.forEach(payment => {
            const invoice = payment.Invoice || payment.invoice || '';
            if (!invoiceGroups.has(invoice)) {
                invoiceGroups.set(invoice, []);
            }
            invoiceGroups.get(invoice).push(payment);
        });
        const discountData = [];
        for (const [invoiceNumber, invoicePayments] of Array.from(invoiceGroups.entries())) {
            if (!invoiceNumber)
                continue;
            const discountItems = invoicePayments.filter(p => parseFloat(p.Amount || '0') < 0 &&
                p.Memo &&
                p.Memo.toLowerCase().includes('discount'));
            if (discountItems.length === 0)
                continue;
            const totalAmount = invoicePayments
                .filter(p => parseFloat(p.Amount || '0') > 0)
                .reduce((sum, p) => sum + parseFloat(p.Amount || '0'), 0);
            const discountAmount = Math.abs(discountItems
                .reduce((sum, p) => sum + parseFloat(p.Amount || '0'), 0));
            const discountPercentage = totalAmount > 0 ? (discountAmount / totalAmount) * 100 : 0;
            const discountMemo = discountItems[0].Memo || '';
            const discountMatch = await this.classifyDiscount(discountMemo);
            const effectiveAmount = totalAmount - discountAmount;
            discountData.push({
                invoice_number: invoiceNumber,
                customer: invoicePayments[0].Customer || '',
                date: invoicePayments[0].Date || '',
                total_amount: totalAmount,
                discount_amount: discountAmount,
                discount_percentage: discountPercentage,
                discount_name: discountMatch?.discount.name || discountMemo,
                coach_payment_type: discountMatch?.discount.coach_payment_type || 'partial',
                effective_amount: effectiveAmount
            });
        }
        return discountData;
    }
    applyDiscountToPayment(baseAmount, discountData, sessionCount = 1) {
        if (!discountData) {
            return {
                effectiveAmount: baseAmount,
                perSessionAmount: baseAmount / sessionCount,
                coachPaymentType: 'full'
            };
        }
        switch (discountData.coach_payment_type) {
            case 'full':
                return {
                    effectiveAmount: baseAmount,
                    perSessionAmount: baseAmount / sessionCount,
                    coachPaymentType: 'full'
                };
            case 'partial':
                return {
                    effectiveAmount: discountData.effective_amount,
                    perSessionAmount: discountData.effective_amount / sessionCount,
                    coachPaymentType: 'partial'
                };
            case 'free':
                return {
                    effectiveAmount: 0,
                    perSessionAmount: 0,
                    coachPaymentType: 'free'
                };
            default:
                return {
                    effectiveAmount: baseAmount,
                    perSessionAmount: baseAmount / sessionCount,
                    coachPaymentType: 'full'
                };
        }
    }
    async createDiscount(discount) {
        const newDiscount = {
            ...discount,
            id: Date.now(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        // Append a single row instead of rewriting entire sheet
        const existing = await this.googleSheetsService.readSheet('discounts');
        const headers = existing[0] ? Object.keys(existing[0]) : Object.keys(newDiscount);
        const rowObject = { ...headers.reduce((o, k) => ({ ...o, [k]: '' }), {}), ...newDiscount };
        await this.googleSheetsService.appendRow('discounts', rowObject);
        await this.refreshDiscounts();
        return newDiscount;
    }
    async updateDiscount(id, updates) {
        const currentDiscounts = await this.googleSheetsService.readSheet('discounts');
        const index = currentDiscounts.findIndex(d => d.id === id);
        if (index === -1) {
            throw new Error(`Discount with ID ${id} not found`);
        }
        const updatedDiscount = {
            ...currentDiscounts[index],
            ...updates,
            updated_at: new Date().toISOString()
        };
        await this.googleSheetsService.updateRowByIndex('discounts', index, updatedDiscount);
        await this.refreshDiscounts();
        return updatedDiscount;
    }
    async deleteDiscount(id) {
        const currentDiscounts = await this.googleSheetsService.readSheet('discounts');
        const index = currentDiscounts.findIndex(d => d.id === id);
        if (index === -1) {
            throw new Error(`Discount with ID ${id} not found`);
        }
        // Data index corresponds to first data row (after header)
        const sheetRowStartIndex = index + 1;
        await this.googleSheetsService.deleteRow('discounts', sheetRowStartIndex);
        await this.refreshDiscounts();
    }
}
exports.DiscountService = DiscountService;
exports.discountService = new DiscountService();
//# sourceMappingURL=discountService.js.map