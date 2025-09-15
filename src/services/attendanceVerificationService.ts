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
  sessionPrice: number;
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
      const allMasterRows = Array.from(existingByKey.values());
      
      // Save to Google Sheets
      if (newMasterRows.length > 0) {
        await this.saveMasterData(allMasterRows);
        console.log(`✅ Saved ${newMasterRows.length} new verification records`);
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
    const [attendance, payments, rules, discounts] = await Promise.all([
      googleSheetsService.readSheet(this.ATTENDANCE_SHEET).catch(() => []),
      googleSheetsService.readSheet(this.PAYMENTS_SHEET).catch(() => []),
      googleSheetsService.readSheet(this.RULES_SHEET).catch(() => []),
      googleSheetsService.readSheet(this.DISCOUNTS_SHEET).catch(() => [])
    ]);

    return { attendance, payments, rules, discounts };
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
    const customerName = attendance.Customer || '';
    const eventStartsAt = attendance['Event Starts At'] || attendance.Date || '';
    const membershipName = attendance['Membership Name'] || '';
    const instructors = attendance.Instructors || '';
    const status = attendance.Status || '';
    
    // Find matching payment record
    const matchingPayment = this.findMatchingPayment(attendance, payments);
    
    // Determine verification status
    const verificationStatus = matchingPayment ? 'Verified' : 'Not Verified';
    
    // Extract payment data
    const invoiceNumber = matchingPayment?.Invoice || '';
    const amount = matchingPayment ? parseFloat(String(matchingPayment.Amount)) : 0;
    const paymentDate = matchingPayment?.Date || '';
    
    // Calculate based on Rules first, then apply Discounts
    const sessionType = this.classifySessionType(attendance['Offering Type Name'] || '');
    const rule = this.findMatchingRule(membershipName, sessionType, rules);
    
    // Find applicable discount AFTER rule lookup
    const discountInfo = await this.findApplicableDiscount(matchingPayment, discounts);
    const discount = discountInfo?.name || '';
    const discountPercentage = discountInfo?.applicable_percentage || 0;
    
    const sessionPrice = this.calculateSessionPrice({ baseAmount: amount, rule, discountInfo });
    const amounts = this.calculateAmounts(sessionPrice, rule, sessionType);
    
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
      sessionPrice,
      coachAmount: amounts.coach,
      bgmAmount: amounts.bgm,
      managementAmount: amounts.management,
      mfcAmount: amounts.mfc,
      uniqueKey,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  /**
   * Find matching payment record for attendance
   */
  private findMatchingPayment(attendance: AttendanceRecord, payments: PaymentRecord[]): PaymentRecord | null {
    const customerName = this.normalizeCustomerName(attendance.Customer);
    const membershipName = this.normalizeMembershipName(attendance['Membership Name']);
    const attendanceDate = this.parseDate(attendance['Event Starts At'] || attendance.Date || '');
    
    if (!attendanceDate) return null;
    
    // Find payments for the same customer
    const customerPayments = payments.filter(p => 
      this.normalizeCustomerName(p.Customer) === customerName
    );
    
    // Look for exact date match first
    for (const payment of customerPayments) {
      const paymentDate = this.parseDate(payment.Date);
      if (paymentDate && this.isSameDate(attendanceDate, paymentDate)) {
        // Check if memo matches membership
        const memo = this.normalizeMembershipName(payment.Memo);
        if (this.isMembershipMatch(membershipName, memo)) {
          return payment;
        }
      }
    }
    
    // Look for payments within 7 days
    for (const payment of customerPayments) {
      const paymentDate = this.parseDate(payment.Date);
      if (paymentDate && this.isWithinDays(attendanceDate, paymentDate, 7)) {
        const memo = this.normalizeMembershipName(payment.Memo);
        if (this.isMembershipMatch(membershipName, memo)) {
          return payment;
        }
      }
    }
    
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
   * Calculate session price based on payment amount and discount
   */
  private calculateSessionPrice(params: { baseAmount: number; rule: any; discountInfo: any }): number {
    const { baseAmount, rule, discountInfo } = params;
    // Start from rule price if available, otherwise the observed base amount
    let price = (rule && typeof rule.price === 'number' && rule.price > 0) ? Number(rule.price) : Number(baseAmount || 0);
    
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
   */
  private findMatchingRule(membershipName: string, sessionType: string, rules: any[]): any | null {
    // First try exact membership match
    let rule = rules.find(r => 
      r.package_name && 
      r.package_name.toLowerCase() === membershipName.toLowerCase() &&
      r.session_type === sessionType
    );
    
    if (rule) return rule;
    
    // Then try partial membership match
    rule = rules.find(r => 
      r.package_name && 
      membershipName.toLowerCase().includes(r.package_name.toLowerCase()) &&
      r.session_type === sessionType
    );
    
    if (rule) return rule;
    
    // Finally try default rule for session type
    rule = rules.find(r => 
      (!r.package_name || r.package_name === '') &&
      r.session_type === sessionType
    );
    
    return rule || null;
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
      sessionPrice: parseFloat(row.sessionPrice || row['Session Price'] || '0'),
      coachAmount: parseFloat(row.coachAmount || row['Coach Amount'] || '0'),
      bgmAmount: parseFloat(row.bgmAmount || row['BGM Amount'] || '0'),
      managementAmount: parseFloat(row.managementAmount || row['Management Amount'] || '0'),
      mfcAmount: parseFloat(row.mfcAmount || row['MFC Amount'] || '0'),
      uniqueKey: row.uniqueKey || '',
      createdAt: row.createdAt || '',
      updatedAt: row.updatedAt || ''
    };
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
      'Session Price': row.sessionPrice,
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
    
    // Exact match
    if (membership1 === membership2) return true;
    
    // Partial match (one contains the other)
    return membership1.includes(membership2) || membership2.includes(membership1);
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
}

// Export singleton instance
export const attendanceVerificationService = new AttendanceVerificationService();
