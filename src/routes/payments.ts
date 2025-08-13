import { Router } from 'express';
import { ruleService, PaymentRule, GlobalSettings } from '../services/ruleService';

const router = Router();

// @desc    Calculate payments
// @route   POST /api/payments/calculate
// @access  Private
router.post('/calculate', (req, res) => {
  res.json({ message: 'Calculate payments - TODO' });
});

// @desc    Get all payment rules
// @route   GET /api/payments/rules
// @access  Private
router.get('/rules', async (req, res) => {
  try {
    const rules = await ruleService.getAllRules();
    res.json({
      success: true,
      data: rules,
      message: 'Payment rules retrieved successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to retrieve payment rules',
      errors: [error instanceof Error ? error.message : 'Unknown error']
    });
  }
});

// @desc    Get global default rules
// @route   GET /api/payments/rules/global
// @access  Private
router.get('/rules/global', async (req, res) => {
  try {
    const globalRules = await ruleService.getGlobalRules();
    res.json({
      success: true,
      data: globalRules,
      message: 'Global payment rules retrieved successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to retrieve global payment rules',
      errors: [error instanceof Error ? error.message : 'Unknown error']
    });
  }
});

// @desc    Get global default rules
// @route   GET /api/payments/rules/global
// @access  Private
router.get('/rules/global', async (req, res) => {
  try {
    const globalRules = await ruleService.getGlobalRules();
    res.json({
      success: true,
      data: globalRules,
      message: 'Global payment rules retrieved successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to retrieve global payment rules',
      errors: [error instanceof Error ? error.message : 'Unknown error']
    });
  }
});

// @desc    Update global default rules
// @route   PUT /api/payments/rules/global
// @access  Private
router.put('/rules/global', async (req, res) => {
  try {
    const { rules } = req.body;
    
    if (!Array.isArray(rules)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        errors: ['Rules must be an array']
      });
    }

    // Update each global rule
    const updatedRules: PaymentRule[] = [];
    for (const ruleData of rules) {
      if (ruleData.id) {
        const updatedRule = await ruleService.updateRule(ruleData.id, ruleData);
        updatedRules.push(updatedRule);
      } else {
        const newRule = await ruleService.createRule(ruleData);
        updatedRules.push(newRule);
      }
    }

    res.json({
      success: true,
      data: updatedRules,
      message: 'Global payment rules updated successfully'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to update global payment rules',
      errors: [error instanceof Error ? error.message : 'Unknown error']
    });
  }
});

// @desc    Get payment rule by ID
// @route   GET /api/payments/rules/:id
// @access  Private
router.get('/rules/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid rule ID',
        errors: ['Rule ID must be a valid number']
      });
    }

    const rule = await ruleService.getRuleById(id);
    if (!rule) {
      return res.status(404).json({
        success: false,
        message: 'Rule not found',
        errors: ['Rule with specified ID does not exist']
      });
    }

    res.json({
      success: true,
      data: rule,
      message: 'Payment rule retrieved successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to retrieve payment rule',
      errors: [error instanceof Error ? error.message : 'Unknown error']
    });
  }
});

// @desc    Create new payment rule
// @route   POST /api/payments/rules
// @access  Private
router.post('/rules', async (req, res) => {
  try {
    const ruleData = req.body;
    const newRule = await ruleService.createRule(ruleData);
    
    res.status(201).json({
      success: true,
      data: newRule,
      message: 'Payment rule created successfully'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to create payment rule',
      errors: [error instanceof Error ? error.message : 'Unknown error']
    });
  }
});

// @desc    Update payment rule
// @route   PUT /api/payments/rules/:id
// @access  Private
router.put('/rules/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid rule ID',
        errors: ['Rule ID must be a valid number']
      });
    }

    const ruleData = req.body;
    const updatedRule = await ruleService.updateRule(id, ruleData);
    
    res.json({
      success: true,
      data: updatedRule,
      message: 'Payment rule updated successfully'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to update payment rule',
      errors: [error instanceof Error ? error.message : 'Unknown error']
    });
  }
});

// @desc    Delete payment rule
// @route   DELETE /api/payments/rules/:id
// @access  Private
router.delete('/rules/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid rule ID',
        errors: ['Rule ID must be a valid number']
      });
    }

    await ruleService.deleteRule(id);
    
    res.json({
      success: true,
      message: 'Payment rule deleted successfully'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to delete payment rule',
      errors: [error instanceof Error ? error.message : 'Unknown error']
    });
  }
});



// @desc    Get global settings
// @route   GET /api/payments/settings
// @access  Private
router.get('/settings', async (req, res) => {
  try {
    const settings = await ruleService.getGlobalSettings();
    res.json({
      success: true,
      data: settings,
      message: 'Global settings retrieved successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to retrieve global settings',
      errors: [error instanceof Error ? error.message : 'Unknown error']
    });
  }
});

// @desc    Update global settings
// @route   PUT /api/payments/settings
// @access  Private
router.put('/settings', async (req, res) => {
  try {
    const settings: GlobalSettings[] = req.body;
    
    if (!Array.isArray(settings)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        errors: ['Settings must be an array']
      });
    }

    await ruleService.updateGlobalSettings(settings);
    
    res.json({
      success: true,
      message: 'Global settings updated successfully'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to update global settings',
      errors: [error instanceof Error ? error.message : 'Unknown error']
    });
  }
});

// @desc    Get coach payments
// @route   GET /api/payments/coaches
// @access  Private
router.get('/coaches', (req, res) => {
  res.json({ message: 'Get coach payments - TODO' });
});

// @desc    Get BGM payments
// @route   GET /api/payments/bgm
// @access  Private
router.get('/bgm', (req, res) => {
  res.json({ message: 'Get BGM payments - TODO' });
});

export default router; 