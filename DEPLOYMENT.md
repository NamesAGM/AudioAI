# AudioAI Deployment Guide

This guide will walk you through deploying AudioAI on **Vercel (Frontend) + Render (Backend)**.

## Prerequisites

1. **GitHub Repository** - Push your code to GitHub
2. **Vercel Account** - Sign up at [vercel.com](https://vercel.com)
3. **Render Account** - Sign up at [render.com](https://render.com)
4. **Environment Variables** - Have these ready:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_ANON_KEY`)
   - Google Cloud TTS credentials

---

## Step 1: Prepare GitHub Repository

```bash
# Push your code to GitHub if not already done
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/AudioAI.git
git push -u origin main
```

---

## Step 2: Deploy Backend to Render

### Method 1: Using Render Dashboard (Recommended)

1. Go to [render.com/dashboard](https://dashboard.render.com)
2. Click **"New +"** → **"Web Service"**
3. Select **"Deploy an existing GitHub repository"** or connect your GitHub account
4. Select your **AudioAI** repository
5. Configure the service:
   - **Name**: `audioai-backend`
   - **Runtime**: Python
   - **Root Directory**: `backend`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Plan**: Free (or Paid if needed)
6. Add **Environment Variables** in the "Environment" tab:
   - `SUPABASE_URL` = your_supabase_url
   - `SUPABASE_SERVICE_ROLE_KEY` = your_service_role_key
   - `GOOGLE_CLOUD_PROJECT` = your_project_id
   - (Add any other required variables)
7. Click **Create Web Service**

### Method 2: Using render.yaml (Automatic)

The `render.yaml` file in the root directory will automatically configure your deployment:

1. Connect your GitHub repository to Render
2. Render will detect `render.yaml` and auto-configure the deployment
3. Set environment variables in Render dashboard
4. Deploy

### Verify Backend Deployment

```bash
curl https://your-app-name.onrender.com/docs
```

You should see the FastAPI Swagger documentation.

---

## Step 3: Deploy Frontend to Vercel

### Method 1: Using Vercel CLI (Recommended)

1. **Install Vercel CLI**
   ```bash
   npm i -g vercel
   ```

2. **Login to Vercel**
   ```bash
   vercel login
   ```

3. **Deploy from the frontend directory**
   ```bash
   cd frontend
   vercel --prod
   ```

4. **When prompted, configure the build settings:**
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Root Directory: `frontend`

### Method 2: Using Vercel Dashboard

1. Go to [vercel.com/dashboard](https://vercel.com/dashboard)
2. Click **"Add New..."** → **"Project"**
3. Import your GitHub repository
4. Configure settings:
   - **Framework**: Vite
   - **Root Directory**: `frontend`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
5. Add environment variables:
   - `VITE_BACKEND_URL`: Your Railway backend URL (e.g., `https://your-app.railway.app`)
   - Any other frontend environment variables
6. Click **Deploy**

---

## Step 4: Configure Frontend to Use Backend API

Update your frontend environment to use the deployed backend URL.

### Create `.env.local` in frontend directory:
```env
VITE_BACKEND_URL=https://your-railway-backend.railway.app
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_anon_key
```

### Update frontend code to use the environment variable:
In your components, replace hardcoded `localhost:8000` with:
```javascript
const API_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';
```

---

## Step 5: Update CORS in Backend

In `backend/main.py`, update the CORS configuration for production:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://your-vercel-app.vercel.app",  # Your Vercel domain
        "http://localhost:3000",  # Local development
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

---

## Environment Variables Reference

| Variable | Backend | Frontend | Source |
|----------|---------|----------|--------|
| `SUPABASE_URL` | ✅ | ✅ | Supabase Dashboard |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | ❌ | Supabase Settings → API |
| `SUPABASE_ANON_KEY` | ❌ | ✅ | Supabase Settings → API |
| `GOOGLE_CLOUD_PROJECT` | ✅ | ❌ | Google Cloud Console |
| Google TTS Credentials | ✅ | ❌ | Google Cloud Console |
| `VITE_BACKEND_URL` | ❌ | ✅ | Your deployed backend URL |

---

## Testing Your Deployment

### Test Backend
```bash
curl -X GET https://your-backend.railway.app/docs
curl -X POST https://your-backend.railway.app/convert \
  -F "file=@test.pdf"
```

### Test Frontend
Visit: `https://your-app.vercel.app`

---

## Troubleshooting

### Backend Deploy Issues
- Check Railway logs: `railway logs`
- Verify environment variables are set correctly
- Ensure Python version is compatible (3.9+)
- Check `requirements.txt` has all dependencies

### Frontend Deploy Issues
- Verify `VITE_BACKEND_URL` is set correctly
- Check build output: `npm run build`
- Review Vercel deployment logs
- Clear `.vercel` folder and redeploy if needed

### Connection Issues
- Update CORS in backend for frontend domain
- Verify environment variables match
- Check both services are running

---

## Useful Commands

```bash
# Railway
railway login
railway init
railway up
railway logs
railway variables set KEY=value
railway variables get
Links

- **Render Dashboard**: https://dashboard.render.com
- **Vercel Dashboard**: https://vercel.com/dashboard
- **Backend Logs (Render)**: https://dashboard.render.com → select your service → Logs tab
- **Frontend Logs (Vercel)**: https://vercel.com/dashboard → select your project → Deployments tabender Documentation](https://render.com/docs