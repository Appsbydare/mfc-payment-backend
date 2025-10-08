export interface PayslipData {
    coachName: string;
    coachDesignation: string;
    period: string;
    fromDate: string;
    toDate: string;
    privateSessions: PrivateSession[];
    groupSessions: GroupSession[];
    deductions: Deduction[];
    totalPrivateRevenue: number;
    totalGroupRevenue: number;
    totalDeductions: number;
    totalPay: number;
}
export interface PrivateSession {
    clientName: string;
    date: string;
    sessionType: string;
    netPricePerSession: number;
    yourPay: number;
}
export interface GroupSession {
    clientName: string;
    date: string;
    classType: string;
    membershipUsed: string;
    yourPay: number;
}
export interface Deduction {
    deductionType: string;
    date: string;
    payDeducted: number;
}
export interface PayslipGenerationParams {
    coachName: string;
    fromDate?: string;
    toDate?: string;
}
export declare class PayslipService {
    private readonly MASTER_SHEET;
    generatePayslip(params: PayslipGenerationParams): Promise<{
        success: boolean;
        data?: PayslipData;
        error?: string;
    }>;
    generateExcelPayslip(payslipData: PayslipData): Promise<Buffer>;
    generatePDFPayslip(payslipData: PayslipData): Promise<Buffer>;
    private isPrivateSession;
    private getSessionType;
    private getClassType;
    private formatDate;
    private getPeriodString;
}
//# sourceMappingURL=payslipService.d.ts.map