import { googleSheetsService } from './googleSheets';
import { ruleService } from './ruleService';
import { discountService } from './discountService';

// Master table row structure based on the image requirements
export interface AttendanceVerificationMasterRow {
  // From Attendance Data
  customerName: string;
  eventStartsAt: string;
  membershipName: string;
  instructors: string;
  status: string;
  
  // From Payment Data (matching)
  discount: string;
  discountPercentage: number;
  verificationStatus: 'Verified' | 'Not Verified';
  invoiceNumber: string;
  amount: number;
  paymentDate: string;
  
  // Calculated fields based on Rules + Discount information
  packagePrice: number; // From rules sheet column E (price)
  sessionPrice: number; // Original unit_price from rules (column H)
  discountedSessionPrice: number; // Session price after applying discounts
  coachAmount: number;
  bgmAmount: number;
  managementAmount: number;
  mfcAmount: number;
  
  // Internal tracking
  uniqueKey: string;
  createdAt: string;
  updatedAt: string;
}

// Raw data interfaces
export interface AttendanceRecord {
  Customer: string;
  'Customer Email': string;
  'Event Starts At': string;
  'Offering Type Name': string;
  'Venue Name': string;
  Instructors: string;
  'Booking Method': string;
  'Customer Membership ID': string;
  'Membership ID': string;
  'Membership Name': string;
  'Booking Source': string;
  Status: string;
  'Checkin Timestamp': string;
  Date?: string; // Normalized date field
}

export interface PaymentRecord {
  Date: string;
  Customer: string;
  Memo: string;
  Amount: string | number;
  Invoice: string;
  Category?: string;
  IsVerified?: string | boolean;
}

export interface VerificationResult {
  masterRows: AttendanceVerificationMasterRow[];
  summary: {
    totalRecords: number;
    verifiedRecords: number;
    unverifiedRecords: number;
    verificationRate: number;
    newRecordsAdded: number;
  };
}

export class AttendanceVerificationService {
  private readonly MASTER_SHEET = 'payment_calc_detail';
  private readonly ATTENDANCE_SHEET = 'attendance';
  private readonly PAYMENTS_SHEET = 'Payments';
  private readonly RULES_SHEET = 'rules';
  private readonly DISCOUNTS_SHEET = 'discounts';

  /**
   * Main verification method - processes attendance and payment data
   * and creates/updates the master verification table
   */
  async verifyAttendanceData(params: {
    fromDate?: string;
    toDate?: string;
    forceReverify?: boolean;
  } = {}): Promise<VerificationResult> {
    try {
      console.log('🔍 Starting attendance verification process...');
      
      // Load all required data
      const { attendance, payments, rules, discounts } = await this.loadAllData();
      
      // Filter data by date range if provided
      const filteredAttendance = this.filterAttendanceByDate(attendance, params.fromDate, params.toDate);
      const filteredPayments = this.filterPaymentsByDate(payments, params.fromDate, params.toDate);
      
      console.log(`📊 Processing ${filteredAttendance.length} attendance records and ${filteredPayments.length} payment records`);
      
      // Load existing master data
      const existingMaster = await this.loadExistingMasterData();
      const existingKeys = new Set(existingMaster.map(row => row.uniqueKey));
      
      // Build a map of existing rows by uniqueKey to avoid duplicates
      const existingByKey = new Map(existingMaster.map(r => [r.uniqueKey, r] as const));
      const newMasterRows: AttendanceVerificationMasterRow[] = [];
      let processedCount = 0;
      
      for (const attendanceRecord of filteredAttendance) {
        // Skip if already processed and not forcing reverification
        const uniqueKey = this.generateUniqueKey(attendanceRecord);
        if (!params.forceReverify && existingKeys.has(uniqueKey)) continue;
        
        const masterRow = await this.processAttendanceRecord(
          attendanceRecord,
          filteredPayments,
          rules,
          discounts
        );
        
        // Upsert: replace existing or add new
        if (existingByKey.has(masterRow.uniqueKey)) {
          existingByKey.set(masterRow.uniqueKey, masterRow);
        } else {
          existingByKey.set(masterRow.uniqueKey, masterRow);
          newMasterRows.push(masterRow);
        }
        processedCount++;
      }
      
      // Combine into a stable array
      let allMasterRows = Array.from(existingByKey.values());

      // Apply discount identification at the end using payments + discounts
      allMasterRows = this.applyDiscountsFromPayments(allMasterRows, filteredPayments, discounts);
      
      // Save to Google Sheets
      if (params.forceReverify || newMasterRows.length > 0) {
        await this.saveMasterData(allMasterRows);
        console.log(`✅ Saved ${params.forceReverify ? allMasterRows.length : newMasterRows.length} verification records`);
      }
      
      // Calculate summary
      const summary = this.calculateSummary(allMasterRows);
      
      console.log(`🎯 Verification complete: ${summary.verifiedRecords}/${summary.totalRecords} verified (${summary.verificationRate.toFixed(1)}%)`);
      
      return {
        masterRows: allMasterRows,
        summary
      };
      
    } catch (error: any) {
      console.error('❌ Error in attendance verification:', error);
      throw new Error(`Attendance verification failed: ${error?.message || 'Unknown error'}`);
    }
  }

