"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.googleSheetsService = exports.GoogleSheetsService = void 0;
const googleapis_1 = require("googleapis");
const google_auth_library_1 = require("google-auth-library");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
class GoogleSheetsService {
    constructor() {
        this.isConfigured = false;
        const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
        const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
        const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
        if (!spreadsheetId || !clientEmail || !privateKey) {
            console.log('⚠️ Google Sheets configuration incomplete, service will be disabled');
            this.isConfigured = false;
            return;
        }
        this.spreadsheetId = spreadsheetId;
        this.isConfigured = true;
        this.initializeSheets();
    }
    initializeSheets() {
        if (!this.isConfigured)
            return;
        const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
        const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
        if (!clientEmail || !privateKey) {
            console.log('⚠️ Missing Google Sheets credentials');
            this.isConfigured = false;
            return;
        }
        try {
            const auth = new google_auth_library_1.JWT({
                email: clientEmail,
                key: privateKey.replace(/\\n/g, '\n'),
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });
            this.sheets = googleapis_1.google.sheets({ version: 'v4', auth });
        }
        catch (error) {
            console.error('❌ Failed to initialize Google Sheets:', error);
            this.isConfigured = false;
        }
    }
    async readSheet(sheetName) {
        if (!this.isConfigured || !this.spreadsheetId) {
            console.log('⚠️ Google Sheets not configured, returning empty data');
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
            console.error(`Error reading sheet ${sheetName}:`, error);
            throw new Error(`Failed to read sheet: ${sheetName}`);
        }
    }
    async writeSheet(sheetName, data) {
        if (!this.isConfigured || !this.spreadsheetId) {
            console.log('⚠️ Google Sheets not configured, skipping write operation');
            return;
        }
        try {
            if (data.length === 0)
                return;
            const headers = Object.keys(data[0]);
            console.log(`Writing to sheet ${sheetName} with headers:`, headers);
            console.log(`First row data:`, data[0]);
            const values = [
                headers,
                ...data.map(row => headers.map(header => row[header] || ''))
            ];
            console.log(`Values to write (first 2 rows):`, values.slice(0, 2));
            console.log(`First row values:`, values[1]);
            await this.sheets.spreadsheets.values.clear({
                spreadsheetId: this.spreadsheetId,
                range: `${sheetName}!A:Z`,
            });
            await this.sheets.spreadsheets.values.append({
                spreadsheetId: this.spreadsheetId,
                range: `${sheetName}!A1`,
                valueInputOption: 'RAW',
                insertDataOption: 'OVERWRITE',
                resource: { values },
            });
            console.log(`Successfully wrote ${data.length} rows to sheet ${sheetName}`);
        }
        catch (error) {
            console.error(`Error writing to sheet ${sheetName}:`, error);
            throw new Error(`Failed to write to sheet: ${sheetName}`);
        }
    }
    async getHeaders(sheetName) {
        if (!this.isConfigured || !this.spreadsheetId) {
            return [];
        }
        try {
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: `${sheetName}!A1:Z1`,
            });
            const rows = response.data.values || [];
            return rows[0] || [];
        }
        catch (error) {
            console.error(`Error getting headers for sheet ${sheetName}:`, error);
            return [];
        }
    }
    async appendRow(sheetName, row) {
        if (!this.isConfigured || !this.spreadsheetId) {
            console.log('⚠️ Google Sheets not configured, skipping appendRow');
            return;
        }
        try {
            const headers = await this.getHeaders(sheetName);
            const ordered = headers.length > 0 ? headers.map(h => row[h] ?? '') : Object.values(row);
            await this.sheets.spreadsheets.values.append({
                spreadsheetId: this.spreadsheetId,
                range: `${sheetName}!A1`,
                valueInputOption: 'RAW',
                insertDataOption: 'INSERT_ROWS',
                resource: { values: [ordered] },
            });
        }
        catch (error) {
            console.error(`Error appending row to sheet ${sheetName}:`, error);
            throw new Error(`Failed to append row to sheet: ${sheetName}`);
        }
    }
    async updateRowByIndex(sheetName, dataRowIndex, row) {
        if (!this.isConfigured || !this.spreadsheetId) {
            console.log('⚠️ Google Sheets not configured, skipping updateRowByIndex');
            return;
        }
        try {
            const headers = await this.getHeaders(sheetName);
            const ordered = headers.length > 0 ? headers.map(h => row[h] ?? '') : Object.values(row);
            const targetRowNumber = dataRowIndex + 2; // +1 to skip header, +1 for 1-based index
            await this.sheets.spreadsheets.values.update({
                spreadsheetId: this.spreadsheetId,
                range: `${sheetName}!A${targetRowNumber}`,
                valueInputOption: 'RAW',
                resource: { values: [ordered] },
            });
        }
        catch (error) {
            console.error(`Error updating row in sheet ${sheetName}:`, error);
            throw new Error(`Failed to update row in sheet: ${sheetName}`);
        }
    }
    async findDataRowIndexById(sheetName, id, idColumnName = 'id') {
        const rows = await this.readSheet(sheetName);
        const lowerIdCol = String(idColumnName).toLowerCase();
        const index = rows.findIndex(r => String(r[lowerIdCol] ?? r[idColumnName] ?? r.ID ?? r.id) === String(id));
        return index; // -1 if not found
    }
    async deleteRowById(sheetName, id, idColumnName = 'id') {
        if (!this.isConfigured || !this.spreadsheetId) {
            console.log('⚠️ Google Sheets not configured, skipping deleteRowById');
            return false;
        }
        const dataIndex = await this.findDataRowIndexById(sheetName, id, idColumnName);
        if (dataIndex === -1) return false;
        // Sheet index including header (header is row 0), first data row is 1
        const sheetRowStartIndex = dataIndex + 1;
        await this.deleteRow(sheetName, sheetRowStartIndex);
        return true;
    }
    async appendToSheet(sheetName, data) {
        if (!this.isConfigured || !this.spreadsheetId) {
            console.log('⚠️ Google Sheets not configured, skipping append operation');
            return;
        }
        try {
            if (data.length === 0)
                return;
            const headers = Object.keys(data[0]);
            console.log(`Appending to sheet ${sheetName} with headers:`, headers);
            console.log(`First row data:`, data[0]);
            const values = [
                headers,
                ...data.map(row => headers.map(header => row[header] || ''))
            ];
            console.log(`Values to append (first 2 rows):`, values.slice(0, 2));
            await this.sheets.spreadsheets.values.update({
                spreadsheetId: this.spreadsheetId,
                range: `${sheetName}!A1`,
                valueInputOption: 'RAW',
                resource: { values },
            });
            console.log(`Successfully appended ${data.length} rows to sheet ${sheetName}`);
        }
        catch (error) {
            console.error(`Error appending to sheet ${sheetName}:`, error);
            throw new Error(`Failed to append to sheet: ${sheetName}`);
        }
    }
    async updateRow(sheetName, rowIndex, data) {
        try {
            const headers = Object.keys(data);
            const values = [headers.map(header => data[header] || '')];
            await this.sheets.spreadsheets.values.update({
                spreadsheetId: this.spreadsheetId,
                range: `${sheetName}!A${rowIndex + 1}`,
                valueInputOption: 'RAW',
                resource: { values },
            });
        }
        catch (error) {
            console.error(`Error updating row in sheet ${sheetName}:`, error);
            throw new Error(`Failed to update row in sheet: ${sheetName}`);
        }
    }
    async clearSheet(sheetName) {
        if (!this.isConfigured || !this.spreadsheetId) {
            console.log('⚠️ Google Sheets not configured, skipping clear operation');
            return;
        }
        try {
            await this.sheets.spreadsheets.values.clear({
                spreadsheetId: this.spreadsheetId,
                range: `${sheetName}!A:Z`,
            });
            console.log(`Cleared sheet ${sheetName}`);
        }
        catch (error) {
            console.error(`Error clearing sheet ${sheetName}:`, error);
            throw new Error(`Failed to clear sheet: ${sheetName}`);
        }
    }
    async deleteRow(sheetName, rowIndex) {
        try {
            await this.sheets.spreadsheets.batchUpdate({
                spreadsheetId: this.spreadsheetId,
                resource: {
                    requests: [
                        {
                            deleteDimension: {
                                range: {
                                    sheetId: await this.getSheetId(sheetName),
                                    dimension: 'ROWS',
                                    startIndex: rowIndex,
                                    endIndex: rowIndex + 1,
                                },
                            },
                        },
                    ],
                },
            });
        }
        catch (error) {
            console.error(`Error deleting row from sheet ${sheetName}:`, error);
            throw new Error(`Failed to delete row from sheet: ${sheetName}`);
        }
    }
    async getSheetId(sheetName) {
        try {
            const response = await this.sheets.spreadsheets.get({
                spreadsheetId: this.spreadsheetId,
            });
            const sheet = response.data.sheets.find((s) => s.properties.title === sheetName);
            if (!sheet) {
                throw new Error(`Sheet ${sheetName} not found`);
            }
            return sheet.properties.sheetId;
        }
        catch (error) {
            console.error(`Error getting sheet ID for ${sheetName}:`, error);
            throw new Error(`Failed to get sheet ID: ${sheetName}`);
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
                        rule_name: 'Group Classes Default',
                        package_name: '',
                        session_type: 'group',
                        price: 0,
                        sessions: 1,
                        coach_percentage: 43.5,
                        bgm_percentage: 30.0,
                        management_percentage: 8.5,
                        mfc_percentage: 18.0,
                        is_fixed_rate: false,
                        allow_discounts: true,
                        tax_exempt: false,
                        notes: 'Default rule for group classes',
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    },
                    {
                        id: 2,
                        rule_name: 'Private Sessions Default',
                        package_name: '',
                        session_type: 'private',
                        price: 0,
                        sessions: 1,
                        coach_percentage: 80.0,
                        bgm_percentage: 15.0,
                        management_percentage: 0.0,
                        mfc_percentage: 5.0,
                        is_fixed_rate: false,
                        allow_discounts: true,
                        tax_exempt: false,
                        notes: 'Default rule for private sessions',
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    }
                ],
                discounts: [
                    {
                        id: 1,
                        discount_code: 'LOYALTY: 1 TO 1 - SINGLE CLASS DISCOUNT',
                        name: 'Loyalty 1-to-1 Single Class Discount',
                        applicable_percentage: 12.5,
                        coach_payment_type: 'partial',
                        match_type: 'exact',
                        active: true,
                        notes: '12.5% discount on single private sessions for loyalty members',
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    },
                    {
                        id: 2,
                        discount_code: 'MindBody Switch',
                        name: 'MindBody Switch',
                        applicable_percentage: 0,
                        coach_payment_type: 'full',
                        match_type: 'exact',
                        active: true,
                        notes: 'Treat as regular full price paying customer',
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    },
                    {
                        id: 3,
                        discount_code: 'Freedom Pass',
                        name: 'Freedom Pass',
                        applicable_percentage: 0,
                        coach_payment_type: 'full',
                        match_type: 'exact',
                        active: true,
                        notes: 'Treat as regular full price paying customer',
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
                await this.writeSheet(sheetName, data);
            }
            console.log('✅ Google Sheets database initialized successfully');
        }
        catch (error) {
            console.error('❌ Error initializing Google Sheets database:', error);
            throw error;
        }
    }
    async healthCheck() {
        if (!this.isConfigured || !this.spreadsheetId) {
            console.log('⚠️ Google Sheets not configured, health check returning false');
            return false;
        }
        try {
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