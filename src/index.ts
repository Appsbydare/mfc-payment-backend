import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import 'express-async-errors';

import { errorHandler } from './middleware/errorHandler';
import { notFound } from './middleware/notFound';
import { initializeDatabase } from './config/database';

import authRoutes from './routes/auth';
import dataRoutes from './routes/data';
import reportsRoutes from './routes/reports';
import discountsRoutes from './routes/discounts';
import rulesRoutes from './routes/rules';
import attendanceVerificationRoutes from './routes/attendanceVerification';
import coachesRoutes from './routes/coaches';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'https://mfc-payment-frontend.vercel.app',
  credentials: true
}));

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(compression());

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
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

app.use('/api/auth', authRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/discounts', discountsRoutes);
app.use('/api/rules', rulesRoutes);
app.use('/api/attendance-verification', attendanceVerificationRoutes);
app.use('/api/coaches', coachesRoutes);

app.use(notFound);
app.use(errorHandler);

const startServer = async () => {
  try {
    await initializeDatabase();
    app.listen(PORT, () => {
      console.log(`🚀 MFC Payment System API running on port ${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
      console.log(`🌐 CORS Origin: ${process.env.CORS_ORIGIN || 'https://mfc-payment-frontend.vercel.app'}`);
    });
  } catch (error) {
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

export default app;
