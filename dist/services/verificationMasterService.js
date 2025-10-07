"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verificationMasterService = exports.VerificationMasterService = void 0;
const googleSheets_1 = require("./googleSheets");
const ruleService_1 = require("./ruleService");
const discountService_1 = require("./discountService");
function toDateOnly(value) {
    if (!value)
        return null;
    const d = new Date(value);
    if (isNaN(d.getTime()))
        return null;
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function classifySession(classType) {
    const t = String(classType || '').toLowerCase();
    return t.includes('private') ? 'private' : 'group';
}
function stripDiacritics(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function normalizeWhitespace(str) {
    return str.replace(/\s+/g, ' ').trim();
}
function normalizeDashes(str) {
    return str.replace(/[–—−]/g, '-');
}
function normalizeText(str) {
    let s = String(str || '');
    s = stripDiacritics(s.toLowerCase());
    s = normalizeDashes(s);
    s = s.replace(/€/g, 'euro');
    s = s.replace(/\((?:[^)]*)\)/g, ' ');
    s = s.replace(/\bpayg\b/g, 'pay as you go');
    s = s.replace(/\bsingle session\b/g, 'single');
    s = s.replace(/\bunlimited plan\b/g, 'unlimited');
    s = s.replace(/\bloyalty only\b/g, 'loyalty');
    s = s.replace(/\bper week\b/g, 'x week');
    s = s.replace(/—/g, '-');
    s = s.replace(/[^a-z0-9: \-]/g, ' ');
    s = normalizeWhitespace(s);
    return s;
}
function tokenize(str) {
    return normalizeText(str).split(' ').filter(Boolean);
}
function jaccard(a, b) {
    const sa = new Set(a);
    const sb = new Set(b);
    const inter = new Set(Array.from(sa).filter(x => sb.has(x)));
    const union = new Set(Array.from(sa).concat(Array.from(sb)));
    if (union.size === 0)
        return 0;
    return inter.size / union.size;
}
function normalizeCustomer(name) {
    return normalizeText(name);
}
function normalizePackageName(name) {
    return normalizeText(name);
}
class VerificationMasterService {
    constructor() {
        this.MASTER_SHEET = 'payment_calc_detail';
        this.ATTENDANCE_SHEET = 'attendance';
        this.PAYMENTS_SHEET = 'Payments';
        this.sheets = new googleSheets_1.GoogleSheetsService();
    }
    buildUniqueKey(input) {
        const parts = [input.Date || '', input.Customer || '', input.Membership || '', input.ClassType || '', input.Instructors || '']
            .map(p => normalizeText(p));
        return parts.join('|');
    }
    async readSheets() {
        const [attendance, payments, master] = await Promise.all([
            this.sheets.readSheet(this.ATTENDANCE_SHEET).catch(() => []),
            this.sheets.readSheet(this.PAYMENTS_SHEET).catch(() => []),
            this.sheets.readSheet(this.MASTER_SHEET).catch(() => []),
        ]);
        return { attendance, payments, master };
    }
    getPercentsFor(sessionType, rule) {
        const parseNum = (v, d = 0) => {
            const n = parseFloat(String(v).replace('%', ''));
            return isNaN(n) ? d : n;
        };
        if (sessionType === 'group') {
            return {
                coach: parseNum(rule?.coach_percentage, 43.5),
                bgm: parseNum(rule?.bgm_percentage, 30),
                management: parseNum(rule?.management_percentage, 8.5),
                mfc: parseNum(rule?.mfc_percentage, 18),
            };
        }
        return {
            coach: parseNum(rule?.coach_percentage, 80),
            bgm: parseNum(rule?.bgm_percentage, 15),
            management: parseNum(rule?.management_percentage, 0),
            mfc: parseNum(rule?.mfc_percentage, 5),
        };
    }
    getUnitPriceFromRule(rule) {
        const unit = parseFloat(String(rule?.unit_price || ''));
        if (!isNaN(unit) && unit > 0)
            return +unit.toFixed(2);
        const price = parseFloat(String(rule?.price || ''));
        const sessions = parseFloat(String(rule?.sessions || ''));
        if (!isNaN(price) && !isNaN(sessions) && sessions > 0)
            return +(price / sessions).toFixed(2);
        return 0;
    }
    categorizePayment(p) {
        const memo = String(p.Memo || '').toLowerCase();
        const amt = parseFloat(p.Amount || '0');
        if (memo.includes('fee') || memo.includes('tax'))
            return 'tax';
        if (amt < 0 || memo.includes('discount') || memo.includes('switch'))
            return 'discount';
        if (amt > 0)
            return 'payment';
        return 'other';
    }
    findMatchingPayment(att, payments) {
        const customerN = normalizeCustomer(att.Customer);
        const pkgN = normalizePackageName(att.Membership);
        const date = toDateOnly(att.Date);
        const candidates = payments
            .filter(p => this.categorizePayment(p) === 'payment')
            .filter(p => normalizeCustomer(p.Customer) === customerN)
            .map(p => {
            const memoN = normalizePackageName(p.Memo || '');
            const sim = jaccard(tokenize(pkgN), tokenize(memoN));
            const pDate = toDateOnly(p.Date);
            const diffDays = (pDate && date) ? Math.abs((pDate.getTime() - date.getTime()) / (1000 * 3600 * 24)) : 9999;
            const onOrBefore = (pDate && date) ? (pDate.getTime() <= date.getTime()) : false;
            return { p, sim, pDate, onOrBefore, diffDays };
        })
            .filter(x => x.sim >= 0.55);
        if (candidates.length === 0)
            return { payment: null, discount: undefined };
        candidates.sort((a, b) => {
            if (b.sim !== a.sim)
                return b.sim - a.sim;
            if (a.onOrBefore !== b.onOrBefore)
                return a.onOrBefore ? -1 : 1;
            return a.diffDays - b.diffDays;
        });
        const top = candidates[0];
        return { payment: top.p, discount: undefined };
    }
    async getMasterRows() {
        const rows = await this.sheets.readSheet(this.MASTER_SHEET).catch(() => []);
        return rows;
    }
    async syncMaster() {
        const { attendance, payments, master } = await this.readSheets();
        const hasUniqueKey = master.length > 0 && Object.prototype.hasOwnProperty.call(master[0], 'UniqueKey');
        const existingKeys = new Set((hasUniqueKey ? master : []).map((r) => String(r.UniqueKey)));
        const nowIso = new Date().toISOString();
        const newRows = [];
        for (const a of attendance) {
            const uniqueKey = this.buildUniqueKey({
                Date: a.Date,
                Customer: a.Customer,
                Membership: a.Membership,
                ClassType: a.ClassType,
                Instructors: a.Instructors,
            });
            if (hasUniqueKey && existingKeys.has(uniqueKey))
                continue;
            const sessionType = classifySession(a.ClassType);
            const rule = await ruleService_1.ruleService.findMatchingRule(String(a.Membership || ''), sessionType);
            const sessionPrice = this.getUnitPriceFromRule(rule);
            const pct = this.getPercentsFor(sessionType, rule);
            const { payment } = this.findMatchingPayment(a, payments);
            let discountData = undefined;
            if (payment && payment.Invoice) {
                const all = await discountService_1.discountService.extractDiscountDataFromPayments(payments.filter((p) => p.Invoice === payment.Invoice));
                discountData = all[0];
            }
            const effectiveAmount = typeof discountData?.effective_amount === 'number'
                ? discountData.effective_amount
                : (payment ? parseFloat(payment.Amount || '0') : 0);
            const chosen = sessionPrice > 0 ? sessionPrice : effectiveAmount;
            const coachAmount = +((chosen || 0) * (pct.coach / 100)).toFixed(2);
            const bgmAmount = +((chosen || 0) * ((sessionType === 'group' ? pct.bgm : pct.bgm) / 100)).toFixed(2);
            const managementAmount = +((chosen || 0) * (pct.management / 100)).toFixed(2);
            const mfcAmount = +((chosen || 0) * (pct.mfc / 100)).toFixed(2);
            const applicablePct = typeof discountData?.discount_percentage === 'number' ? +discountData.discount_percentage.toFixed(2) : undefined;
            const coachPayType = discountData?.coach_payment_type;
            const row = {
                UniqueKey: uniqueKey,
                Date: a.Date || '',
                Time: a.Time || '',
                Customer: a.Customer || '',
                Membership: a.Membership || '',
                ClassType: a.ClassType || '',
                Instructors: a.Instructors || '',
                BookingMethod: a.BookingMethod || '',
                BookingSource: a.BookingSource || '',
                Status: a.Status || '',
                Verified: !!payment,
                VerificationStatus: payment ? 'Verified' : 'Not Verified',
                Category: payment ? 'ok' : 'info_mismatch',
                Invoice: payment?.Invoice || '',
                PaymentDate: payment?.Date || '',
                Amount: payment ? parseFloat(payment.Amount || '0') || 0 : 0,
                UnitPrice: sessionPrice,
                EffectiveAmount: chosen || 0,
                DiscountName: discountData?.discount_name || '',
                ...(applicablePct !== undefined ? { ApplicablePercentage: applicablePct } : {}),
                ...(coachPayType !== undefined ? { CoachPaymentType: coachPayType } : {}),
                CoachAmount: coachAmount,
                BgmAmount: bgmAmount,
                ManagementAmount: managementAmount,
                MfcAmount: mfcAmount,
                LinkedPaymentIds: payment ? String(payment.Invoice || '') : '',
                RuleId: rule ? String(rule.id) : '',
                CoachPercent: pct.coach,
                BgmPercent: pct.bgm,
                ManagementPercent: pct.management,
                MfcPercent: pct.mfc,
                RunAtISO: nowIso,
            };
            newRows.push(row);
        }
        if (master.length === 0 || !hasUniqueKey) {
            if (newRows.length === 0) {
                return { appended: 0, rows: master };
            }
            await this.sheets.writeSheet(this.MASTER_SHEET, newRows);
            return { appended: newRows.length, rows: newRows };
        }
        if (newRows.length === 0) {
            return { appended: 0, rows: master };
        }
        const combined = [...master, ...newRows];
        await this.sheets.writeSheet(this.MASTER_SHEET, combined);
        return { appended: newRows.length, rows: combined };
    }
    async applyManualVerification(attendanceRow, invoiceNumber) {
        const master = await this.sheets.readSheet(this.MASTER_SHEET).catch(() => []);
        if (master.length === 0)
            return;
        const key = this.buildUniqueKey({
            Date: attendanceRow.Date,
            Customer: attendanceRow.Customer,
            Membership: attendanceRow.Membership,
            ClassType: attendanceRow.ClassType,
            Instructors: attendanceRow.Instructors,
        });
        const updated = master.map(r => {
            if (String(r.UniqueKey || '') === key) {
                return {
                    ...r,
                    Verified: true,
                    VerificationStatus: 'Manually Verified',
                    Category: 'manual',
                    Invoice: invoiceNumber,
                };
            }
            return r;
        });
        await this.sheets.writeSheet(this.MASTER_SHEET, updated);
    }
}
exports.VerificationMasterService = VerificationMasterService;
exports.verificationMasterService = new VerificationMasterService();
//# sourceMappingURL=verificationMasterService.js.map