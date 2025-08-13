import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import dotenv from 'dotenv';

dotenv.config();

interface SheetData {
  [key: string]: any[];
}

export class GoogleSheetsService {
  private sheets: any;
  private spreadsheetId?: string;
  private isConfigured: boolean = false;

  constructor() {
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

  private initializeSheets() {
    if (!this.isConfigured) return;

    const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
    const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;

    if (!clientEmail || !privateKey) {
      console.log('⚠️ Missing Google Sheets credentials');
      this.isConfigured = false;
      return;
    }

    try {
    const auth = new JWT({
      email: clientEmail,
      key: privateKey.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.sheets = google.sheets({ version: 'v4', auth });
    } catch (error) {
      console.error('❌ Failed to initialize Google Sheets:', error);
      this.isConfigured = false;
    }
  }

  // Read data from a specific sheet
  async readSheet(sheetName: string): Promise<any[]> {
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

      // Convert to array of objects with headers
      const headers = rows[0];
      const data = rows.slice(1).map((row: any[]) => {
        const obj: any = {};
        headers.forEach((header: string, index: number) => {
          obj[header] = row[index] || '';
        });
        return obj;
      });

      return data;
    } catch (error) {
      console.error(`Error reading sheet ${sheetName}:`, error);
      throw new Error(`Failed to read sheet: ${sheetName}`);
    }
  }

  // Write data to a specific sheet
  async writeSheet(sheetName: string, data: any[]): Promise<void> {
    if (!this.isConfigured || !this.spreadsheetId) {
      console.log('⚠️ Google Sheets not configured, skipping write operation');
      return;
    }

    try {
      if (data.length === 0) return;

      const headers = Object.keys(data[0]);
      const values = [
        headers,
        ...data.map(row => headers.map(header => row[header] || ''))
      ];

      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!A1`,
        valueInputOption: 'RAW',
        resource: { values },
      });
    } catch (error) {
      console.error(`Error writing to sheet ${sheetName}:`, error);
      throw new Error(`Failed to write to sheet: ${sheetName}`);
    }
  }

  // Append data to a specific sheet
  async appendToSheet(sheetName: string, data: any[]): Promise<void> {
    try {
      if (data.length === 0) return;

      const headers = Object.keys(data[0]);
      const values = data.map(row => headers.map(header => row[header] || ''));

      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!A:A`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: { values },
      });
    } catch (error) {
      console.error(`Error appending to sheet ${sheetName}:`, error);
      throw new Error(`Failed to append to sheet: ${sheetName}`);
    }
  }

  // Update specific row in a sheet
  async updateRow(sheetName: string, rowIndex: number, data: any): Promise<void> {
    try {
      const headers = Object.keys(data);
      const values = [headers.map(header => data[header] || '')];

      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!A${rowIndex + 1}`,
        valueInputOption: 'RAW',
        resource: { values },
      });
    } catch (error) {
      console.error(`Error updating row in sheet ${sheetName}:`, error);
      throw new Error(`Failed to update row in sheet: ${sheetName}`);
    }
  }

  // Delete row from a sheet
  async deleteRow(sheetName: string, rowIndex: number): Promise<void> {
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
    } catch (error) {
      console.error(`Error deleting row from sheet ${sheetName}:`, error);
      throw new Error(`Failed to delete row from sheet: ${sheetName}`);
    }
  }

  // Get sheet ID by name
  private async getSheetId(sheetName: string): Promise<number> {
    try {
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
      });

      const sheet = response.data.sheets.find(
        (s: any) => s.properties.title === sheetName
      );

      if (!sheet) {
        throw new Error(`Sheet ${sheetName} not found`);
      }

      return sheet.properties.sheetId;
    } catch (error) {
      console.error(`Error getting sheet ID for ${sheetName}:`, error);
      throw new Error(`Failed to get sheet ID: ${sheetName}`);
    }
  }

  // Initialize database with default structure
  async initializeDatabase(): Promise<void> {
    try {
      const defaultData: SheetData = {
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

      // Initialize each sheet with default data
      for (const [sheetName, data] of Object.entries(defaultData)) {
        await this.writeSheet(sheetName, data);
      }

      console.log('✅ Google Sheets database initialized successfully');
    } catch (error) {
      console.error('❌ Error initializing Google Sheets database:', error);
      throw error;
    }
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    if (!this.isConfigured || !this.spreadsheetId) {
      console.log('⚠️ Google Sheets not configured, health check returning false');
      return false;
    }

    try {
      await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
      });
      return true;
    } catch (error) {
      console.error('❌ Google Sheets health check failed:', error);
      return false;
    }
  }
}

// Export singleton instance
export const googleSheetsService = new GoogleSheetsService(); 