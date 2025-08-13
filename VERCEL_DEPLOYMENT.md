# Vercel Backend Deployment Guide

## 🚀 **Free Deployment to Vercel**

### **Step 1: Deploy Backend to Vercel**

1. **Go to [Vercel.com](https://vercel.com)**
2. **Import your GitHub repository**
3. **Select the `api` folder** as the root directory
4. **Set the following environment variables:**

```env
NODE_ENV=production
JWT_SECRET=mfc-payment-system-2024-super-secure-jwt-secret-key-production
JWT_EXPIRES_IN=7d
CORS_ORIGIN=https://mfc-payment-system.vercel.app
MAX_FILE_SIZE=10485760
UPLOAD_PATH=/tmp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
LOG_LEVEL=info
```

### **Step 2: Get Your Backend URL**

After deployment, you'll get a URL like:
`https://mfc-payment-api.vercel.app`

### **Step 3: Update Frontend Configuration**

Update the `vercel.json` in the frontend root to point to your backend:

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "rewrites": [
    {
      "source": "/api/(.*)",
      "destination": "https://your-backend-url.vercel.app/api/$1"
    }
  ]
}
```

### **Step 4: Test the Connection**

Test your backend: `https://your-backend-url.vercel.app/api/health`

## **✅ Advantages of Vercel Deployment:**

- **Free hosting** (no monthly subscription)
- **Automatic deployments** from Git
- **Global CDN** for fast performance
- **Serverless functions** (perfect for APIs)
- **Easy environment variable management**
- **Built-in SSL certificates**

## **📝 Notes:**

- Database uses `/tmp` directory for serverless compatibility
- All API routes will be available at `/api/*`
- Environment variables are set in Vercel dashboard
- Automatic deployments on every Git push 