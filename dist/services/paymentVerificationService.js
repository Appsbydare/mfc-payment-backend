"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentVerificationService = exports.PaymentVerificationService = void 0;
const googleSheets_1 = require("./googleSheets");
const ruleService_1 = require("./ruleService");
const PAYMENT_SHEET = 'Payments';
const round2 = (value) => {
    const num = Number.parseFloat(String(value));
    if (!Number.isFinite(num))
        return 0;
    return Math.round(num * 100) / 100;
};
const normalizeText = (value) => String(value || '').trim().toLowerCase();
const parseAmount = (value) => {
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            return 0;
        return value;
    }
    if (typeof value === 'string') {
        const cleaned = value.replace(/[^0-9.-]+/g, '');
        const parsed = Number.parseFloat(cleaned);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
};
const isFeeRow = (row) => normalizeText(row?.Memo).includes('fee') || normalizeText(row?.Memo).includes('tax');
const isDiscountRow = (row) => {
    const memo = normalizeText(row?.Memo);
    const amount = parseAmount(row?.Amount);
    return amount < 0 || memo.includes('discount') || memo.includes('switch') || memo.includes('promo');
};
const isPaymentRow = (row) => {
    if (!row)
        return false;
    const amount = parseAmount(row.Amount);
    return amount > 0 && !isFeeRow(row);
};
class PaymentVerificationService {
    constructor() {
        this.rulesCache = null;
        this.rulesCacheTimestamp = 0;
    }
    async getRules() {
        const now = Date.now();
        // refresh cache every 5 minutes
        if (this.rulesCache && now - this.rulesCacheTimestamp < 5 * 60 * 1000) {
            return this.rulesCache;
        }
        try {
            const rules = await ruleService_1.ruleService.getAllRules();
            this.rulesCache = Array.isArray(rules) ? rules : [];
            this.rulesCacheTimestamp = now;
        }
        catch (error) {
            console.error('❌ Failed to load rules for payment verification table:', error);
            this.rulesCache = [];
            this.rulesCacheTimestamp = now;
        }
        return this.rulesCache;
    }
    findRuleForPackage(packageName, rules) {
        if (!packageName)
            return null;
        const normalized = normalizeText(packageName);
        if (!normalized)
            return null;
        let bestMatch = null;
        let bestScore = 0;
        for (const rule of rules) {
            const ruleName = normalizeText(rule?.package_name || rule?.rule_name || '');
            const alias = normalizeText(rule?.attendance_alias || rule?.payment_memo_alias || '');
            const candidates = [ruleName, alias].filter(Boolean);
            for (const candidate of candidates) {
                if (!candidate)
                    continue;
                if (normalized === candidate) {
                    return rule;
                }
                if (normalized.includes(candidate) || candidate.includes(normalized)) {
                    const score = Math.max(candidate.length, normalized.length);
                    if (score > bestScore) {
                        bestScore = score;
                        bestMatch = rule;
                    }
                }
            }
        }
        return bestMatch;
    }
    buildRowFromPayments(invoiceNumber, rows, rules) {
        if (!Array.isArray(rows) || rows.length === 0) {
            return null;
        }
        const basePayment = rows.find(isPaymentRow) ||
            rows.slice().sort((a, b) => parseAmount(b.Amount) - parseAmount(a.Amount))[0];
        if (!basePayment) {
            return null;
        }
        const paymentsTotal = rows
            .filter(isPaymentRow)
            .reduce((sum, row) => sum + parseAmount(row.Amount), 0);
        const discountRows = rows.filter(isDiscountRow);
        const taxRows = rows.filter(isFeeRow);
        const discountAmount = discountRows.reduce((sum, row) => sum + Math.abs(parseAmount(row.Amount)), 0);
        const taxAmount = taxRows.reduce((sum, row) => sum + parseAmount(row.Amount), 0);
        const effectiveFinal = round2(paymentsTotal - discountAmount);
        const rule = this.findRuleForPackage(basePayment.Memo || '', rules);
        const sessions = rule && Number(rule.sessions_per_pack || rule.sessions || 0) > 0
            ? Number(rule.sessions_per_pack || rule.sessions || 0)
            : 0;
        const discountedSessionPrice = sessions > 0 ? round2(effectiveFinal / sessions) : 0;
        return {
            invoice: String(invoiceNumber || '').trim(),
            date: basePayment.Date || '',
            amount: round2(parseAmount(basePayment.Amount)),
            customer: basePayment.Customer || '',
            package: basePayment.Memo || '',
            discount: discountRows.length > 0 ? (discountRows[0]?.Memo || '') : '',
            discountAmount: round2(discountAmount),
            tax: round2(taxAmount),
            finalPrice: effectiveFinal < 0 ? 0 : effectiveFinal,
            numberOfSessions: sessions,
            discountedSessionPrice,
        };
    }
    async getPaymentVerificationTable() {
        try {
            const [payments, rules] = await Promise.all([
                googleSheets_1.googleSheetsService.readSheet(PAYMENT_SHEET),
                this.getRules(),
            ]);
            if (!Array.isArray(payments) || payments.length === 0) {
                return [];
            }
            const byInvoice = new Map();
            payments.forEach((row) => {
                const invoice = String(row?.Invoice || '').trim() || '__NO_INVOICE__';
                if (!byInvoice.has(invoice)) {
                    byInvoice.set(invoice, []);
                }
                byInvoice.get(invoice).push(row);
            });
            const result = [];
            for (const [invoice, rows] of Array.from(byInvoice.entries())) {
                const tableRow = this.buildRowFromPayments(invoice === '__NO_INVOICE__' ? '' : invoice, rows, rules);
                if (tableRow) {
                    result.push(tableRow);
                }
            }
            result.sort((a, b) => {
                const dateA = new Date(a.date);
                const dateB = new Date(b.date);
                if (!Number.isFinite(dateA.getTime()) && !Number.isFinite(dateB.getTime())) {
                    return a.invoice.localeCompare(b.invoice);
                }
                if (!Number.isFinite(dateA.getTime()))
                    return 1;
                if (!Number.isFinite(dateB.getTime()))
                    return -1;
                return dateB.getTime() - dateA.getTime();
            });
            return result;
        }
        catch (error) {
            console.error('❌ Failed to build payment verification table:', error);
            throw new Error(error?.message || 'Failed to load payment verification table');
        }
    }
}
exports.PaymentVerificationService = PaymentVerificationService;
exports.paymentVerificationService = new PaymentVerificationService();

