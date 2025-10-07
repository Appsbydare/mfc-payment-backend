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
    Category: string;
    Invoice: string;
    PaymentDate: string;
    Amount: number;
    UnitPrice: number;
    EffectiveAmount: number;
    DiscountName?: string;
    ApplicablePercentage?: number;
    CoachPaymentType?: 'full' | 'partial' | 'free';
    CoachAmount: number;
    BgmAmount: number;
    ManagementAmount: number;
    MfcAmount: number;
    LinkedPaymentIds?: string;
    RuleId?: string;
    CoachPercent?: number;
    BgmPercent?: number;
    ManagementPercent?: number;
    MfcPercent?: number;
    RunAtISO: string;
}
export declare class VerificationMasterService {
    private readonly MASTER_SHEET;
    private readonly ATTENDANCE_SHEET;
    private readonly PAYMENTS_SHEET;
    private sheets;
    constructor();
    buildUniqueKey(input: {
        Date?: string;
        Customer?: string;
        Membership?: string;
        ClassType?: string;
        Instructors?: string;
    }): string;
    private readSheets;
    private getPercentsFor;
    private getUnitPriceFromRule;
    private categorizePayment;
    private findMatchingPayment;
    getMasterRows(): Promise<MasterRow[]>;
    syncMaster(): Promise<{
        appended: number;
        rows: MasterRow[];
    }>;
    applyManualVerification(attendanceRow: any, invoiceNumber: string): Promise<void>;
}
export declare const verificationMasterService: VerificationMasterService;
//# sourceMappingURL=verificationMasterService.d.ts.map