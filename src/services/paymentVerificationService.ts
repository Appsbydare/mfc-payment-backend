import { GoogleSheetsService } from './googleSheets';
import { discountService, InvoiceDiscountData } from './discountService';

export interface VerificationRow {
  Date: string;
  Customer: string;
  Membership: string;
  ClassType: string;
  Instructors: string;
  Verified: boolean;
  Category: string;
  UnitPrice: number;
  EffectiveAmount: number;
  CoachAmount: number;
  BgmAmount: number;
  ManagementAmount: number;
  MfcAmount: number;
  Invoice: string;
  PaymentDate: string;
  DiscountName?: string;
  ApplicablePercentage?: number;
  CoachPaymentType?: 'full' | 'partial' | 'free';
}

export interface PaymentVerificationRow {
  Date: string;
  Customer: string;
  Memo: string;
  Amount: number;
  Invoice: string;
  Category: string;
  IsVerified: boolean;
  DiscountData?: InvoiceDiscountData | undefined;
}

export interface VerificationSummary {
  totalAttendanceRecords: number;
  verifiedAttendanceRecords: number;
  unverifiedAttendanceRecords: number;
  attendanceVerificationRate: number;
  totalPaymentRecords: number;
  verifiedPaymentRecords: number;
  unverifiedPaymentRecords: number;
  paymentVerificationRate: number;
  paymentCategories: {
    payment: number;
    discount: number;
    fullDiscount: number;
    tax: number;
    refund: number;
    fee: number;
  };
  financialMetrics: {
    totalDiscountedAmount: number;
    totalTaxAmount: number;
    totalVerifiedAmount: number;
    totalUnverifiedAmount: number;
    totalEffectiveAmount: number;
  };
  discountBreakdown: {
    totalDiscounts: number;
    fullDiscounts: number;
    partialDiscounts: number;
    freeDiscounts: number;
  };
}

export class PaymentVerificationService {
  private googleSheetsService: GoogleSheetsService;

  constructor() {
    this.googleSheetsService = new GoogleSheetsService();
  }

  // Main verification method with discount integration
  async verifyPayments(params: {
    month?: number;
    year?: number;
    fromDate?: string;
    toDate?: string;
  }): Promise<{
    verificationRows: VerificationRow[];
    paymentVerificationRows: PaymentVerificationRow[];
    summary: VerificationSummary;
  }> {
    const { month, year, fromDate, toDate } = params;

    // Get data from Google Sheets
    const [attendance, payments] = await Promise.all([
      this.googleSheetsService.readSheet('attendance').catch(() => []),
      this.googleSheetsService.readSheet('Payments').catch(() => [])
    ]);

    // Filter data based on date range
    const attendanceFiltered = this.filterByDateRange(attendance, month, year, fromDate, toDate);
    const paymentsFiltered = this.filterByDateRange(payments, month, year, fromDate, toDate);

    // Extract discount data from payments
    const discountDataMap = await this.extractDiscountDataFromPayments(paymentsFiltered);

    // Process payment verification with discount classification
    const paymentVerificationRows = await this.processPaymentVerification(paymentsFiltered, discountDataMap);

    // Process attendance verification with discount integration
    const verificationRows = await this.processAttendanceVerification(
      attendanceFiltered, 
      paymentVerificationRows, 
      discountDataMap
    );

    // Calculate summary
    const summary = this.calculateSummary(verificationRows, paymentVerificationRows);

    return {
      verificationRows,
      paymentVerificationRows,
      summary
    };
  }

  // Filter data by date range
  private filterByDateRange(data: any[], month?: number, year?: number, fromDate?: string, toDate?: string): any[] {
    return data.filter(item => {
      const date = this.parseDate(item.Date);
      if (!date) return false;

      if (fromDate && toDate) {
        const from = this.parseDate(fromDate);
        const to = this.parseDate(toDate);
        return from && to && date >= from && date <= to;
      }

      if (month && year) {
        return date.getMonth() + 1 === month && date.getFullYear() === year;
      }

      return true;
    });
  }

