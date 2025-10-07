export interface AttendanceVerificationMasterRow {
    customerName: string;
    eventStartsAt: string;
    membershipName: string;
    instructors: string;
    status: string;
    discount: string;
    discountPercentage: number;
    verificationStatus: 'Verified' | 'Not Verified' | 'Package Cannot be found';
    invoiceNumber: string;
    amount: number;
    paymentDate: string;
    packagePrice: number;
    sessionPrice: number;
    discountedSessionPrice: number;
    coachAmount: number;
    bgmAmount: number;
    managementAmount: number;
    mfcAmount: number;
    uniqueKey: string;
    createdAt: string;
    updatedAt: string;
}
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
    Date?: string;
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
export declare class AttendanceVerificationService {
    private readonly MASTER_SHEET;
    private readonly ATTENDANCE_SHEET;
    private readonly PAYMENTS_SHEET;
    private readonly RULES_SHEET;
    private readonly DISCOUNTS_SHEET;
    verifyAttendanceData(params?: {
        fromDate?: string;
        toDate?: string;
        forceReverify?: boolean;
        clearExisting?: boolean;
        skipWrite?: boolean;
    }): Promise<VerificationResult>;
    loadExistingMasterData(): Promise<AttendanceVerificationMasterRow[]>;
    clearMasterData(): Promise<void>;
    batchVerificationProcess(params?: {
        fromDate?: string;
        toDate?: string;
        forceReverify?: boolean;
        clearExisting?: boolean;
    }): Promise<VerificationResult>;
    loadExistingDataOnly(): Promise<AttendanceVerificationMasterRow[]>;
    loadAllData(): Promise<{
        attendance: any[] | never[];
        payments: any[] | never[];
        rules: any[];
        discounts: any[] | never[];
    }>;
    private normalizeRules;
    private processAttendanceRecordWithInvoiceTracking;
    private findMatchingPaymentDirect;
    private findMatchingPaymentNew;
    private findMatchingPayment;
    private findApplicableDiscount;
    private calculateDiscountedSessionPrice;
    private calculateAmounts;
    private useInvoiceForSession;
    private findBestAvailableInvoice;
    private ensureAllInvoicesInVerification;
    private estimateSessionPriceFromRules;
    private findMatchingRuleByAttendanceAlias;
    private findMatchingRuleExact;
    private findRuleByMembershipAndSessionType;
    private findRuleByMembershipOnly;
    private findMatchingRule;
    private classifySessionType;
    generateUniqueKey(attendance: AttendanceRecord): string;
    private normalizeMasterRow;
    private getField;
    private stripDiacritics;
    private canonicalize;
    private tokenize;
    private jaccard;
    private fuzzyContains;
    saveMasterData(rows: AttendanceVerificationMasterRow[]): Promise<void>;
    private calculateSummary;
    private normalizeCustomerName;
    private normalizeMembershipName;
    private parseDate;
    private isSameDate;
    private isWithinDays;
    private isMembershipMatch;
    filterAttendanceByDate(attendance: AttendanceRecord[], fromDate?: string, toDate?: string): AttendanceRecord[];
    filterPaymentsByDate(payments: PaymentRecord[], fromDate?: string, toDate?: string): PaymentRecord[];
    private round2;
    private applyDiscountsByInvoice;
    applyDiscountsToMasterData(masterData: AttendanceVerificationMasterRow[], discounts: any[], payments: PaymentRecord[]): Promise<AttendanceVerificationMasterRow[]>;
    recalculateDiscountedAmounts(masterData: AttendanceVerificationMasterRow[]): Promise<AttendanceVerificationMasterRow[]>;
    private applyDiscountsFromPayments;
}
export declare const attendanceVerificationService: AttendanceVerificationService;
//# sourceMappingURL=attendanceVerificationService.d.ts.map