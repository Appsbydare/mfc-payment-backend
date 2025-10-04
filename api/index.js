const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'https://mfc-payment-frontend.vercel.app',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'), // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression middleware
app.use(compression());

// Logging middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Health check endpoint (both /api/health and /health for compatibility)
app.get(['/api/health', '/health'], (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'MFC Payment System API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0'
  });
});

// Import and use routes
const authRoutes = require('./auth');
const dataRoutes = require('./data');
const paymentsRoutes = require('./payments');
const discountsRoutes = require('./discounts');
const rulesRoutes = require('./rules');
const reportsRoutes = require('./reports');
const attendanceVerificationRoutes = require('./attendanceVerification');
const coachesRoutes = require('./coaches');

// API routes (mounted under /api/*)
app.use('/api/auth', authRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/rules', rulesRoutes);
app.use('/api/discounts', discountsRoutes);
app.use('/api/attendance-verification', attendanceVerificationRoutes);
app.use('/api/coaches', coachesRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.path
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Internal server error'
  });
});

// Export for Vercel
module.exports = app; 