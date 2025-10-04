import { googleSheetsService } from './googleSheets';

export interface PaymentRule {
  id: number;
  rule_name: string;
  package_name?: string; // null for global rules
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

export class RuleService {
  private readonly RULES_SHEET = 'rules';
  private readonly SETTINGS_SHEET = 'settings';

  // Get all payment rules
  async getAllRules(): Promise<PaymentRule[]> {
    try {
      const rules = await googleSheetsService.readSheet(this.RULES_SHEET);
      
      if (rules.length === 0) {
        // Return default rules if no data is available
        return this.getDefaultRules();
      }
      
      return rules.map((rule: any) => ({
        ...rule,
        id: parseInt(rule.id),
        price: parseFloat(rule.price),
        sessions: parseInt(rule.sessions),
        coach_percentage: parseFloat(rule.coach_percentage),
        bgm_percentage: parseFloat(rule.bgm_percentage),
        management_percentage: parseFloat(rule.management_percentage),
        mfc_percentage: parseFloat(rule.mfc_percentage),
        is_fixed_rate: rule.is_fixed_rate === 'true',
        allow_discounts: rule.allow_discounts === 'true',
        tax_exempt: rule.tax_exempt === 'true'
      }));
    } catch (error) {
      console.error('Error fetching rules:', error);
      console.log('⚠️ Returning default rules due to error');
      return this.getDefaultRules();
    }
  }

