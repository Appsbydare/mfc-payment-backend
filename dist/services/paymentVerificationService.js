"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentVerificationService = exports.PaymentVerificationService = void 0;
const googleSheets_1 = require("./googleSheets");
const ruleService_1 = require("./ruleService");
const discountService_1 = require("./discountService");
const MASTER_SHEET = 'payment_calc_detail';
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
    countAttendanceRecordsForInvoice(invoiceNumber, masterData) {
        if (!invoiceNumber || !masterData || !Array.isArray(masterData)) {
            return 0;
        }
        const invoiceStr = String(invoiceNumber).trim();
        return masterData.filter(row => {
            const rowInvoice = String(row['Invoice #'] || row.invoiceNumber || '').trim();
            return rowInvoice === invoiceStr;
        }).length;
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
    async buildRowFromPayments(invoiceNumber, rows, rules) {
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
        const discountAmountRaw = discountRows.reduce((sum, row) => sum + Math.abs(parseAmount(row.Amount)), 0);
        const taxAmount = taxRows.reduce((sum, row) => sum + parseAmount(row.Amount), 0);
        let discountPercentage = 0;
        let discountEffectiveAmount = paymentsTotal - discountAmountRaw;
        try {
            const discountInfo = await discountService_1.discountService.extractDiscountDataFromPayments(rows);
            const discountEntry = Array.isArray(discountInfo)
                ? discountInfo.find((d) => String(d?.invoice_number || '').trim() === invoiceNumber) || discountInfo[0]
                : null;
            if (discountEntry) {
                if (typeof discountEntry.discount_percentage === 'number') {
                    discountPercentage = Number(discountEntry.discount_percentage) || 0;
                }
                if (typeof discountEntry.discount_amount === 'number') {
                    const effective = Number(discountEntry.effective_amount);
                    if (Number.isFinite(effective)) {
                        discountEffectiveAmount = effective;
                    }
                }
            }
        }
        catch (error) {
            console.warn(`⚠️ Failed to extract discount metadata for invoice ${invoiceNumber}:`, error?.message || error);
        }
        if (discountPercentage === 0 && paymentsTotal > 0 && discountAmountRaw > 0) {
            discountPercentage = (discountAmountRaw / paymentsTotal) * 100;
        }
        const discountAmount = round2(discountAmountRaw);
        const effectiveFinal = round2(discountEffectiveAmount);
        const netPriceRaw = paymentsTotal - taxAmount - discountAmountRaw;
        const netPrice = netPriceRaw < 0 ? 0 : round2(netPriceRaw);
        const rule = this.findRuleForPackage(basePayment.Memo || '', rules);
        const sessionsRaw = rule && Number(rule.sessions_per_pack || rule.sessions || 0) > 0
            ? Number(rule.sessions_per_pack || rule.sessions || 0)
            : 0;
        // Ensure sessions is always an integer (round down to prevent over-linking)
        const sessions = Math.floor(sessionsRaw);
        if (sessionsRaw !== sessions && sessionsRaw > 0) {
            console.warn(`⚠️ Invoice ${invoiceNumber}: sessions_per_pack was ${sessionsRaw}, rounded down to ${sessions}`);
        }
        const discountedSessionPrice = sessions > 0 ? round2(Math.max(netPrice, 0) / sessions) : 0;
        return {
            invoice: String(invoiceNumber || '').trim(),
            date: basePayment.Date || '',
            amount: round2(paymentsTotal),
            customer: basePayment.Customer || '',
            package: basePayment.Memo || '',
            discount: discountRows.length > 0 ? (discountRows[0]?.Memo || '') : '',
            discountAmount,
            tax: round2(taxAmount),
            discountPercentage: round2(discountPercentage),
            finalPrice: effectiveFinal < 0 ? 0 : effectiveFinal,
            netPrice,
            numberOfSessions: sessions,
            discountedSessionPrice,
        };
    }
    async getPaymentVerificationTable() {
        try {
            const [payments, rules, masterData] = await Promise.all([
                googleSheets_1.googleSheetsService.readSheet(PAYMENT_SHEET),
                this.getRules(),
                googleSheets_1.googleSheetsService.readSheet(MASTER_SHEET).catch(() => [])
            ]);
            if (!Array.isArray(payments) || payments.length === 0) {
                return [];
            }
            const verifiedInvoices = new Set((masterData || [])
                .filter(row => {
                const status = String(row['Verification Status'] || row.verificationStatus || '').toLowerCase().trim();
                return status === 'verified';
            })
                .map(row => String(row['Invoice #'] || row.invoiceNumber || '').trim())
                .filter(Boolean));
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
                const tableRow = await this.buildRowFromPayments(invoice === '__NO_INVOICE__' ? '' : invoice, rows, rules);
                if (tableRow) {
                    tableRow.attendanceVerified = tableRow.invoice ? verifiedInvoices.has(tableRow.invoice) : false;
                    // Count consumed sessions and calculate pending sessions
                    const consumedSessions = this.countAttendanceRecordsForInvoice(tableRow.invoice, masterData);
                    const expectedSessions = tableRow.numberOfSessions || 0;
                    const pendingSessions = Math.max(0, expectedSessions - consumedSessions);
                    tableRow.consumedSessions = consumedSessions;
                    tableRow.pendingSessions = pendingSessions;
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

