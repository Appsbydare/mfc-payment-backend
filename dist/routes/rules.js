"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const googleSheets_1 = require("../services/googleSheets");
const router = (0, express_1.Router)();
const googleSheetsService = new googleSheets_1.GoogleSheetsService();
const toNum = (v, d = 0) => {
    const n = parseFloat(String(v).replace('%', ''));
    return isNaN(n) ? d : n;
};
const normalizeRule = (r) => ({
    id: String(r.id || r.ID || '').trim() || '',
    rule_name: String(r.rule_name || r.name || r.rule || '').trim(),
    package_name: String(r.package_name || r.membership_name || r.name || '').trim(),
    session_type: (() => {
        const raw = String((r.session_type ?? r.category ?? '')).trim().toLowerCase();
        if (raw) {
            if (/^priv/.test(raw))
                return 'private';
            if (/^group/.test(raw))
                return 'group';
        }
        const privateFlag = String((r.privateSession ?? '')).toLowerCase();
        if (privateFlag === 'true' || privateFlag === '1')
            return 'private';
        return 'group';
    })(),
    price: toNum(r.price),
    sessions: toNum(r.sessions),
    sessions_per_pack: toNum(r.sessions_per_pack || r.sessions),
    unit_price: (() => {
        if (r.unit_price)
            return toNum(r.unit_price);
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
    attendance_alias: String(r.attendance_alias || r.attendanceAlias || '').trim(),
    payment_memo_alias: String(r.payment_memo_alias || r.paymentMemoAlias || '').trim(),
    created_at: r.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
});
router.get('/', async (req, res) => {
    try {
        const rules = await googleSheetsService.readSheet('rules');
        return res.json({ success: true, data: rules });
    }
    catch (e) {
        console.error('Rules list error:', e);
        return res.status(500).json({ success: false, message: 'Failed to load rules' });
    }
});
router.get('/:id', async (req, res) => {
    try {
        const rules = await googleSheetsService.readSheet('rules');
        const rule = rules.find((r) => String(r.id || r.ID) === String(req.params.id));
        if (!rule)
            return res.status(404).json({ success: false, message: 'Rule not found' });
        return res.json({ success: true, data: rule });
    }
    catch (e) {
        console.error('Rule get error:', e);
        return res.status(500).json({ success: false, message: 'Failed to load rule' });
    }
});
router.post('/', async (req, res) => {
    try {
        const input = normalizeRule(req.body || {});
        const rules = await googleSheetsService.readSheet('rules');
        const headers = rules[0] ? Object.keys(rules[0]) : Object.keys(input);
        let out = rules.map((r) => ({ ...headers.reduce((o, k) => ({ ...o, [k]: r[k] ?? '' }), {}) }));
        if (input.id) {
            let idx = out.findIndex((r) => String(r.id || r.ID) === String(input.id));
            if (idx === -1)
                return res.status(404).json({ success: false, message: 'Rule not found' });
            out[idx] = { ...out[idx], ...input };
        }
        else {
            const nextId = out.reduce((m, r) => Math.max(m, parseInt(r.id || r.ID || '0') || 0), 0) + 1;
            input.id = String(nextId);
            out.push({ ...headers.reduce((o, k) => ({ ...o, [k]: '' }), {}), ...input });
        }
        await googleSheetsService.writeSheet('rules', out);
        return res.json({ success: true, data: input });
    }
    catch (e) {
        console.error('Rule save error:', e);
        return res.status(500).json({ success: false, message: 'Failed to save rule' });
    }
});
router.delete('/:id', async (req, res) => {
    try {
        const rules = await googleSheetsService.readSheet('rules');
        const remaining = rules.filter((r) => String(r.id || r.ID) !== String(req.params.id));
        if (remaining.length === rules.length)
            return res.status(404).json({ success: false, message: 'Rule not found' });
        await googleSheetsService.writeSheet('rules', remaining);
        return res.json({ success: true });
    }
    catch (e) {
        console.error('Rule delete error:', e);
        return res.status(500).json({ success: false, message: 'Failed to delete rule' });
    }
});
router.get('/settings/all', async (req, res) => {
    try {
        const settings = await googleSheetsService.readSheet('settings');
        return res.json({ success: true, data: settings });
    }
    catch (e) {
        console.error('Settings list error:', e);
        return res.status(500).json({ success: false, message: 'Failed to load settings' });
    }
});
router.post('/settings/upsert', async (req, res) => {
    try {
        const payload = Array.isArray(req.body) ? req.body : [req.body];
        const settings = await googleSheetsService.readSheet('settings');
        const map = new Map(settings.map((r) => [String(r.key).toLowerCase(), r]));
        payload.forEach((item) => {
            const key = String(item.key).toLowerCase();
            map.set(key, { key: item.key, value: String(item.value ?? ''), description: item.description || '' });
        });
        const out = Array.from(map.values());
        await googleSheetsService.writeSheet('settings', out);
        return res.json({ success: true, data: out });
    }
    catch (e) {
        console.error('Settings upsert error:', e);
        return res.status(500).json({ success: false, message: 'Failed to save settings' });
    }
});
exports.default = router;
//# sourceMappingURL=rules.js.map