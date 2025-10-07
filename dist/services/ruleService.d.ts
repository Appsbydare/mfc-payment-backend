export interface PaymentRule {
    id: number;
    rule_name: string;
    package_name?: string;
    session_type: 'group' | 'private';
    price: number;
    sessions: number;
    coach_percentage: number;
    bgm_percentage: number;
    management_percentage: number;
    mfc_percentage: number;
    is_fixed_rate: boolean;
    allow_discounts: boolean;
    tax_exempt: boolean;
    notes?: string;
    created_at: string;
    updated_at: string;
}
export interface GlobalSettings {
    key: string;
    value: string;
    description: string;
}
export declare class RuleService {
    private readonly RULES_SHEET;
    private readonly SETTINGS_SHEET;
    getAllRules(): Promise<PaymentRule[]>;
    private getDefaultRules;
    getRuleById(id: number): Promise<PaymentRule | null>;
    getGlobalRules(): Promise<PaymentRule[]>;
    getPackageRules(packageName: string): Promise<PaymentRule[]>;
    createRule(ruleData: Omit<PaymentRule, 'id' | 'created_at' | 'updated_at'>): Promise<PaymentRule>;
    updateRule(id: number, ruleData: Partial<PaymentRule>): Promise<PaymentRule>;
    deleteRule(id: number): Promise<void>;
    getGlobalSettings(): Promise<GlobalSettings[]>;
    private getDefaultSettings;
    updateGlobalSettings(settings: GlobalSettings[]): Promise<void>;
    private validateRule;
    getDefaultRule(sessionType: 'group' | 'private'): Promise<PaymentRule | null>;
    findMatchingRule(packageName: string, sessionType: 'group' | 'private'): Promise<PaymentRule | null>;
}
export declare const ruleService: RuleService;
//# sourceMappingURL=ruleService.d.ts.map