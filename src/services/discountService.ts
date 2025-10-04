import { GoogleSheetsService } from './googleSheets';

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
  effective_amount: number; // Amount after discount (excluding tax/fees)
}

export class DiscountService {
  private googleSheetsService: GoogleSheetsService;
  private discounts: Discount[] = [];
  private lastRefresh: Date | null = null;

  constructor() {
    this.googleSheetsService = new GoogleSheetsService();
  }

  // Refresh discounts from Google Sheets
  async refreshDiscounts(): Promise<void> {
    try {
      this.discounts = await this.googleSheetsService.readSheet('discounts');
      this.lastRefresh = new Date();
      console.log(`✅ Loaded ${this.discounts.length} discounts from Google Sheets`);
    } catch (error) {
      console.error('❌ Failed to refresh discounts:', error);
      throw new Error('Failed to load discounts from Google Sheets');
    }
  }

  // Get all active discounts
  async getActiveDiscounts(): Promise<Discount[]> {
    if (!this.lastRefresh || this.discounts.length === 0) {
      await this.refreshDiscounts();
    }
    return this.discounts.filter(d => d.active);
  }

  // Classify a memo text against available discounts
  async classifyDiscount(memo: string): Promise<DiscountMatch | null> {
    const activeDiscounts = await this.getActiveDiscounts();
    
    // Sort by priority (exact matches first, then contains, then regex)
    const sortedDiscounts = activeDiscounts.sort((a, b) => {
      const priority = { exact: 1, contains: 2, regex: 3 };
      return priority[a.match_type] - priority[b.match_type];
    });

    for (const discount of sortedDiscounts) {
      const match = this.matchDiscount(memo, discount);
      if (match) {
        return match;
      }
    }

    return null;
  }

  // Match a single discount against memo text
  private matchDiscount(memo: string, discount: Discount): DiscountMatch | null {
    const memoLower = memo.toLowerCase();
    const codeLower = discount.discount_code.toLowerCase();

    switch (discount.match_type) {
      case 'exact':
        if (memoLower === codeLower) {
          return {
            discount,
            matched_text: memo,
            confidence: 1.0
          };
        }
        break;

      case 'contains':
        if (memoLower.includes(codeLower)) {
          return {
            discount,
            matched_text: memo,
            confidence: 0.8
          };
        }
        break;

      case 'regex':
        try {
          const regex = new RegExp(codeLower, 'i');
          if (regex.test(memo)) {
            return {
              discount,
              matched_text: memo,
              confidence: 0.9
            };
          }
        } catch (error) {
          console.warn(`Invalid regex pattern for discount ${discount.discount_code}:`, error);
        }
        break;
    }

    return null;
  }

  // Extract discount data from payment records
  async extractDiscountDataFromPayments(payments: any[]): Promise<InvoiceDiscountData[]> {
    const invoiceGroups = new Map<string, any[]>();
    
    // Group payments by invoice
    payments.forEach(payment => {
      const invoice = payment.Invoice || payment.invoice || '';
      if (!invoiceGroups.has(invoice)) {
        invoiceGroups.set(invoice, []);
      }
      invoiceGroups.get(invoice)!.push(payment);
    });

    const discountData: InvoiceDiscountData[] = [];

    for (const [invoiceNumber, invoicePayments] of Array.from(invoiceGroups.entries())) {
      if (!invoiceNumber) continue;

      // Find discount line items (negative amounts)
      const discountItems = invoicePayments.filter(p => 
        parseFloat(p.Amount || '0') < 0 && 
        p.Memo && 
        p.Memo.toLowerCase().includes('discount')
      );

      if (discountItems.length === 0) continue;

      // Calculate totals
      const totalAmount = invoicePayments
        .filter(p => parseFloat(p.Amount || '0') > 0)
        .reduce((sum, p) => sum + parseFloat(p.Amount || '0'), 0);

      const discountAmount = Math.abs(discountItems
        .reduce((sum, p) => sum + parseFloat(p.Amount || '0'), 0));

      const discountPercentage = totalAmount > 0 ? (discountAmount / totalAmount) * 100 : 0;

      // Classify the discount
      const discountMemo = discountItems[0].Memo || '';
      const discountMatch = await this.classifyDiscount(discountMemo);

      const effectiveAmount = totalAmount - discountAmount;

      discountData.push({
        invoice_number: invoiceNumber,
        customer: invoicePayments[0].Customer || '',
        date: invoicePayments[0].Date || '',
        total_amount: totalAmount,
        discount_amount: discountAmount,
        discount_percentage: discountPercentage,
        discount_name: discountMatch?.discount.name || discountMemo,
        coach_payment_type: discountMatch?.discount.coach_payment_type || 'partial',
        effective_amount: effectiveAmount
      });
    }

    return discountData;
  }

