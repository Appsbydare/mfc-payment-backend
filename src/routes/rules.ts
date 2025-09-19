import { Router } from 'express';
import { GoogleSheetsService } from '../services/googleSheets';

const router = Router();
const googleSheetsService = new GoogleSheetsService();

const toNum = (v: any, d: number | null = 0): number | null => {
  const n = parseFloat(String(v).replace('%', ''));
  return isNaN(n) ? d : n;
};

const normalizeRule = (r: any) => ({
  id: String(r.id || r.ID || '').trim() || '',
  rule_name: String(r.rule_name || r.name || r.rule || '').trim(),
  package_name: String(r.package_name || r.membership_name || r.name || '').trim(),
  // Accept UI category labels (e.g., "Private Sessions", "Group Classes")
  // and booleans like privateSession, mapping to canonical 'private' | 'group'
  session_type: (() => {
    const raw = String((r.session_type ?? r.category ?? '') as any).trim().toLowerCase()
    if (raw) {
      if (/^priv/.test(raw)) return 'private'
      if (/^group/.test(raw)) return 'group'
    }
    const privateFlag = String((r.privateSession ?? '') as any).toLowerCase()
    if (privateFlag === 'true' || privateFlag === '1') return 'private'
    return 'group'
  })(),
  price: toNum(r.price),
  sessions: toNum(r.sessions),
  sessions_per_pack: toNum(r.sessions_per_pack || r.sessions),
  unit_price: (() => {
    if (r.unit_price) return toNum(r.unit_price);
    const price = toNum(r.price);
    const sessions = toNum(r.sessions || r.sessions_per_pack);
    return (price && sessions && price !== null && sessions !== null && sessions > 0) ? (price / sessions) : 0;
  })(),
  coach_percentage: toNum(r.coach_percentage || r.coachPct, null),
  bgm_percentage: toNum(r.bgm_percentage || r.bgmPct, null),
  management_percentage: toNum(r.management_percentage || r.mgmtPct, null),
  mfc_percentage: toNum(r.mfc_percentage || r.mfcPct, null),
  pricing_type: String(r.pricing_type || '').trim().toLowerCase(),
  per_week: toNum(r.per_week),
  fixed_rate: toNum(r.fixed_rate),
  match_offering_patterns: String(r.match_offering_patterns || '').trim(),
  allow_late_payment_window_days: String(r.allow_late_payment_window_days || '').trim(),
  is_fixed_rate: String(r.is_fixed_rate || r.fixed || '').trim(),
  allow_discounts: String(r.allow_discounts || r.allowDiscounts || '').trim(),
  notes: String(r.notes || '').trim(),
  // Alias fields for exact matching in verification
  attendance_alias: String(r.attendance_alias || r.attendanceAlias || '').trim(),
  payment_memo_alias: String(r.payment_memo_alias || r.paymentMemoAlias || '').trim(),
  created_at: r.created_at || new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

// @desc    List rules
// @route   GET /api/rules
// @access  Private
router.get('/', async (req, res) => {
  try {
    const rules = await googleSheetsService.readSheet('rules');
    return res.json({ success: true, data: rules });
  } catch (e) {
    console.error('Rules list error:', e);
    return res.status(500).json({ success: false, message: 'Failed to load rules' });
  }
});

// @desc    Get rule by id
// @route   GET /api/rules/:id
// @access  Private
router.get('/:id', async (req, res) => {
  try {
    const rules = await googleSheetsService.readSheet('rules');
    const rule = rules.find((r: any) => String(r.id || r.ID) === String(req.params.id));
    if (!rule) return res.status(404).json({ success: false, message: 'Rule not found' });
    return res.json({ success: true, data: rule });
  } catch (e) {
    console.error('Rule get error:', e);
    return res.status(500).json({ success: false, message: 'Failed to load rule' });
  }
});

// @desc    Create or update rule
// @route   POST /api/rules
// @access  Private
router.post('/', async (req, res) => {
  try {
    const input = normalizeRule(req.body || {});
    const rules = await googleSheetsService.readSheet('rules');
    const headers = rules[0] ? Object.keys(rules[0]) : Object.keys(input);
    let out = rules.map((r: any) => ({ ...headers.reduce((o, k) => ({ ...o, [k]: r[k] ?? '' }), {}) }));

    if (input.id) {
      let idx = out.findIndex((r: any) => String(r.id || r.ID) === String(input.id));
      if (idx === -1) return res.status(404).json({ success: false, message: 'Rule not found' });
      out[idx] = { ...out[idx], ...input };
    } else {
      const nextId = out.reduce((m: number, r: any) => Math.max(m, parseInt(r.id || r.ID || '0') || 0), 0) + 1;
      input.id = String(nextId);
      out.push({ ...headers.reduce((o, k) => ({ ...o, [k]: '' }), {}), ...input });
    }

    await googleSheetsService.writeSheet('rules', out);
    return res.json({ success: true, data: input });
  } catch (e) {
    console.error('Rule save error:', e);
    return res.status(500).json({ success: false, message: 'Failed to save rule' });
  }
});

// @desc    Delete rule
// @route   DELETE /api/rules/:id
// @access  Private
router.delete('/:id', async (req, res) => {
  try {
    const rules = await googleSheetsService.readSheet('rules');
    const remaining = rules.filter((r: any) => String(r.id || r.ID) !== String(req.params.id));
    if (remaining.length === rules.length) return res.status(404).json({ success: false, message: 'Rule not found' });
    await googleSheetsService.writeSheet('rules', remaining);
    return res.json({ success: true });
  } catch (e) {
    console.error('Rule delete error:', e);
    return res.status(500).json({ success: false, message: 'Failed to delete rule' });
  }
});

// @desc    Get all settings
// @route   GET /api/rules/settings/all
// @access  Private
router.get('/settings/all', async (req, res) => {
  try {
    const settings = await googleSheetsService.readSheet('settings');
    return res.json({ success: true, data: settings });
  } catch (e) {
    console.error('Settings list error:', e);
    return res.status(500).json({ success: false, message: 'Failed to load settings' });
  }
});

// @desc    Upsert settings
// @route   POST /api/rules/settings/upsert
// @access  Private
router.post('/settings/upsert', async (req, res) => {
  try {
    const payload = Array.isArray(req.body) ? req.body : [req.body];
    const settings = await googleSheetsService.readSheet('settings');
    const map = new Map(settings.map((r: any) => [String(r.key).toLowerCase(), r]));
    payload.forEach((item: any) => {
      const key = String(item.key).toLowerCase();
      map.set(key, { key: item.key, value: String(item.value ?? ''), description: item.description || '' });
    });
    const out = Array.from(map.values());
    await googleSheetsService.writeSheet('settings', out);
    return res.json({ success: true, data: out });
  } catch (e) {
    console.error('Settings upsert error:', e);
    return res.status(500).json({ success: false, message: 'Failed to save settings' });
  }
});

export default router;
