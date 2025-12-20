# Netlify Deployment Guide

## Setting Up Environment Variables in Netlify

Your Firebase credentials are now stored in environment variables for security. Follow these steps to set them up in Netlify:

### Step 1: Access Netlify Site Settings

1. Go to [Netlify](https://app.netlify.com/)
2. Select your site (or create a new one)
3. Click on **"Site settings"**
4. In the left sidebar, click on **"Environment variables"** (under "Build & deploy")

### Step 2: Add Environment Variables

Click **"Add a variable"** and add each of these:

| Key | Value |
|-----|-------|
| `VITE_FIREBASE_API_KEY` | `AIzaSyCnBuhq5hT62J3_O5kQRsTQucNDyYxMnsM` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `jobs-data-17ee4.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | `jobs-data-17ee4` |
| `VITE_FIREBASE_STORAGE_BUCKET` | `jobs-data-17ee4.firebasestorage.app` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `243005500287` |
| `VITE_FIREBASE_APP_ID` | `1:243005500287:web:439852c7875e42cc14484a` |
| `VITE_FIREBASE_MEASUREMENT_ID` | `G-3JJSP5QEFM` |

**Important Notes:**
- ✅ All variable names MUST start with `VITE_` for Vite to include them in the build
- ✅ These are client-side variables, so they will be visible in your deployed code
- ✅ Firebase API keys are designed to be public - security is handled by Firebase Security Rules

### Step 3: Deploy Settings

If you haven't already, configure your build settings:

**Build command:** `npm run build`
**Publish directory:** `dist`

### Step 4: Redeploy

After adding the environment variables:
1. Go to **"Deploys"** tab
2. Click **"Trigger deploy"** > **"Clear cache and deploy site"**

Your app will rebuild with the environment variables and Firebase will work!

## Alternative: Using Netlify CLI

You can also set environment variables using the Netlify CLI:

```bash
# Install Netlify CLI (if not already installed)
npm install -g netlify-cli

# Login to Netlify
netlify login

# Link your local project to Netlify site
netlify link

# Set environment variables
netlify env:set VITE_FIREBASE_API_KEY "AIzaSyCnBuhq5hT62J3_O5kQRsTQucNDyYxMnsM"
netlify env:set VITE_FIREBASE_AUTH_DOMAIN "jobs-data-17ee4.firebaseapp.com"
netlify env:set VITE_FIREBASE_PROJECT_ID "jobs-data-17ee4"
netlify env:set VITE_FIREBASE_STORAGE_BUCKET "jobs-data-17ee4.firebasestorage.app"
netlify env:set VITE_FIREBASE_MESSAGING_SENDER_ID "243005500287"
netlify env:set VITE_FIREBASE_APP_ID "1:243005500287:web:439852c7875e42cc14484a"
netlify env:set VITE_FIREBASE_MEASUREMENT_ID "G-3JJSP5QEFM"
```

## Testing Locally

Your `.env` file is already set up for local development. The app will automatically use these variables when running `npm run dev`.

## Verifying Environment Variables

After deployment, you can verify environment variables are working:
1. Open your deployed site
2. Open browser DevTools (F12)
3. Check the Console - Firebase should connect without errors
4. Try saving a diagram to Firebase

## Security Note

Firebase API keys are **safe to expose publicly** because:
- ✅ They identify your Firebase project, not authenticate users
- ✅ Security is enforced by Firebase Security Rules in your Firebase Console
- ✅ You can restrict API key usage by domain in Firebase Console

However, you should still:
- Set up proper Firestore Security Rules
- Never commit `.env` file to GitHub (it's in `.gitignore`)
- Use Netlify environment variables for deployment