  // Parse date string to Date object
  private parseDate(dateStr: string): Date | null {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date;
  }

  // Extract discount data from payments
  private async extractDiscountDataFromPayments(payments: any[]): Promise<Map<string, InvoiceDiscountData>> {
    const discountData = await discountService.extractDiscountDataFromPayments(payments);
    const discountMap = new Map<string, InvoiceDiscountData>();
    
    discountData.forEach(discount => {
      discountMap.set(discount.invoice_number, discount);
    });

    return discountMap;
  }

  // Process payment verification with discount classification
  private async processPaymentVerification(
    payments: any[], 
    discountDataMap: Map<string, InvoiceDiscountData>
  ): Promise<PaymentVerificationRow[]> {
    return payments.map(payment => {
      let category = 'Payment';
      let isVerified = payment.IsVerified === 'true' || payment.IsVerified === true;
      let discountData: InvoiceDiscountData | undefined;

      const amount = parseFloat(payment.Amount || '0');
      const invoice = payment.Invoice || '';

      // Check for tax/fee
      if (payment.Memo && payment.Memo.toLowerCase().includes('fee')) {
        category = 'Tax';
        isVerified = true;
      }
      // Check for discount
      else if (amount < 0 && payment.Memo && payment.Memo.toLowerCase().includes('discount')) {
        category = 'Discount';
        isVerified = true;
        discountData = discountDataMap.get(invoice);
      }
      // Check for 100% discount (same day, same customer, same amount with opposite signs)
      else if (this.isFullDiscount(payments, payment)) {
        category = '100% Discount';
        isVerified = true;
        discountData = discountDataMap.get(invoice);
      }

      return {
        Date: payment.Date || '',
        Customer: payment.Customer || '',
        Memo: payment.Memo || '',
        Amount: amount,
        Invoice: invoice,
        Category: category,
        IsVerified: isVerified,
        DiscountData: discountData
      };
    });
  }

  // Check if payment is part of a 100% discount scenario
  private isFullDiscount(payments: any[], payment: any): boolean {
    const sameRecords = payments.filter(p => 
      p.Date === payment.Date && 
      p.Customer === payment.Customer && 
      Math.abs(parseFloat(p.Amount || '0')) === Math.abs(parseFloat(payment.Amount || '0'))
    );

    if (sameRecords.length >= 2) {
      const amounts = sameRecords.map(p => parseFloat(p.Amount || '0'));
      const hasPositive = amounts.some(a => a > 0);
      const hasNegative = amounts.some(a => a < 0);
      
      return hasPositive && hasNegative;
    }

    return false;
  }

  // Process attendance verification with discount integration
  private async processAttendanceVerification(
    attendance: any[],
    paymentVerificationRows: PaymentVerificationRow[],
    discountDataMap: Map<string, InvoiceDiscountData>
  ): Promise<VerificationRow[]> {
    return attendance.map(attendanceRecord => {
      // Find matching payment
      const matchingPayment = paymentVerificationRows.find(payment => 
        payment.Customer === attendanceRecord.Customer && 
        payment.Date === attendanceRecord.Date
      );

      let discountName = '';
      let applicablePercentage = 0;
      let coachPaymentType: 'full' | 'partial' | 'free' = 'full';
      let effectiveAmount = 0;

      if (matchingPayment) {
        const discountData = discountDataMap.get(matchingPayment.Invoice);
        
        if (discountData) {
          discountName = discountData.discount_name;
          applicablePercentage = discountData.discount_percentage;
          coachPaymentType = discountData.coach_payment_type;
          effectiveAmount = discountData.effective_amount;
        } else {
          effectiveAmount = matchingPayment.Amount;
        }
      }

      return {
        Date: attendanceRecord.Date || '',
        Customer: attendanceRecord.Customer || '',
        Membership: attendanceRecord.Membership || '',
        ClassType: attendanceRecord.ClassType || '',
        Instructors: attendanceRecord.Instructors || '',
        Verified: !!matchingPayment,
        Category: matchingPayment ? 'Verified' : 'No payment record',
        UnitPrice: 0, // Will be calculated based on rules
        EffectiveAmount: effectiveAmount,
        CoachAmount: 0, // Will be calculated based on rules and discount
        BgmAmount: 0,
        ManagementAmount: 0,
        MfcAmount: 0,
        Invoice: matchingPayment?.Invoice || '',
        PaymentDate: matchingPayment?.Date || '',
        DiscountName: discountName,
        ApplicablePercentage: applicablePercentage,
        CoachPaymentType: coachPaymentType
      };
    });
  }

