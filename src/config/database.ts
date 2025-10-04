import { googleSheetsService } from '../services/googleSheets';

// Initialize database function
export const initializeDatabase = async () => {
  try {
    // Check if Google Sheets environment variables are set
    const hasGoogleSheetsConfig = process.env.GOOGLE_SHEETS_SPREADSHEET_ID && 
                                 process.env.GOOGLE_SHEETS_CLIENT_EMAIL && 
                                 process.env.GOOGLE_SHEETS_PRIVATE_KEY;

    if (!hasGoogleSheetsConfig) {
      console.log('⚠️ Google Sheets environment variables not configured, skipping database initialization');
      console.log('📝 Set GOOGLE_SHEETS_SPREADSHEET_ID, GOOGLE_SHEETS_CLIENT_EMAIL, and GOOGLE_SHEETS_PRIVATE_KEY to enable Google Sheets integration');
      return;
    }

    // Check if Google Sheets is accessible
    const isHealthy = await googleSheetsService.healthCheck();
    
    if (!isHealthy) {
      console.log('⚠️ Google Sheets service is not accessible, but API will continue to run');
      return;
    }

    // Initialize database with default structure
    await googleSheetsService.initializeDatabase();
    
    console.log('✅ Google Sheets database initialized successfully');
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  } catch (error) {
    console.error('❌ Failed to initialize Google Sheets database:', error);
    console.log('⚠️ API will continue to run without Google Sheets integration');
    // Don't throw error to prevent API from failing completely
  }
};

export { googleSheetsService as db }; 