  // Apply discount logic to payment calculations
  applyDiscountToPayment(
    baseAmount: number,
    discountData: InvoiceDiscountData | null,
    sessionCount: number = 1
  ): {
    effectiveAmount: number;
    perSessionAmount: number;
    coachPaymentType: 'full' | 'partial' | 'free';
  } {
    if (!discountData) {
      return {
        effectiveAmount: baseAmount,
        perSessionAmount: baseAmount / sessionCount,
        coachPaymentType: 'full'
      };
    }

    switch (discountData.coach_payment_type) {
      case 'full':
        // Treat as regular full price (ignore discount)
        return {
          effectiveAmount: baseAmount,
          perSessionAmount: baseAmount / sessionCount,
          coachPaymentType: 'full'
        };

      case 'partial':
        // Use discounted amount
        return {
          effectiveAmount: discountData.effective_amount,
          perSessionAmount: discountData.effective_amount / sessionCount,
          coachPaymentType: 'partial'
        };

      case 'free':
        // Everyone gets paid zero
        return {
          effectiveAmount: 0,
          perSessionAmount: 0,
          coachPaymentType: 'free'
        };

      default:
        return {
          effectiveAmount: baseAmount,
          perSessionAmount: baseAmount / sessionCount,
          coachPaymentType: 'full'
        };
    }
  }

  // Create a new discount
  async createDiscount(discount: Omit<Discount, 'id' | 'created_at' | 'updated_at'>): Promise<Discount> {
    const newDiscount: Discount = {
      ...discount,
      id: Date.now(), // Simple ID generation
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Add to Google Sheets
    const currentDiscounts = await this.googleSheetsService.readSheet('discounts');
    currentDiscounts.push(newDiscount);
    await this.googleSheetsService.writeSheet('discounts', currentDiscounts);

    // Refresh local cache
    await this.refreshDiscounts();

    return newDiscount;
  }

  // Update an existing discount
  async updateDiscount(id: number, updates: Partial<Discount>): Promise<Discount> {
    const currentDiscounts = await this.googleSheetsService.readSheet('discounts');
    const index = currentDiscounts.findIndex(d => d.id === id);
    
    if (index === -1) {
      throw new Error(`Discount with ID ${id} not found`);
    }

    const updatedDiscount: Discount = {
      ...currentDiscounts[index],
      ...updates,
      updated_at: new Date().toISOString()
    };

    currentDiscounts[index] = updatedDiscount;
    await this.googleSheetsService.writeSheet('discounts', currentDiscounts);

    // Refresh local cache
    await this.refreshDiscounts();

    return updatedDiscount;
  }

  // Delete a discount
  async deleteDiscount(id: number): Promise<void> {
    const currentDiscounts = await this.googleSheetsService.readSheet('discounts');
    const filteredDiscounts = currentDiscounts.filter(d => d.id !== id);
    
    if (filteredDiscounts.length === currentDiscounts.length) {
      throw new Error(`Discount with ID ${id} not found`);
    }

    await this.googleSheetsService.writeSheet('discounts', filteredDiscounts);

    // Refresh local cache
    await this.refreshDiscounts();
  }
}

// Export singleton instance
export const discountService = new DiscountService();
