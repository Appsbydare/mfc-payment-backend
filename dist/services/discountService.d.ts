export interface Discount {
    id: number;
    discount_code: string;
    name: string;
    applicable_percentage: number;
    coach_payment_type: 'full' | 'partial' | 'free';
    match_type: 'exact' | 'contains' | 'regex';
    active: boolean;
    notes?: string;
    created_at: string;
    updated_at: string;
}
export interface DiscountMatch {
    discount: Discount;
    matched_text: string;
    confidence: number;
}
export interface InvoiceDiscountData {
    invoice_number: string;
    customer: string;
    date: string;
    total_amount: number;
    discount_amount: number;
    discount_percentage: number;
    discount_name: string;
    coach_payment_type: 'full' | 'partial' | 'free';
    effective_amount: number;
}
export declare class DiscountService {
    private googleSheetsService;
    private discounts;
    private lastRefresh;
    constructor();
    refreshDiscounts(): Promise<void>;
    getActiveDiscounts(): Promise<Discount[]>;
    classifyDiscount(memo: string): Promise<DiscountMatch | null>;
    private matchDiscount;
    extractDiscountDataFromPayments(payments: any[]): Promise<InvoiceDiscountData[]>;
    applyDiscountToPayment(baseAmount: number, discountData: InvoiceDiscountData | null, sessionCount?: number): {
        effectiveAmount: number;
        perSessionAmount: number;
        coachPaymentType: 'full' | 'partial' | 'free';
    };
    createDiscount(discount: Omit<Discount, 'id' | 'created_at' | 'updated_at'>): Promise<Discount>;
    updateDiscount(id: number, updates: Partial<Discount>): Promise<Discount>;
    deleteDiscount(id: number): Promise<void>;
}
export declare const discountService: DiscountService;
//# sourceMappingURL=discountService.d.ts.map