"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const router = (0, express_1.Router)();
router.post('/monthly', (req, res) => {
    res.json({ message: 'Generate monthly report - TODO' });
});
router.post('/payslip', (req, res) => {
    res.json({ message: 'Generate coach payslip - TODO' });
});
router.post('/bgm', (req, res) => {
    res.json({ message: 'Generate BGM report - TODO' });
});
router.get('/history', (req, res) => {
    res.json({ message: 'Get report history - TODO' });
});
exports.default = router;
//# sourceMappingURL=reports.js.map