  /**
   * Load existing master data from Google Sheets
   */
  async loadExistingMasterData(): Promise<AttendanceVerificationMasterRow[]> {
    try {
      const data = await googleSheetsService.readSheet(this.MASTER_SHEET);
      return data.map(row => this.normalizeMasterRow(row));
    } catch (error) {
      console.log('📝 No existing master data found, starting fresh');
      return [];
    }
  }

  /**
   * Load all required data from Google Sheets
   */
  private async loadAllData() {
    const [attendance, payments, rawRules, discounts] = await Promise.all([
      googleSheetsService.readSheet(this.ATTENDANCE_SHEET).catch(() => []),
      googleSheetsService.readSheet(this.PAYMENTS_SHEET).catch(() => []),
      googleSheetsService.readSheet(this.RULES_SHEET).catch(() => []),
      googleSheetsService.readSheet(this.DISCOUNTS_SHEET).catch(() => [])
    ]);

    // Normalize rules using the same logic as the rules API
    const normalizedRules = this.normalizeRules(rawRules);

    return { attendance, payments, rules: normalizedRules, discounts };
  }

  /**
   * Normalize rules data using the same logic as the rules API
   */
  private normalizeRules(rawRules: any[]): any[] {
    if (!rawRules || rawRules.length === 0) return [];

    const toNum = (v: any, d: number | null = 0): number | null => {
      const n = parseFloat(String(v).replace('%', ''));
      return isNaN(n) ? d : n;
    };

    return rawRules.map((r: any) => ({
      id: String(r.id || r.ID || '').trim() || '',
      rule_name: String(r.rule_name || r.name || r.rule || '').trim(),
      package_name: String(r.package_name || r.membership_name || r.name || '').trim(),
      session_type: (() => {
        const raw = String((r.session_type ?? r.category ?? '') as any).trim().toLowerCase();
        if (raw) {
          if (/^priv/.test(raw)) return 'private';
          if (/^group/.test(raw)) return 'group';
        }
        const privateFlag = String((r.privateSession ?? '') as any).toLowerCase();
        if (privateFlag === 'true' || privateFlag === '1') return 'private';
        return 'group';
      })(),
      price: toNum(r.price),
      sessions: toNum(r.sessions),
      sessions_per_pack: toNum(r.sessions_per_pack || r.sessions),
      unit_price: toNum(r.unit_price, null), // Use exact unit_price from database, no calculation
      coach_percentage: toNum(r.coach_percentage || r.coachPct, null),
      bgm_percentage: toNum(r.bgm_percentage || r.bgmPct, null),
      management_percentage: toNum(r.management_percentage || r.mgmtPct, null),
      mfc_percentage: toNum(r.mfc_percentage || r.mfcPct, null),
      pricing_type: String(r.pricing_type || '').trim().toLowerCase(),
      per_week: toNum(r.per_week),
      fixed_rate: toNum(r.fixed_rate),
      match_offering_patterns: String(r.match_offering_patterns || '').trim(),
      allow_late_payment_window_days: String(r.allow_late_payment_window_days || '').trim(),
      is_fixed_rate: String(r.is_fixed_rate || r.fixed || '').trim(),
      allow_discounts: String(r.allow_discounts || r.allowDiscounts || '').trim(),
      notes: String(r.notes || '').trim(),
      // Alias fields for exact matching in verification
      attendance_alias: String(r.attendance_alias || r.attendanceAlias || '').trim(),
      payment_memo_alias: String(r.payment_memo_alias || r.paymentMemoAlias || '').trim(),
      created_at: r.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
  }


  /**
   * Process a single attendance record and create master row
   */
  private async processAttendanceRecord(
    attendance: AttendanceRecord,
    payments: PaymentRecord[],
    rules: any[],
    discounts: any[]
  ): Promise<AttendanceVerificationMasterRow> {
    
    // Normalize attendance data
    const customerName = this.getField(attendance as any, ['Customer Name','Customer']) || '';
    const eventStartsAt = this.getField(attendance as any, ['Event Starts At','EventStartAt','EventStart','Date']) || '';
    const membershipName = this.getField(attendance as any, ['Membership Name','Membership','MembershipName']) || '';
    const instructors = this.getField(attendance as any, ['Instructors','Instructor']) || '';
    const status = this.getField(attendance as any, ['Status']) || '';
    
    // Find matching payment record
    const matchingPayment = this.findMatchingPayment(attendance, payments, rules);
    
    // Determine verification status
    const verificationStatus = matchingPayment ? 'Verified' : 'Not Verified';
    
    // Extract payment data
    const invoiceNumber = matchingPayment?.Invoice || '';
    const amount = matchingPayment ? parseFloat(String(matchingPayment.Amount)) : 0;
    const paymentDate = matchingPayment?.Date || '';
    
    // Calculate based on Rules first, then apply Discounts
    const sessionType = this.classifySessionType(attendance['Offering Type Name'] || '');
    const rule = this.findMatchingRule(membershipName, sessionType, rules);
    
    // Debug logging
    console.log(`🔍 Processing: ${membershipName} (${sessionType})`);
    console.log(`📋 Rule found:`, rule ? {
      id: rule.id,
      rule_name: rule.rule_name,
      package_name: rule.package_name,
      attendance_alias: rule.attendance_alias,
      unit_price: rule.unit_price,
      price: rule.price,
      sessions: rule.sessions
    } : 'No rule found');
    
    // Find applicable discount AFTER rule lookup
    const discountInfo = await this.findApplicableDiscount(matchingPayment, discounts);
    const discount = discountInfo?.name || '';
    const discountPercentage = discountInfo?.applicable_percentage || 0;
    
    // Get original session price from rule (column H) - this should NOT be modified
    const sessionPrice = rule ? this.round2(Number(rule.unit_price || 0)) : 0;
    console.log(`💰 Original Session Price: ${sessionPrice} (from rule: ${rule?.unit_price || 'N/A'})`);
    
    // Calculate discounted session price for calculations
    const discountedSessionPrice = this.round2(this.calculateDiscountedSessionPrice({ baseAmount: amount, rule, discountInfo }));
    console.log(`💸 Discounted Session Price: ${discountedSessionPrice} (original: ${sessionPrice}, discount: ${discountPercentage}%)`);
    
    // Use discounted session price for all calculations
    const amounts = this.calculateAmounts(discountedSessionPrice, rule, sessionType);
    
    // Get package price from rule (column E)
    const packagePrice = rule ? this.round2(Number(rule.price || 0)) : 0;
    console.log(`📦 Package Price: ${packagePrice} (from rule: ${rule?.price || 'N/A'})`);
    
    // Generate unique key
    const uniqueKey = this.generateUniqueKey(attendance);
    
    return {
      customerName,
      eventStartsAt,
      membershipName,
      instructors,
      status,
      discount,
      discountPercentage,
      verificationStatus,
      invoiceNumber,
      amount,
      paymentDate,
      packagePrice,
      sessionPrice,
      discountedSessionPrice,
      coachAmount: this.round2(amounts.coach),
      bgmAmount: this.round2(amounts.bgm),
      managementAmount: this.round2(amounts.management),
      mfcAmount: this.round2(amounts.mfc),
      uniqueKey,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  /**
   * Find matching payment record for attendance
   */
  private findMatchingPayment(attendance: AttendanceRecord, payments: PaymentRecord[], rules: any[] = []): PaymentRecord | null {
    const customerName = this.normalizeCustomerName(attendance.Customer);
    const membershipName = this.normalizeMembershipName(attendance['Membership Name']);
    const attendanceDate = this.parseDate(attendance['Event Starts At'] || attendance.Date || '');
    if (!attendanceDate) return null;

    const customerPayments = payments.filter(p => this.normalizeCustomerName(p.Customer) === customerName);
    let best: { p: PaymentRecord; score: number } | null = null;
    const memTokens = this.tokenize(membershipName);

    // Get potential payment_memo_aliases from rules for this membership
    const sessionType = this.classifySessionType(attendance['Offering Type Name'] || '');
    const relevantRules = rules.filter(r => r.session_type === sessionType);
    const paymentAliases = relevantRules
      .map(r => String(r.payment_memo_alias || '').trim())
      .filter(alias => alias.length > 0);

    for (const p of customerPayments) {
      const pd = this.parseDate(p.Date);
      if (!pd) continue;
      const sameDay = this.isSameDate(attendanceDate, pd) ? 1 : 0;
      const within7 = this.isWithinDays(attendanceDate, pd, 7) ? 0.7 : 0;
      const memo = String(p.Memo || '');
      
      let textScore = 0;
      
      // First, try exact matching with payment_memo_alias
      for (const alias of paymentAliases) {
        if (this.canonicalize(alias) === this.canonicalize(memo)) {
          textScore = 2.0; // Highest score for exact alias match
          break;
        }
      }
      
      // If no exact alias match, try fuzzy matching
      if (textScore === 0) {
        // Try fuzzy matching with payment_memo_alias first
        for (const alias of paymentAliases) {
          if (this.fuzzyContains(alias, memo)) {
            textScore = 1.8; // High score for fuzzy alias match
            break;
          }
        }
        
        // Fallback to membership name matching
        if (textScore === 0) {
          textScore = this.fuzzyContains(membershipName, memo) ? 1.5 : this.jaccard(memTokens, this.tokenize(memo));
        }
      }
      
      const score = Math.max(sameDay, within7) + textScore;
      if (!best || score > best.score) best = { p, score };
    }
    if (best && best.score >= 1.1) return best.p;
    return null;
  }

  /**
   * Find applicable discount for payment
   */
  private async findApplicableDiscount(payment: PaymentRecord | null, discounts: any[]): Promise<any | null> {
    if (!payment) return null;
    
    const memo = String(payment.Memo || '');
    const amount = parseFloat(String(payment.Amount || '0')) || 0;
    
    // Look for exact discount code match
    for (const discount of discounts) {
      if (discount && discount.active && discount.discount_code) {
        if (memo.toLowerCase().includes(String(discount.discount_code).toLowerCase())) {
          return discount;
        }
      }
    }
    
    // Look for generic discount indicators
    if (memo.toLowerCase().includes('discount') || amount < 0) {
      return discounts.find(d => d.discount_code === 'discount') || null;
    }
    
    return null;
  }

  /**
   * Calculate discounted session price for calculations (original session price remains unchanged)
   */
  private calculateDiscountedSessionPrice(params: { baseAmount: number; rule: any; discountInfo: any }): number {
    const { rule, discountInfo } = params;
    
    // Use exact unit_price from the rules database as base
    let price = 0;
    if (rule && rule.unit_price !== null && rule.unit_price !== undefined && rule.unit_price > 0) {
      price = Number(rule.unit_price);
      console.log(`✅ Using exact unit_price from database: ${price}`);
    } else {
      // Only use payment amount if no unit_price is set in the rule
      price = Number(params.baseAmount || 0);
      console.log(`⚠️ No unit_price in rule, using payment amount: ${price}`);
    }
    
    // Apply discount to get discounted price for calculations
    if (!discountInfo) return price;
    const pct = Number(discountInfo.applicable_percentage || 0);
    const type = String(discountInfo.coach_payment_type || 'partial').toLowerCase();
    
    if (type === 'free') return 0;
    if (type === 'full') return price; // treat as normal full price
    if (type === 'partial' && pct > 0) {
      // Reduce price by discount percentage
      return price * (1 - pct / 100);
    }
    return price;
  }

  /**
   * Calculate amounts for coach, BGM, management, and MFC
   */
  private calculateAmounts(sessionPrice: number, rule: any, sessionType: string): {
    coach: number;
    bgm: number;
    management: number;
    mfc: number;
  } {
    if (!rule) {
      // Default percentages if no rule found
      const defaults = sessionType === 'private' 
        ? { coach: 80, bgm: 15, management: 0, mfc: 5 }
        : { coach: 43.5, bgm: 30, management: 8.5, mfc: 18 };
      
      return {
        coach: (sessionPrice * defaults.coach) / 100,
        bgm: (sessionPrice * defaults.bgm) / 100,
        management: (sessionPrice * defaults.management) / 100,
        mfc: (sessionPrice * defaults.mfc) / 100
      };
    }
    
    return {
      coach: (sessionPrice * rule.coach_percentage) / 100,
      bgm: (sessionPrice * rule.bgm_percentage) / 100,
      management: (sessionPrice * rule.management_percentage) / 100,
      mfc: (sessionPrice * rule.mfc_percentage) / 100
    };
  }

  /**
   * Find matching rule for membership and session type
   * Priority: attendance_alias (column W) > package_name > fuzzy matching
   */
  private findMatchingRule(membershipName: string, sessionType: string, rules: any[]): any | null {
    if (!rules || rules.length === 0) return null;
    const canonMembership = this.canonicalize(membershipName);

    console.log(`🔍 Looking for rule: "${membershipName}" (${sessionType})`);
    console.log(`📋 Available rules for ${sessionType}:`, rules.filter(r => r.session_type === sessionType).map(r => ({
      id: r.id,
      rule_name: r.rule_name,
      package_name: r.package_name,
      attendance_alias: r.attendance_alias || '(empty)',
      unit_price: r.unit_price,
      price: r.price
    })));

    // First, try exact matching with attendance_alias (column W) - PRIMARY MATCHING FIELD
    for (const r of rules) {
      if (r.session_type !== sessionType) continue;
      const attendanceAlias = String(r.attendance_alias || '').trim();
      if (attendanceAlias && this.canonicalize(attendanceAlias) === this.canonicalize(membershipName)) {
        console.log(`✅ EXACT attendance_alias match: "${attendanceAlias}" = "${membershipName}"`);
        console.log(`📊 Rule details: unit_price=${r.unit_price}, price=${r.price}, sessions=${r.sessions}`);
        return r;
      }
    }
    console.log(`⚠️ No attendance_alias matches found for "${membershipName}"`);

    // Second, try exact matching with package_name (fallback)
    for (const r of rules) {
      if (r.session_type !== sessionType) continue;
      const packageName = String(r.package_name || '').trim();
      if (packageName && this.canonicalize(packageName) === this.canonicalize(membershipName)) {
        console.log(`✅ EXACT package_name match: "${packageName}" = "${membershipName}"`);
        console.log(`📊 Rule details: unit_price=${r.unit_price}, price=${r.price}, sessions=${r.sessions}`);
        return r;
      }
    }
    console.log(`⚠️ No exact package_name matches found for "${membershipName}"`);

    // Third, try fuzzy matching with attendance_alias (higher priority than package_name)
    let best: { r: any; score: number } | null = null;
    const memTokens = this.tokenize(canonMembership);
    for (const r of rules) {
      if (r.session_type !== sessionType) continue;
      const attendanceAlias = String(r.attendance_alias || '').trim();
      const packageName = String(r.package_name || '').trim();
      
      let score = 0;
      if (attendanceAlias) {
        // Higher priority for attendance_alias matches
        if (this.fuzzyContains(attendanceAlias, membershipName)) {
          score = 2.0; // Highest score for attendance_alias fuzzy match
        } else {
          score = this.jaccard(memTokens, this.tokenize(attendanceAlias)) * 1.5; // Boost attendance_alias
        }
      } else if (packageName) {
        // Lower priority for package_name matches
        if (this.fuzzyContains(packageName, membershipName)) {
          score = 1.5;
        } else {
          score = this.jaccard(memTokens, this.tokenize(packageName));
        }
      }
      
      if (score > 0 && (!best || score > best.score)) {
        best = { r, score };
      }
    }
    
    if (best && best.score >= 0.5) {
      console.log(`✅ FUZZY match found: score ${best.score.toFixed(2)} for "${membershipName}"`);
      console.log(`📊 Rule details: unit_price=${best.r.unit_price}, price=${best.r.price}, sessions=${best.r.sessions}`);
      return best.r;
    }

    // Fallback default rule for session type
    const def = rules.find(r => (!r.package_name || r.package_name === '') && r.session_type === sessionType);
    if (def) {
      console.log(`⚠️ Using default rule for session type: ${sessionType}`);
      console.log(`📊 Default rule details: unit_price=${def.unit_price}, price=${def.price}, sessions=${def.sessions}`);
    } else {
      console.log(`❌ No rule found for "${membershipName}" (${sessionType})`);
      console.log(`🔍 All available rules:`, rules.map(r => ({
        id: r.id,
        rule_name: r.rule_name,
        package_name: r.package_name,
        session_type: r.session_type,
        unit_price: r.unit_price,
        price: r.price
      })));
    }
    return def || null;
  }

  /**
   * Classify session type based on offering type
   */
  private classifySessionType(offeringType: string): 'group' | 'private' {
    const type = String(offeringType || '').toLowerCase();
    if (type.includes('private') || type.includes('1 to 1') || type.includes('1-to-1')) {
      return 'private';
    }
    return 'group';
  }

  /**
   * Generate unique key for attendance record
   */
  private generateUniqueKey(attendance: AttendanceRecord): string {
    const date = attendance['Event Starts At'] || attendance.Date || '';
    const customer = attendance.Customer || '';
    const membership = attendance['Membership Name'] || '';
    const instructors = attendance.Instructors || '';
    
    return `${date}_${customer}_${membership}_${instructors}`.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  /**
   * Normalize master row data from Google Sheets
   */
  private normalizeMasterRow(row: any): AttendanceVerificationMasterRow {
    return {
      customerName: row.customerName || row['Customer Name'] || '',
      eventStartsAt: row.eventStartsAt || row['Event Starts At'] || '',
      membershipName: row.membershipName || row['Membership Name'] || '',
      instructors: row.instructors || row['Instructors'] || '',
      status: row.status || row['Status'] || '',
      discount: row.discount || row['Discount'] || '',
      discountPercentage: parseFloat(row.discountPercentage || row['Discount %'] || '0'),
      verificationStatus: row.verificationStatus || row['Verification Status'] || 'Not Verified',
      invoiceNumber: row.invoiceNumber || row['Invoice #'] || '',
      amount: parseFloat(row.amount || row['Amount'] || '0'),
      paymentDate: row.paymentDate || row['Payment Date'] || '',
      packagePrice: parseFloat(row.packagePrice || row['Package Price'] || '0'),
      sessionPrice: parseFloat(row.sessionPrice || row['Session Price'] || '0'),
      discountedSessionPrice: parseFloat(row.discountedSessionPrice || row['Discounted Session Price'] || '0'),
      coachAmount: parseFloat(row.coachAmount || row['Coach Amount'] || '0'),
      bgmAmount: parseFloat(row.bgmAmount || row['BGM Amount'] || '0'),
      managementAmount: parseFloat(row.managementAmount || row['Management Amount'] || '0'),
      mfcAmount: parseFloat(row.mfcAmount || row['MFC Amount'] || '0'),
      uniqueKey: row.uniqueKey || '',
      createdAt: row.createdAt || '',
      updatedAt: row.updatedAt || ''
    };
  }

  private getField(obj: any, keys: string[]): string {
    if (!obj) return '';
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) {
        const v = obj[k];
        if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
      }
      // try case-insensitive match
      const foundKey = Object.keys(obj).find(kk => kk.toLowerCase().trim() === k.toLowerCase().trim());
      if (foundKey) {
        const v = obj[foundKey];
        if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
      }
    }
    return '';
  }

  // Normalization and fuzzy matching helpers
  private stripDiacritics(value: string): string {
    return (value && (value as any).normalize) ? (value as any).normalize('NFD').replace(/[\u0300-\u036f]/g, '') : value;
  }

  private canonicalize(value: string): string {
    const lower = this.stripDiacritics(String(value || '').toLowerCase());
    let cleaned = lower.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    cleaned = cleaned
      .replace(/pack(s)?/g, 'pack')
      .replace(/x\s*(per\s*)?week/g, 'xweek')
      .replace(/per\s*week/g, 'xweek')
      .replace(/monthly|month(ly)?/g, 'monthly')
      .replace(/single\s*(session)?|payg|day\s*pass/g, 'single')
      .replace(/adult|junior|youth|plan|loyalty|only/g, ' ')
      .replace(/\s+/g, ' ').trim();
    return cleaned;
  }

  private tokenize(value: string): Set<string> {
    const canon = this.canonicalize(value);
    return new Set(canon.split(' ').filter(Boolean));
  }

  private jaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) return 1;
    let inter = 0;
    a.forEach(t => { if (b.has(t)) inter++; });
    const union = a.size + b.size - inter;
    return union === 0 ? 0 : inter / union;
  }

  private fuzzyContains(a: string, b: string): boolean {
    const ca = this.canonicalize(a);
    const cb = this.canonicalize(b);
    return ca.includes(cb) || cb.includes(ca);
  }

  /**
   * Save master data to Google Sheets
   */
  private async saveMasterData(rows: AttendanceVerificationMasterRow[]): Promise<void> {
    // Write as array of objects so the GoogleSheetsService can derive headers correctly
    const dataObjects = rows.map(row => ({
      'Customer Name': row.customerName,
      'Event Starts At': row.eventStartsAt,
      'Membership Name': row.membershipName,
      'Instructors': row.instructors,
      'Status': row.status,
      'Discount': row.discount,
      'Discount %': row.discountPercentage,
      'Verification Status': row.verificationStatus,
      'Invoice #': row.invoiceNumber,
      'Amount': row.amount,
      'Payment Date': row.paymentDate,
      'Package Price': row.packagePrice,
      'Session Price': row.sessionPrice,
      'Discounted Session Price': row.discountedSessionPrice,
      'Coach Amount': row.coachAmount,
      'BGM Amount': row.bgmAmount,
      'Management Amount': row.managementAmount,
      'MFC Amount': row.mfcAmount,
      'UniqueKey': row.uniqueKey,
      'CreatedAt': row.createdAt,
      'UpdatedAt': row.updatedAt
    }));
    
    await googleSheetsService.writeSheet(this.MASTER_SHEET, dataObjects);
  }

  /**
   * Calculate verification summary
   */
  private calculateSummary(rows: AttendanceVerificationMasterRow[]) {
    const totalRecords = rows.length;
    const verifiedRecords = rows.filter(r => r.verificationStatus === 'Verified').length;
    const unverifiedRecords = totalRecords - verifiedRecords;
    const verificationRate = totalRecords > 0 ? (verifiedRecords / totalRecords) * 100 : 0;
    
    return {
      totalRecords,
      verifiedRecords,
      unverifiedRecords,
      verificationRate,
      newRecordsAdded: 0 // This will be set by the calling method
    };
  }

  // Utility methods
  private normalizeCustomerName(name: string): string {
    return String(name || '').toLowerCase().trim();
  }

  private normalizeMembershipName(name: string): string {
    return String(name || '').toLowerCase().trim();
  }

  private parseDate(dateStr: string): Date | null {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date;
  }

  private isSameDate(date1: Date, date2: Date): boolean {
    return date1.toDateString() === date2.toDateString();
  }

  private isWithinDays(date1: Date, date2: Date, days: number): boolean {
    const diffTime = Math.abs(date1.getTime() - date2.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays <= days;
  }

  private isMembershipMatch(membership1: string, membership2: string): boolean {
    if (!membership1 || !membership2) return false;
    if (this.fuzzyContains(membership1, membership2)) return true;
    const score = this.jaccard(this.tokenize(membership1), this.tokenize(membership2));
    return score >= 0.5;
  }

  private filterAttendanceByDate(attendance: AttendanceRecord[], fromDate?: string, toDate?: string): AttendanceRecord[] {
    if (!fromDate && !toDate) return attendance;
    
    return attendance.filter(record => {
      const date = this.parseDate(record['Event Starts At'] || record.Date || '');
      if (!date) return false;
      
      if (fromDate) {
        const from = this.parseDate(fromDate);
        if (from && date < from) return false;
      }
      
      if (toDate) {
        const to = this.parseDate(toDate);
        if (to && date > to) return false;
      }
      
      return true;
    });
  }

  private filterPaymentsByDate(payments: PaymentRecord[], fromDate?: string, toDate?: string): PaymentRecord[] {
    if (!fromDate && !toDate) return payments;
    
    return payments.filter(record => {
      const date = this.parseDate(record.Date);
      if (!date) return false;
      
      if (fromDate) {
        const from = this.parseDate(fromDate);
        if (from && date < from) return false;
      }
      
      if (toDate) {
        const to = this.parseDate(toDate);
        if (to && date > to) return false;
      }
      
      return true;
    });
  }

  private round2(n: number): number {
    return Math.round((n || 0) * 100) / 100;
  }

  /**
   * Post-process: find discounts in payments by scanning memo text, then
   * update master rows' Discount and Discount % by matching invoice number (and customer when available).
   */
  private applyDiscountsFromPayments(
    master: AttendanceVerificationMasterRow[],
    payments: PaymentRecord[],
    discounts: any[]
  ): AttendanceVerificationMasterRow[] {
    if (!discounts || discounts.length === 0 || !payments || payments.length === 0) return master;

    // Build invoice -> discount mapping
    const invoiceToDiscount = new Map<string, { name: string; pct: number }>();

    const activeDiscounts = discounts.filter((d: any) => d && (d.active === true || String(d.active).toLowerCase() === 'true'));

    for (const p of payments) {
      const memo = String(p.Memo || '');
      const invoice = String(p.Invoice || '').trim();
      if (!invoice || !memo) continue;

      for (const d of activeDiscounts) {
        const code = String(d.discount_code || d.name || '').trim();
        if (!code) continue;
        const matchType = String(d.match_type || 'contains').toLowerCase();
        let matched = false;
        if (matchType === 'exact') {
          matched = this.canonicalize(memo) === this.canonicalize(code);
        } else if (matchType === 'regex') {
          try { matched = new RegExp(code, 'i').test(memo); } catch {}
        } else {
          matched = this.canonicalize(memo).includes(this.canonicalize(code));
        }
        if (matched) {
          const pct = Number(d.applicable_percentage || 0) || 0;
          // Prefer higher percentage if multiple match
          const existing = invoiceToDiscount.get(invoice);
          if (!existing || pct > existing.pct) {
            invoiceToDiscount.set(invoice, { name: String(d.name || code), pct });
          }
        }
      }
    }

    if (invoiceToDiscount.size === 0) return master;

    // Update master rows by invoice number and recalc monetary fields
    // NOTE: Package Price and Session Price should NOT be discounted - they represent the original rule values
    // Only Discounted Session Price and amounts should be recalculated
    const updated = master.map(r => {
      const inv = String(r.invoiceNumber || '').trim();
      if (!inv) return r;
      const found = invoiceToDiscount.get(inv);
      if (!found) return r;
      const factor = 1 - (Number(found.pct) || 0) / 100;
      return {
        ...r,
        discount: found.name,
        discountPercentage: found.pct,
        amount: this.round2((r.amount || 0) * factor),
        // Keep original Package Price and Session Price from rules - do NOT apply discounts
        packagePrice: r.packagePrice, // Keep original rule price
        sessionPrice: r.sessionPrice, // Keep original rule unit_price
        // Recalculate discounted session price and amounts
        discountedSessionPrice: this.round2((r.sessionPrice || 0) * factor),
        coachAmount: this.round2((r.coachAmount || 0) * factor),
        bgmAmount: this.round2((r.bgmAmount || 0) * factor),
        managementAmount: this.round2((r.managementAmount || 0) * factor),
        mfcAmount: this.round2((r.mfcAmount || 0) * factor)
      };
    });

    return updated;
  }
}

// Export singleton instance
export const attendanceVerificationService = new AttendanceVerificationService();
