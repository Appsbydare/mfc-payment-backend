# Google Sheets Database Setup Guide

## Step 1: Get Your Google Sheets Credentials

1. **Download your service account JSON file** from Google Cloud Console
2. **Create a new Google Sheets** named "MFC Payment System Database"
3. **Share the spreadsheet** with your service account email (Editor access)
4. **Copy the Spreadsheet ID** from the URL

## Step 2: Set Up Environment Variables

Create a `.env` file in the `api` directory with the following variables:

```env
# Server Configuration
PORT=5000
NODE_ENV=development

# CORS Configuration
CORS_ORIGIN=http://localhost:5173

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=7d

# Google Sheets API Configuration
# Copy these values from your downloaded service account JSON file
GOOGLE_SHEETS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEETS_CLIENT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
GOOGLE_SHEETS_PROJECT_ID=your-project-id
GOOGLE_SHEETS_SPREADSHEET_ID=your-spreadsheet-id

# Email Configuration (for reports)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# File Upload Configuration
MAX_FILE_SIZE=10485760
UPLOAD_PATH=./uploads
```

## Step 3: Install Dependencies

Run the following command in the `api` directory:

```bash
npm install
```

## Step 4: Create Google Sheets Structure

The system will automatically create the following sheets in your Google Sheets:

- **attendance** - GoTeamUp attendance data
- **payments** - Historical payment data
- **rules** - Payment calculation rules
- **coaches** - Coach information
- **reports** - Generated reports
- **settings** - System configuration

## Step 5: Test the Setup

Run the development server:

```bash
npm run dev
```

Check the console output for:
- ✅ Google Sheets database initialized successfully
- ✅ MFC Payment System API running on port 5000

## Troubleshooting

### Common Issues:

1. **"GOOGLE_SHEETS_SPREADSHEET_ID is required"**
   - Make sure you've set the GOOGLE_SHEETS_SPREADSHEET_ID in your .env file

2. **"Google Sheets service is not accessible"**
   - Check that your service account has Editor access to the spreadsheet
   - Verify your private key is correctly formatted in the .env file

3. **"Sheet not found"**
   - Make sure the spreadsheet has the required sheets (attendance, payments, rules, etc.)
   - The system will create them automatically on first run

### Getting Your Credentials:

1. **Private Key**: Copy the entire private key from your JSON file, including the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` parts
2. **Client Email**: This is the `client_email` field in your JSON file
3. **Project ID**: This is the `project_id` field in your JSON file
4. **Spreadsheet ID**: This is the long string in your Google Sheets URL between `/d/` and `/edit`

Example URL: `https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit`
Spreadsheet ID: `1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms` 