"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.googleSheetsService = exports.GoogleSheetsService = void 0;
const googleapis_1 = require("googleapis");
const google_auth_library_1 = require("google-auth-library");
class GoogleSheetsService {
    sheets;
    spreadsheetId;
    isConfigured = false;
    constructor() {
        this.initializeSheets();
    }
    async initializeSheets() {
        try {
            const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
            const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, '\n');
            const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
            if (!clientEmail || !privateKey || !spreadsheetId) {
                console.warn('⚠️ Google Sheets credentials not configured. Service will use mock data.');
                this.isConfigured = false;
                return;
            }
            const auth = new google_auth_library_1.JWT({
                email: clientEmail,
                key: privateKey,
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });
            this.sheets = googleapis_1.google.sheets({ version: 'v4', auth });
            this.spreadsheetId = spreadsheetId;
            this.isConfigured = true;
            console.log('✅ Google Sheets service initialized successfully');
        }
        catch (error) {
            console.error('❌ Failed to initialize Google Sheets service:', error);
            this.isConfigured = false;
        }
    }
    async readSheet(sheetName) {
        if (!this.isConfigured || !this.spreadsheetId) {
            console.warn('⚠️ Google Sheets not configured, returning empty array');
            return [];
        }
        try {
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: `${sheetName}!A:Z`,
            });
            const rows = response.data.values;
            if (!rows || rows.length === 0) {
                return [];
            }
            const headers = rows[0];
            const data = rows.slice(1).map((row) => {
                const obj = {};
                headers.forEach((header, index) => {
                    obj[header] = row[index] || '';
                });
                return obj;
            });
            return data;
        }
        catch (error) {
            console.error(`❌ Error reading sheet ${sheetName}:`, error);
            return [];
        }
    }
    async writeSheet(sheetName, data) {
        if (!this.isConfigured || !this.spreadsheetId) {
            console.warn('⚠️ Google Sheets not configured, skipping write operation');
            return;
        }
        try {
            if (data.length === 0) {
                console.warn(`⚠️ No data to write to sheet ${sheetName}`);
                return;
            }
            const headers = Object.keys(data[0]);
            const values = [headers, ...data.map(row => headers.map(header => row[header] || ''))];
            await this.sheets.spreadsheets.values.update({
                spreadsheetId: this.spreadsheetId,
                range: `${sheetName}!A1`,
                valueInputOption: 'RAW',
                requestBody: {
                    values,
                },
            });
            console.log(`✅ Successfully wrote ${data.length} rows to sheet ${sheetName}`);
        }
        catch (error) {
            console.error(`❌ Error writing to sheet ${sheetName}:`, error);
            throw error;
        }
    }
    async appendToSheet(sheetName, data) {
        if (!this.isConfigured || !this.spreadsheetId) {
            console.warn('⚠️ Google Sheets not configured, skipping append operation');
            return;
        }
        try {
            if (data.length === 0) {
                console.warn(`⚠️ No data to append to sheet ${sheetName}`);
                return;
            }
            const headers = Object.keys(data[0]);
            const values = data.map(row => headers.map(header => row[header] || ''));
            await this.sheets.spreadsheets.values.append({
                spreadsheetId: this.spreadsheetId,
                range: `${sheetName}!A:Z`,
                valueInputOption: 'RAW',
                insertDataOption: 'INSERT_ROWS',
                requestBody: {
                    values,
                },
            });
            console.log(`✅ Successfully appended ${data.length} rows to sheet ${sheetName}`);
        }
        catch (error) {
            console.error(`❌ Error appending to sheet ${sheetName}:`, error);
            throw error;
        }
    }
    async updateRow(sheetName, rowIndex, data) {
        if (!this.isConfigured || !this.spreadsheetId) {
            console.warn('⚠️ Google Sheets not configured, skipping update operation');
            return;
        }
        try {
            const headers = Object.keys(data);
            const values = [headers.map(header => data[header] || '')];
            await this.sheets.spreadsheets.values.update({
                spreadsheetId: this.spreadsheetId,
                range: `${sheetName}!A${rowIndex + 1}:Z${rowIndex + 1}`,
                valueInputOption: 'RAW',
                requestBody: {
                    values,
                },
            });
            console.log(`✅ Successfully updated row ${rowIndex + 1} in sheet ${sheetName}`);
        }
        catch (error) {
            console.error(`❌ Error updating row in sheet ${sheetName}:`, error);
            throw error;
        }
    }
    async clearSheet(sheetName) {
        if (!this.isConfigured || !this.spreadsheetId) {
            console.warn('⚠️ Google Sheets not configured, skipping clear operation');
            return;
        }
        try {
            await this.sheets.spreadsheets.values.clear({
                spreadsheetId: this.spreadsheetId,
                range: `${sheetName}!A:Z`,
            });
            console.log(`✅ Successfully cleared sheet ${sheetName}`);
        }
        catch (error) {
            console.error(`❌ Error clearing sheet ${sheetName}:`, error);
            throw error;
        }
    }
    async deleteRow(sheetName, rowIndex) {
        if (!this.isConfigured || !this.spreadsheetId) {
            console.warn('⚠️ Google Sheets not configured, skipping delete operation');
            return;
        }
        try {
            const sheetId = await this.getSheetId(sheetName);
            if (!sheetId) {
                throw new Error(`Sheet ${sheetName} not found`);
            }
            await this.sheets.spreadsheets.batchUpdate({
                spreadsheetId: this.spreadsheetId,
                requestBody: {
                    requests: [
                        {
                            deleteDimension: {
                                range: {
                                    sheetId,
                                    dimension: 'ROWS',
                                    startIndex: rowIndex,
                                    endIndex: rowIndex + 1,
                                },
                            },
                        },
                    ],
                },
            });
            console.log(`✅ Successfully deleted row ${rowIndex + 1} from sheet ${sheetName}`);
        }
        catch (error) {
            console.error(`❌ Error deleting row from sheet ${sheetName}:`, error);
            throw error;
        }
    }
    async getSheetId(sheetName) {
        try {
            const response = await this.sheets.spreadsheets.get({
                spreadsheetId: this.spreadsheetId,
            });
            const sheet = response.data.sheets?.find((s) => s.properties.title === sheetName);
            return sheet?.properties.sheetId || null;
        }
        catch (error) {
            console.error(`❌ Error getting sheet ID for ${sheetName}:`, error);
            return null;
        }
    }
    async initializeDatabase() {
        try {
            const defaultData = {
                attendance: [],
                payments: [],
                rules: [
                    {
                        id: 1,
                        membership_name: 'Adult Single - Pay as You Go',
                        session_type: 'group',
                        coach_percentage: 80,
                        bgm_percentage: 10,
                        management_percentage: 5,
                        mfc_percentage: 5,
                        unit_price: 15.00,
                        active: true,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    },
                    {
                        id: 2,
                        membership_name: 'Adult Pay Monthly - 3 x Week',
                        session_type: 'group',
                        coach_percentage: 80,
                        bgm_percentage: 10,
                        management_percentage: 5,
                        mfc_percentage: 5,
                        unit_price: 12.00,
                        active: true,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    },
                    {
                        id: 3,
                        membership_name: '1 to 1 Private Combat Session',
                        session_type: 'private',
                        coach_percentage: 80,
                        bgm_percentage: 10,
                        management_percentage: 5,
                        mfc_percentage: 5,
                        unit_price: 35.00,
                        active: true,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    },
                    {
                        id: 4,
                        membership_name: 'Group Private Session',
                        session_type: 'private',
                        coach_percentage: 80,
                        bgm_percentage: 10,
                        management_percentage: 5,
                        mfc_percentage: 5,
                        unit_price: 75.00,
                        active: true,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    }
                ],
                discounts: [
                    {
                        id: 1,
                        discount_code: 'WELCOME',
                        name: 'Welcome Discount',
                        applicable_percentage: 20,
                        coach_payment_type: 'percentage',
                        match_type: 'exact',
                        active: true,
                        notes: '20% discount for new members',
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    },
                    {
                        id: 2,
                        discount_code: 'STUDENT',
                        name: 'Student Discount',
                        applicable_percentage: 15,
                        coach_payment_type: 'percentage',
                        match_type: 'exact',
                        active: true,
                        notes: '15% discount for students',
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    },
                    {
                        id: 3,
                        discount_code: 'FAMILY',
                        name: 'Family Discount',
                        applicable_percentage: 10,
                        coach_payment_type: 'percentage',
                        match_type: 'exact',
                        active: true,
                        notes: '10% discount for family members',
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    },
                    {
                        id: 4,
                        discount_code: 'discount',
                        name: 'Generic Discount',
                        applicable_percentage: 0,
                        coach_payment_type: 'free',
                        match_type: 'contains',
                        active: true,
                        notes: 'Free classes - everyone gets paid zero',
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    }
                ],
                coaches: [],
                reports: [],
                settings: [
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
                ]
            };
            for (const [sheetName, data] of Object.entries(defaultData)) {
                try {
                    const existing = await this.readSheet(sheetName);
                    if (Array.isArray(existing) && existing.length > 0) {
                        console.log(`ℹ️ Sheet ${sheetName} already has ${existing.length} rows; skipping default initialization`);
                        continue;
                    }
                    await this.writeSheet(sheetName, data);
                    console.log(`✅ Initialized ${sheetName} with ${data.length} default rows`);
                }
                catch (innerError) {
                    console.warn(`⚠️ Skipping initialization for ${sheetName} due to read/write error:`, innerError);
                }
            }
            console.log('✅ Google Sheets database initialized successfully');
        }
        catch (error) {
            console.error('❌ Error initializing Google Sheets database:', error);
            throw error;
        }
    }
    async healthCheck() {
        try {
            if (!this.isConfigured) {
                return false;
            }
            await this.sheets.spreadsheets.get({
                spreadsheetId: this.spreadsheetId,
            });
            return true;
        }
        catch (error) {
            console.error('❌ Google Sheets health check failed:', error);
            return false;
        }
    }
}
exports.GoogleSheetsService = GoogleSheetsService;
exports.googleSheetsService = new GoogleSheetsService();
//# sourceMappingURL=googleSheets.js.map