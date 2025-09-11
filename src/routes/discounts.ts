import { Router } from 'express';
import { discountService } from '../services/discountService';

const router = Router();

// @desc    Get all discounts
// @route   GET /api/discounts
// @access  Private
router.get('/', async (req, res) => {
  try {
    // First try to get discounts directly from Google Sheets
    const { GoogleSheetsService } = await import('../services/googleSheets');
    const sheetsService = new GoogleSheetsService();
    
    let discounts: any[] = [];
    try {
      const rawData = await sheetsService.readSheet('discounts');
      console.log('Raw discount data from sheets:', rawData);
      
      // Transform the data based on the actual Google Sheets structure
      discounts = rawData.map((row: any, index: number) => ({
        id: row.id || (index + 1),
        discount_code: row.discount_code || row['discount_code'] || '',
        name: row.name || row['name'] || '',
        applicable_percentage: parseFloat(row.applicable_percentage || row['applicable_percentage'] || '0'),
        coach_payment_type: (row.coach_payment_type || row['coach_payment_type'] || 'partial').toLowerCase(),
        match_type: (row.match_type || row['match_type'] || 'exact').toLowerCase(),
        active: row.active === true || row.active === 'TRUE' || row.active === '1' || row.active === 1,
        notes: row.notes || row['notes'] || '',
        created_at: row.created_at || row['created_at'] || new Date().toISOString(),
        updated_at: row.updated_at || row['updated_at'] || new Date().toISOString()
      })).filter(discount => discount.discount_code && discount.name); // Filter out empty rows
    } catch (sheetsError) {
      console.error('Error reading from sheets, falling back to service:', sheetsError);
      discounts = await discountService.getActiveDiscounts();
    }

    res.json({
      success: true,
      data: discounts
    });
  } catch (error) {
    console.error('Error fetching discounts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch discounts'
    });
  }
});

// @desc    Get all discounts (including inactive)
// @route   GET /api/discounts/all
// @access  Private
router.get('/all', async (req, res) => {
  try {
    await discountService.refreshDiscounts();
    const discounts = await discountService.getActiveDiscounts();
    res.json({
      success: true,
      data: discounts
    });
  } catch (error) {
    console.error('Error fetching all discounts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch all discounts'
    });
  }
});

// @desc    Classify a discount from memo text
// @route   POST /api/discounts/classify
// @access  Private
router.post('/classify', async (req, res) => {
  try {
    const { memo } = req.body;
    
    if (!memo) {
      return res.status(400).json({
        success: false,
        message: 'Memo text is required'
      });
    }

    const classification = await discountService.classifyDiscount(memo);
    
    res.json({
      success: true,
      data: classification
    });
  } catch (error) {
    console.error('Error classifying discount:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to classify discount'
    });
  }
});

// @desc    Extract discount data from payments
// @route   POST /api/discounts/extract-from-payments
// @access  Private
router.post('/extract-from-payments', async (req, res) => {
  try {
    const { payments } = req.body;
    
    if (!payments || !Array.isArray(payments)) {
      return res.status(400).json({
        success: false,
        message: 'Payments array is required'
      });
    }

    const discountData = await discountService.extractDiscountDataFromPayments(payments);
    
    res.json({
      success: true,
      data: discountData
    });
  } catch (error) {
    console.error('Error extracting discount data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to extract discount data'
    });
  }
});

// @desc    Create a new discount
// @route   POST /api/discounts
// @access  Private
router.post('/', async (req, res) => {
  try {
    const {
      discount_code,
      name,
      applicable_percentage,
      coach_payment_type,
      match_type,
      active,
      notes
    } = req.body;

    // Validation
    if (!discount_code || !name || !coach_payment_type || !match_type) {
      return res.status(400).json({
        success: false,
        message: 'discount_code, name, coach_payment_type, and match_type are required'
      });
    }

    if (!['full', 'partial', 'free'].includes(coach_payment_type)) {
      return res.status(400).json({
        success: false,
        message: 'coach_payment_type must be one of: full, partial, free'
      });
    }

    if (!['exact', 'contains', 'regex'].includes(match_type)) {
      return res.status(400).json({
        success: false,
        message: 'match_type must be one of: exact, contains, regex'
      });
    }

    const newDiscount = await discountService.createDiscount({
      discount_code,
      name,
      applicable_percentage: applicable_percentage || 0,
      coach_payment_type,
      match_type,
      active: active !== false, // Default to true
      notes
    });

    res.status(201).json({
      success: true,
      data: newDiscount,
      message: 'Discount created successfully'
    });
  } catch (error) {
    console.error('Error creating discount:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create discount'
    });
  }
});

