import { GoogleSheetsService } from './googleSheets';
import { ruleService } from './ruleService';
import { discountService, InvoiceDiscountData } from './discountService';

type SessionType = 'group' | 'private';

export interface MasterRow {
  UniqueKey: string;
  Date: string;
  Time?: string;
  Customer: string;
  Membership: string;
  ClassType: string;
  Instructors: string;
  BookingMethod?: string;
  BookingSource?: string;
  Status?: string;

  Verified: boolean;
  VerificationStatus: 'Verified' | 'Not Verified' | 'Manually Verified';
  Category: string; // ok | info_mismatch | manual | etc.

  Invoice: string;
  PaymentDate: string;
  Amount: number;

  UnitPrice: number; // unit price from rules
  EffectiveAmount: number; // after discounts / allocation
  DiscountName?: string;
  ApplicablePercentage?: number;
  CoachPaymentType?: 'full' | 'partial' | 'free';

  CoachAmount: number;
  BgmAmount: number;
  ManagementAmount: number;
  MfcAmount: number;

  LinkedPaymentIds?: string; // comma-separated payment ids if available
  RuleId?: string;
  CoachPercent?: number;
  BgmPercent?: number;
  ManagementPercent?: number;
  MfcPercent?: number;

  RunAtISO: string;
}

function toDateOnly(value: any): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function classifySession(classType: string): SessionType {
  const t = String(classType || '').toLowerCase();
  return t.includes('private') ? 'private' : 'group';
}

function stripDiacritics(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeWhitespace(str: string): string {
  return str.replace(/\s+/g, ' ').trim();
}

function normalizeDashes(str: string): string {
  return str.replace(/[–—−]/g, '-');
}

function normalizeText(str: string): string {
  let s = String(str || '');
  s = stripDiacritics(s.toLowerCase());
  s = normalizeDashes(s);
  s = s.replace(/€/g, 'euro');
  s = s.replace(/\((?:[^)]*)\)/g, ' '); // drop parentheses content
  // common synonyms
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

function tokenize(str: string): string[] {
  return normalizeText(str).split(' ').filter(Boolean);
}

function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  const inter = new Set(Array.from(sa).filter(x => sb.has(x)));
  const union = new Set(Array.from(sa).concat(Array.from(sb)));
  if (union.size === 0) return 0;
  return inter.size / union.size;
}

function normalizeCustomer(name: string): string {
  return normalizeText(name);
}

function normalizePackageName(name: string): string {
  // Keep colon for 1 to 1: split variations
  return normalizeText(name);
}

export class VerificationMasterService {
  private readonly MASTER_SHEET = 'payment_calc_detail';
  private readonly ATTENDANCE_SHEET = 'attendance';
  private readonly PAYMENTS_SHEET = 'Payments';
  private sheets: GoogleSheetsService;

  constructor() {
    this.sheets = new GoogleSheetsService();
  }

  buildUniqueKey(input: {
    Date?: string; Customer?: string; Membership?: string; ClassType?: string; Instructors?: string;
  }): string {
    const parts = [input.Date || '', input.Customer || '', input.Membership || '', input.ClassType || '', input.Instructors || '']
      .map(p => normalizeText(p));
    return parts.join('|');
  }

  private async readSheets() {
    const [attendance, payments, master] = await Promise.all([
      this.sheets.readSheet(this.ATTENDANCE_SHEET).catch(() => []),
      this.sheets.readSheet(this.PAYMENTS_SHEET).catch(() => []),
      this.sheets.readSheet(this.MASTER_SHEET).catch(() => []),
    ]);
    return { attendance, payments, master };
  }

  private getPercentsFor(sessionType: SessionType, rule?: any) {
    const parseNum = (v: any, d = 0) => {
      const n = parseFloat(String(v).replace('%',''));
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
      bgm: parseNum(rule?.bgm_percentage, 15), // landlord for privates
      management: parseNum(rule?.management_percentage, 0),
      mfc: parseNum(rule?.mfc_percentage, 5),
    };
  }

  private getUnitPriceFromRule(rule: any): number {
    const unit = parseFloat(String(rule?.unit_price || ''));
    if (!isNaN(unit) && unit > 0) return +unit.toFixed(2);
    const price = parseFloat(String(rule?.price || ''));
    const sessions = parseFloat(String(rule?.sessions || ''));
    if (!isNaN(price) && !isNaN(sessions) && sessions > 0) return +(price / sessions).toFixed(2);
    return 0;
  }

  private categorizePayment(p: any): 'payment' | 'discount' | 'tax' | 'other' {
    const memo = String(p.Memo || '').toLowerCase();
    const amt = parseFloat(p.Amount || '0');
    if (memo.includes('fee') || memo.includes('tax')) return 'tax';
    if (amt < 0 || memo.includes('discount') || memo.includes('switch')) return 'discount';
    if (amt > 0) return 'payment';
    return 'other';
  }