  // Get default rules when Google Sheets is not available
  private getDefaultRules(): PaymentRule[] {
    return [
      {
        id: 1,
        rule_name: 'Group Classes Default',
        package_name: '',
        session_type: 'group',
        price: 0,
        sessions: 1,
        coach_percentage: 43.5,
        bgm_percentage: 30.0,
        management_percentage: 8.5,
        mfc_percentage: 18.0,
        is_fixed_rate: false,
        allow_discounts: true,
        tax_exempt: false,
        notes: 'Default rule for group classes',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      {
        id: 2,
        rule_name: 'Private Sessions Default',
        package_name: '',
        session_type: 'private',
        price: 0,
        sessions: 1,
        coach_percentage: 80.0,
        bgm_percentage: 15.0,
        management_percentage: 0.0,
        mfc_percentage: 5.0,
        is_fixed_rate: false,
        allow_discounts: true,
        tax_exempt: false,
        notes: 'Default rule for private sessions',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    ];
  }

  // Get rule by ID
  async getRuleById(id: number): Promise<PaymentRule | null> {
    try {
      const rules = await this.getAllRules();
      return rules.find(rule => rule.id === id) || null;
    } catch (error) {
      console.error('Error fetching rule by ID:', error);
      throw new Error('Failed to fetch rule');
    }
  }

  // Get global default rules
  async getGlobalRules(): Promise<PaymentRule[]> {
    try {
      const rules = await this.getAllRules();
      return rules.filter(rule => !rule.package_name);
    } catch (error) {
      console.error('Error fetching global rules:', error);
      throw new Error('Failed to fetch global rules');
    }
  }

  // Get package-specific rules
  async getPackageRules(packageName: string): Promise<PaymentRule[]> {
    try {
      const rules = await this.getAllRules();
      return rules.filter(rule => rule.package_name === packageName);
    } catch (error) {
      console.error('Error fetching package rules:', error);
      throw new Error('Failed to fetch package rules');
    }
  }

  // Create new rule
  async createRule(ruleData: Omit<PaymentRule, 'id' | 'created_at' | 'updated_at'>): Promise<PaymentRule> {
    try {
      // Validate rule data
      this.validateRule(ruleData as PaymentRule);

      const rules = await this.getAllRules();
      const newId = Math.max(...rules.map(r => r.id), 0) + 1;
      
      const newRule: PaymentRule = {
        ...ruleData,
        id: newId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // Add to existing rules
      rules.push(newRule);
      await googleSheetsService.writeSheet(this.RULES_SHEET, rules);

      return newRule;
    } catch (error) {
      console.error('Error creating rule:', error);
      throw new Error('Failed to create rule');
    }
  }

  // Update existing rule
  async updateRule(id: number, ruleData: Partial<PaymentRule>): Promise<PaymentRule> {
    try {
      const rules = await this.getAllRules();
      const ruleIndex = rules.findIndex(rule => rule.id === id);
      
      if (ruleIndex === -1) {
        throw new Error('Rule not found');
      }

      // Validate updated rule data
      const updatedRule = { ...rules[ruleIndex], ...ruleData, updated_at: new Date().toISOString() };
      this.validateRule(updatedRule);

      rules[ruleIndex] = updatedRule;
      await googleSheetsService.writeSheet(this.RULES_SHEET, rules);

      return updatedRule;
    } catch (error) {
      console.error('Error updating rule:', error);
      throw new Error('Failed to update rule');
    }
  }

  // Delete rule
  async deleteRule(id: number): Promise<void> {
    try {
      const rules = await this.getAllRules();
      const filteredRules = rules.filter(rule => rule.id !== id);
      
      if (filteredRules.length === rules.length) {
        throw new Error('Rule not found');
      }

      await googleSheetsService.writeSheet(this.RULES_SHEET, filteredRules);
    } catch (error) {
      console.error('Error deleting rule:', error);
      throw new Error('Failed to delete rule');
    }
  }

  // Get global settings
  async getGlobalSettings(): Promise<GlobalSettings[]> {
    try {
      const settings = await googleSheetsService.readSheet(this.SETTINGS_SHEET);
      
      if (settings.length === 0) {
        // Return default settings if no data is available
        return this.getDefaultSettings();
      }
      
      return settings;
    } catch (error) {
      console.error('Error fetching global settings:', error);
      console.log('⚠️ Returning default settings due to error');
      return this.getDefaultSettings();
    }
  }

  // Get default settings when Google Sheets is not available
  private getDefaultSettings(): GlobalSettings[] {
    return [
      {
        key: 'default_monthly_weeks',
        value: '4.3',
        description: 'Default weeks per month for calculations'
      },
      {
        key: 'system_version',
        value: '1.0.0',
        description: 'Current system version'
      }
    ];
  }

  // Update global settings
  async updateGlobalSettings(settings: GlobalSettings[]): Promise<void> {
    try {
      await googleSheetsService.writeSheet(this.SETTINGS_SHEET, settings);
    } catch (error) {
      console.error('Error updating global settings:', error);
      throw new Error('Failed to update global settings');
    }
  }

  // Validate rule data
  private validateRule(rule: PaymentRule): void {
    const errors: string[] = [];

    // Check required fields
    if (!rule.rule_name) errors.push('Rule name is required');
    if (!rule.session_type) errors.push('Session type is required');
    if (rule.price < 0) errors.push('Price must be non-negative');
    if (rule.sessions < 1) errors.push('Sessions must be at least 1');

    // Validate percentages
    const totalPercentage = rule.coach_percentage + rule.bgm_percentage + 
                           rule.management_percentage + rule.mfc_percentage;
    
    if (Math.abs(totalPercentage - 100) > 0.01) {
      errors.push('Percentages must total 100%');
    }

    if (rule.coach_percentage < 0 || rule.bgm_percentage < 0 || 
        rule.management_percentage < 0 || rule.mfc_percentage < 0) {
      errors.push('All percentages must be non-negative');
    }

    if (errors.length > 0) {
      throw new Error(`Validation failed: ${errors.join(', ')}`);
    }
  }

  // Get default rule for session type
  async getDefaultRule(sessionType: 'group' | 'private'): Promise<PaymentRule | null> {
    try {
      const globalRules = await this.getGlobalRules();
      return globalRules.find(rule => rule.session_type === sessionType) || null;
    } catch (error) {
      console.error('Error fetching default rule:', error);
      throw new Error('Failed to fetch default rule');
    }
  }

  // Find matching rule for package
  async findMatchingRule(packageName: string, sessionType: 'group' | 'private'): Promise<PaymentRule | null> {
    try {
      // First try to find package-specific rule
      const packageRules = await this.getPackageRules(packageName);
      const matchingPackageRule = packageRules.find(rule => rule.session_type === sessionType);
      
      if (matchingPackageRule) {
        return matchingPackageRule;
      }

      // Fall back to global default rule
      return await this.getDefaultRule(sessionType);
    } catch (error) {
      console.error('Error finding matching rule:', error);
      throw new Error('Failed to find matching rule');
    }
  }
}

// Export singleton instance
export const ruleService = new RuleService(); 