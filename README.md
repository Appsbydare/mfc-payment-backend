# MFC Payment System - Backend API

This is the backend API for the Malta Fight Co. Payment Automation System.

## Tech Stack

- **Node.js** with TypeScript
- **Express.js** for the web framework
- **JWT** for authentication
- **Google Sheets API** for data integration
- **PDF generation** with PDFKit
- **Email functionality** with Nodemailer
- **File upload** with Multer
- **Data validation** with Joi and Express Validator

## Getting Started.

### Prerequisites

- Node.js 18+
- npm or yarn
- Google Sheets API credentials (for data integration)

### Installation

```bash
npm install
```

### Environment Setup

Copy the environment template and configure your variables:

```bash
cp env.example .env
```

Required environment variables:

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# JWT Configuration
JWT_SECRET=your-jwt-secret-key
JWT_EXPIRES_IN=24h

# Google Sheets API
GOOGLE_SHEETS_PRIVATE_KEY=your-private-key
GOOGLE_SHEETS_CLIENT_EMAIL=your-client-email
GOOGLE_SHEETS_SPREADSHEET_ID=your-spreadsheet-id

# Email Configuration (optional)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# CORS Configuration
ALLOWED_ORIGINS=http://localhost:5173,https://your-frontend-domain.vercel.app
```

### Development

```bash
npm run dev
```

The API will be available at `http://localhost:3000`

### Building for Production

```bash
npm run build
```

### Running Production Build

```bash
npm start
```

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `GET /api/auth/me` - Get current user

### Data Management
- `POST /api/data/import` - Import data from files
- `GET /api/data/export` - Export data to various formats
- `GET /api/data/sheets` - Fetch data from Google Sheets

### Payments
- `POST /api/payments/calculate` - Calculate payments
- `GET /api/payments/history` - Get payment history
- `POST /api/payments/generate-report` - Generate payment reports

### Reports
- `GET /api/reports/payments` - Get payment reports
- `POST /api/reports/export` - Export reports to PDF/Excel

## Project Structure

```
src/
├── config/         # Configuration files
├── middleware/     # Express middleware
├── routes/         # API route handlers
├── services/       # Business logic services
├── types/          # TypeScript type definitions
└── index.ts        # Application entry point
```

## Deployment

This project is configured for deployment on Vercel. The build process will:

1. Compile TypeScript to JavaScript
2. Output to the `dist` directory
3. Deploy as serverless functions

### Vercel Configuration

The `vercel.json` file configures:
- Build output directory
- Serverless function settings
- Route handling for all API endpoints

## Security Features

- **Helmet.js** for security headers
- **CORS** configuration for cross-origin requests
- **Rate limiting** to prevent abuse
- **Input validation** with Joi and Express Validator
- **JWT authentication** for protected routes
- **Compression** for response optimization

## Google Sheets Integration

The backend integrates with Google Sheets for data management. See `GOOGLE_SHEETS_SETUP.md` for detailed setup instructions.

## Testing

```bash
npm test
```

## Linting and Formatting

```bash
npm run lint
npm run format
``` # Deployment trigger
