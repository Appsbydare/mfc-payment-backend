"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = exports.initializeDatabase = void 0;
const googleSheets_1 = require("../services/googleSheets");
Object.defineProperty(exports, "db", { enumerable: true, get: function () { return googleSheets_1.googleSheetsService; } });
const initializeDatabase = async () => {
    try {
        const hasGoogleSheetsConfig = process.env.GOOGLE_SHEETS_SPREADSHEET_ID &&
            process.env.GOOGLE_SHEETS_CLIENT_EMAIL &&
            process.env.GOOGLE_SHEETS_PRIVATE_KEY;
        if (!hasGoogleSheetsConfig) {
            console.log('⚠️ Google Sheets environment variables not configured, skipping database initialization');
            console.log('📝 Set GOOGLE_SHEETS_SPREADSHEET_ID, GOOGLE_SHEETS_CLIENT_EMAIL, and GOOGLE_SHEETS_PRIVATE_KEY to enable Google Sheets integration');
            return;
        }
        const isHealthy = await googleSheets_1.googleSheetsService.healthCheck();
        if (!isHealthy) {
            console.log('⚠️ Google Sheets service is not accessible, but API will continue to run');
            return;
        }
        await googleSheets_1.googleSheetsService.initializeDatabase();
        console.log('✅ Google Sheets database initialized successfully');
        console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    }
    catch (error) {
        console.error('❌ Failed to initialize Google Sheets database:', error);
        console.log('⚠️ API will continue to run without Google Sheets integration');
    }
};
exports.initializeDatabase = initializeDatabase;
//# sourceMappingURL=database.js.map