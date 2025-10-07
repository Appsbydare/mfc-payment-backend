"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const router = (0, express_1.Router)();
router.post('/register', (req, res) => {
    res.json({ message: 'Register route - TODO' });
});
router.post('/login', (req, res) => {
    res.json({ message: 'Login route - TODO' });
});
router.get('/me', (req, res) => {
    res.json({ message: 'Get current user - TODO' });
});
router.post('/logout', (req, res) => {
    res.json({ message: 'Logout route - TODO' });
});
exports.default = router;
//# sourceMappingURL=auth.js.map