  // Calculate verification summary
  private calculateSummary(
    verificationRows: VerificationRow[],
    paymentVerificationRows: PaymentVerificationRow[]
  ): VerificationSummary {
    const attendanceVerified = verificationRows.filter(r => r.Verified).length;
    const attendanceTotal = verificationRows.length;
    const attendanceVerificationRate = attendanceTotal > 0 ? (attendanceVerified / attendanceTotal) * 100 : 0;

    const paymentVerified = paymentVerificationRows.filter(p => p.IsVerified).length;
    const paymentTotal = paymentVerificationRows.length;
    const paymentVerificationRate = paymentTotal > 0 ? (paymentVerified / paymentTotal) * 100 : 0;

    // Payment category breakdown
    const paymentCategories = {
      payment: paymentVerificationRows.filter(p => p.Category === 'Payment').length,
      discount: paymentVerificationRows.filter(p => p.Category === 'Discount').length,
      fullDiscount: paymentVerificationRows.filter(p => p.Category === '100% Discount').length,
      tax: paymentVerificationRows.filter(p => p.Category === 'Tax').length,
      refund: paymentVerificationRows.filter(p => p.Category === 'Refund').length,
      fee: paymentVerificationRows.filter(p => p.Category === 'Fee').length,
    };

    // Financial calculations
    const totalDiscountedAmount = paymentVerificationRows
      .filter(p => p.Category === 'Discount' || p.Category === '100% Discount')
      .reduce((sum, p) => sum + Math.abs(p.Amount), 0);

    const totalTaxAmount = paymentVerificationRows
      .filter(p => p.Category === 'Tax')
      .reduce((sum, p) => sum + p.Amount, 0);

    const totalVerifiedAmount = paymentVerificationRows
      .filter(p => p.IsVerified)
      .reduce((sum, p) => sum + p.Amount, 0);

    const totalUnverifiedAmount = paymentVerificationRows
      .filter(p => !p.IsVerified)
      .reduce((sum, p) => sum + p.Amount, 0);

    const totalEffectiveAmount = verificationRows
      .filter(r => r.Verified)
      .reduce((sum, r) => sum + r.EffectiveAmount, 0);

    // Discount breakdown
    const discountBreakdown = {
      totalDiscounts: paymentCategories.discount + paymentCategories.fullDiscount,
      fullDiscounts: paymentVerificationRows.filter(p => 
        p.DiscountData?.coach_payment_type === 'full'
      ).length,
      partialDiscounts: paymentVerificationRows.filter(p => 
        p.DiscountData?.coach_payment_type === 'partial'
      ).length,
      freeDiscounts: paymentVerificationRows.filter(p => 
        p.DiscountData?.coach_payment_type === 'free'
      ).length,
    };

    return {
      totalAttendanceRecords: attendanceTotal,
      verifiedAttendanceRecords: attendanceVerified,
      unverifiedAttendanceRecords: attendanceTotal - attendanceVerified,
      attendanceVerificationRate,
      totalPaymentRecords: paymentTotal,
      verifiedPaymentRecords: paymentVerified,
      unverifiedPaymentRecords: paymentTotal - paymentVerified,
      paymentVerificationRate,
      paymentCategories,
      financialMetrics: {
        totalDiscountedAmount,
        totalTaxAmount,
        totalVerifiedAmount,
        totalUnverifiedAmount,
        totalEffectiveAmount
      },
      discountBreakdown
    };
  }
}

// Export singleton instance
export const paymentVerificationService = new PaymentVerificationService();