// @desc    Update a discount
// @route   PUT /api/discounts/:id
// @access  Private
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Remove fields that shouldn't be updated
    delete updates.id;
    delete updates.created_at;

    const updatedDiscount = await discountService.updateDiscount(parseInt(id), updates);

    res.json({
      success: true,
      data: updatedDiscount,
      message: 'Discount updated successfully'
    });
  } catch (error) {
    console.error('Error updating discount:', error);
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to update discount'
    });
  }
});

// @desc    Delete a discount
// @route   DELETE /api/discounts/:id
// @access  Private
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    await discountService.deleteDiscount(parseInt(id));

    res.json({
      success: true,
      message: 'Discount deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting discount:', error);
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to delete discount'
    });
  }
});

// @desc    Initialize discounts sheet if it doesn't exist
// @route   POST /api/discounts/initialize
// @access  Private
router.post('/initialize', async (req, res) => {
  try {
    const { GoogleSheetsService } = await import('../services/googleSheets');
    const sheetsService = new GoogleSheetsService();
    
    // Try to read the discounts sheet first
    let existingData: any[] = [];
    try {
      existingData = await sheetsService.readSheet('discounts');
    } catch (error) {
      console.log('Discounts sheet does not exist, will create it');
    }
    
    // If no data exists, initialize with default data
    if (existingData.length === 0) {
      const defaultDiscounts = [
        {
          id: 1,
          discount_code: '30% OFF YOUR FIRST MONTH DISCOUNT',
          name: '30% First Month Discount Alt',
          applicable_percentage: 30,
          coach_payment_type: 'partial',
          match_type: 'exact',
          active: true,
          notes: 'Alternative wording for 30% first month discount',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        },
        {
          id: 2,
          discount_code: 'BGM MULTIPACK DISCOUNT',
          name: 'BGM Multipack Discount',
          applicable_percentage: 15,
          coach_payment_type: 'partial',
          match_type: 'exact',
          active: true,
          notes: 'Bulk discount for BGM multipacks',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        },
        // Add more default discounts based on the Google Sheets image
        {
          id: 3,
          discount_code: 'BOXING DISCOUNT',
          name: 'Boxing Discount',
          applicable_percentage: 100,
          coach_payment_type: 'free',
          match_type: 'exact',
          active: true,
          notes: 'Free boxing classes - everyone gets paid zero',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ];
      
      await sheetsService.writeSheet('discounts', defaultDiscounts);
      
      res.json({
        success: true,
        message: 'Discounts sheet initialized with default data',
        data: defaultDiscounts
      });
    } else {
      res.json({
        success: true,
        message: 'Discounts sheet already exists',
        data: existingData
      });
    }
  } catch (error) {
    console.error('Error initializing discounts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initialize discounts sheet'
    });
  }
});

// @desc    Debug Google Sheets connection
// @route   GET /api/discounts/debug
// @access  Private
router.get('/debug', async (req, res) => {
  try {
    const { GoogleSheetsService } = await import('../services/googleSheets');
    const sheetsService = new GoogleSheetsService();
    
    // Test reading the discounts sheet
    const rawData = await sheetsService.readSheet('discounts');
    
    res.json({
      success: true,
      debug: {
        rawDataCount: rawData.length,
        rawDataSample: rawData.slice(0, 3),
        rawDataKeys: rawData.length > 0 ? Object.keys(rawData[0]) : [],
        fullData: rawData
      }
    });
  } catch (error) {
    console.error('Debug error:', error);
    res.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
  }
});

// @desc    Test discount matching
// @route   POST /api/discounts/test-match
// @access  Private
router.post('/test-match', async (req, res) => {
  try {
    const { memo, discount_code, match_type } = req.body;
    
    if (!memo || !discount_code || !match_type) {
      return res.status(400).json({
        success: false,
        message: 'memo, discount_code, and match_type are required'
      });
    }

    // Create a temporary discount for testing
    const testDiscount = {
      id: 0,
      discount_code,
      name: 'Test Discount',
      applicable_percentage: 0,
      coach_payment_type: 'partial' as const,
      match_type: match_type as 'exact' | 'contains' | 'regex',
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Test the match
    const match = discountService['matchDiscount'](memo, testDiscount);
    
    res.json({
      success: true,
      data: {
        matches: !!match,
        match_details: match
      }
    });
  } catch (error) {
    console.error('Error testing discount match:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to test discount match'
    });
  }
});

export default router;
