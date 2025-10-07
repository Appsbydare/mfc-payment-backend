"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const compression_1 = __importDefault(require("compression"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const dotenv_1 = __importDefault(require("dotenv"));
require("express-async-errors");
const errorHandler_1 = require("./middleware/errorHandler");
const notFound_1 = require("./middleware/notFound");
const database_1 = require("./config/database");
const auth_1 = __importDefault(require("./routes/auth"));
const data_1 = __importDefault(require("./routes/data"));
const reports_1 = __importDefault(require("./routes/reports"));
const discounts_1 = __importDefault(require("./routes/discounts"));
const rules_1 = __importDefault(require("./routes/rules"));
const attendanceVerification_1 = __importDefault(require("./routes/attendanceVerification"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 5000;
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({
    origin: process.env.CORS_ORIGIN || 'https://mfc-payment-frontend.vercel.app',
    credentials: true
}));
const limiter = (0, express_rate_limit_1.default)({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
    message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '10mb' }));
app.use((0, compression_1.default)());
if (process.env.NODE_ENV === 'development') {
    app.use((0, morgan_1.default)('dev'));
}
else {
    app.use((0, morgan_1.default)('combined'));
}
app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        message: 'MFC Payment System API is running',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        version: '1.0.0'
    });
});
app.use('/api/auth', auth_1.default);
app.use('/api/data', data_1.default);
app.use('/api/reports', reports_1.default);
app.use('/api/discounts', discounts_1.default);
app.use('/api/rules', rules_1.default);
app.use('/api/attendance-verification', attendanceVerification_1.default);
app.use(notFound_1.notFound);
app.use(errorHandler_1.errorHandler);
const startServer = async () => {
    try {
        await (0, database_1.initializeDatabase)();
        app.listen(PORT, () => {
            console.log(`🚀 MFC Payment System API running on port ${PORT}`);
            console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
            console.log(`🌐 CORS Origin: ${process.env.CORS_ORIGIN || 'https://mfc-payment-frontend.vercel.app'}`);
        });
    }
    catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
};
startServer();
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    process.exit(0);
});
process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    process.exit(0);
});
exports.default = app;
//# sourceMappingURL=index.js.map