  private findMatchingPayment(att: any, payments: any[]): { payment: any | null; discount: InvoiceDiscountData | undefined } {
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
        const diffDays = (pDate && date) ? Math.abs((pDate.getTime() - date.getTime()) / (1000*3600*24)) : 9999;
        const onOrBefore = (pDate && date) ? (pDate.getTime() <= date.getTime()) : false;
        return { p, sim, pDate, onOrBefore, diffDays };
      })
      .filter(x => x.sim >= 0.55);

    if (candidates.length === 0) return { payment: null, discount: undefined };

    candidates.sort((a, b) => {
      // Prefer higher similarity, then on-or-before, then closer date
      if (b.sim !== a.sim) return b.sim - a.sim;
      if (a.onOrBefore !== b.onOrBefore) return a.onOrBefore ? -1 : 1;
      return a.diffDays - b.diffDays;
    });

    const top = candidates[0];
    return { payment: top.p, discount: undefined };
  }

  async getMasterRows(): Promise<MasterRow[]> {
    const rows = await this.sheets.readSheet(this.MASTER_SHEET).catch(() => []);
    return rows as MasterRow[];
  }

  async syncMaster(): Promise<{ appended: number; rows: MasterRow[] }> {
    const { attendance, payments, master } = await this.readSheets();
    const hasUniqueKey = master.length > 0 && Object.prototype.hasOwnProperty.call(master[0], 'UniqueKey');
    const existingKeys = new Set<string>((hasUniqueKey ? master : []).map((r: any) => String(r.UniqueKey)));

    const nowIso = new Date().toISOString();
    const newRows: MasterRow[] = [];

    for (const a of attendance) {
      const uniqueKey = this.buildUniqueKey({
        Date: a.Date,
        Customer: a.Customer,
        Membership: a.Membership,
        ClassType: a.ClassType,
        Instructors: a.Instructors,
      });

      if (hasUniqueKey && existingKeys.has(uniqueKey)) continue;

      const sessionType = classifySession(a.ClassType);

      // Rule/unit price
      const rule = await ruleService.findMatchingRule(String(a.Membership || ''), sessionType);
      const sessionPrice = this.getUnitPriceFromRule(rule);
      const pct = this.getPercentsFor(sessionType, rule);

      // Payment match by customer + package similarity
      const { payment } = this.findMatchingPayment(a, payments);

      let discountData: InvoiceDiscountData | undefined = undefined;
      if (payment && payment.Invoice) {
        // Build discount map once per sync would be optimal; here we compute per invoice for simplicity
        const all = await discountService.extractDiscountDataFromPayments(
          payments.filter((p: any) => p.Invoice === payment.Invoice)
        );
        discountData = all[0];
      }

      const effectiveAmount = typeof discountData?.effective_amount === 'number'
        ? discountData!.effective_amount
        : (payment ? parseFloat(payment.Amount || '0') : 0);

      const chosen = sessionPrice > 0 ? sessionPrice : effectiveAmount;
      const coachAmount = +((chosen || 0) * (pct.coach / 100)).toFixed(2);
      const bgmAmount = +((chosen || 0) * ((sessionType === 'group' ? pct.bgm : pct.bgm) / 100)).toFixed(2);
      const managementAmount = +((chosen || 0) * (pct.management / 100)).toFixed(2);
      const mfcAmount = +((chosen || 0) * (pct.mfc / 100)).toFixed(2);

      const applicablePct = typeof discountData?.discount_percentage === 'number' ? +discountData!.discount_percentage.toFixed(2) : undefined;
      const coachPayType = discountData?.coach_payment_type as ('full' | 'partial' | 'free' | undefined);

      const row: MasterRow = {
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
        // Nothing to write
        return { appended: 0, rows: master as MasterRow[] };
      }
      await this.sheets.writeSheet(this.MASTER_SHEET, newRows);
      return { appended: newRows.length, rows: newRows };
    }

    if (newRows.length === 0) {
      return { appended: 0, rows: master as MasterRow[] };
    }

    const combined = [...master, ...newRows];
    await this.sheets.writeSheet(this.MASTER_SHEET, combined);
    return { appended: newRows.length, rows: combined as MasterRow[] };
  }

  async applyManualVerification(attendanceRow: any, invoiceNumber: string): Promise<void> {
    const master = await this.sheets.readSheet(this.MASTER_SHEET).catch(() => []);
    if (master.length === 0) return;
    const key = this.buildUniqueKey({
      Date: attendanceRow.Date,
      Customer: attendanceRow.Customer,
      Membership: attendanceRow.Membership,
      ClassType: attendanceRow.ClassType,
      Instructors: attendanceRow.Instructors,
    });
    const updated = (master as any[]).map(r => {
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

export const verificationMasterService = new VerificationMasterService();


