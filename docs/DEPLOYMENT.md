# Deployment guide

## Exact order (so the frontend can flip VITE_USE_MOCKS=false safely)
1. MongoDB Atlas M0  2. Redis (Upstash/Redis Cloud)  3. Gmail app password  4. Deploy backend on Render (first with a placeholder CORS_ORIGINS)
5. Verify `GET /api/v1/health` shows db + redis ok  6. Deploy frontend on Vercel, note its URL
7. Google OAuth client with the Vercel origin  8. Update CORS_ORIGINS, GOOGLE_CLIENT_ID, PORTAL_BASE_URL, APP_BASE_URL on Render, redeploy
9. Run `npm run demo:script` against the Render URL  10. Frontend sets VITE_USE_MOCKS=false and redeploys.

## 1. MongoDB Atlas M0
Create cluster, Database Access user (readWrite on one DB), Network Access: Render free has no static IP, so allow 0.0.0.0/0 for the hackathon only (strong user password; tighten afterwards). Copy the SRV string into MONGODB_URI.

## 2. Redis
Upstash or Redis Cloud free database. Use the `rediss://` URL as REDIS_URL. Redis is used only for OTP, rate limits and email throttle.

## 3. Gmail (HR OTP only)
Enable 2-step verification, create an App Password, set GMAIL_USER and GMAIL_APP_PASSWORD. Candidate mail never uses Gmail (Ethereal only).

## 4. Render web service
New Web Service from the repo, runtime Docker, health check path `/api/v1/health`. Or use render.yaml.

| Variable | Sample | Secret |
|---|---|---|
| NODE_ENV | production | no |
| PORT | 4000 | no |
| MONGODB_URI | mongodb+srv://user:pw@cluster/trusthire | yes |
| REDIS_URL | rediss://default:pw@host:6379 | yes |
| JWT_ACCESS_SECRET / JWT_REFRESH_SECRET | 48+ random chars each | yes |
| COOKIE_SAMESITE | none | no |
| COOKIE_DOMAIN | (leave empty unless sharing a parent domain) | no |
| CORS_ORIGINS | https://your-app.vercel.app | no |
| GOOGLE_CLIENT_ID | xxx.apps.googleusercontent.com | no |
| GMAIL_USER / GMAIL_APP_PASSWORD | you@gmail.com / app password | password yes |
| LLM_PROVIDER | gemini or groq | no |
| GEMINI_API_KEY / GROQ_API_KEY | keys | yes |
| LLM_MODEL | gemini-2.0-flash | no |
| DEMO_MODE | true (demo day), false otherwise | no |
| APP_BASE_URL | https://trusthire-api.onrender.com | no |
| PORTAL_BASE_URL | https://your-app.vercel.app | no |

## Cross-site cookies (Vercel to Render)
Cookies must be `SameSite=None; Secure` (COOKIE_SAMESITE=none, NODE_ENV=production). CORS_ORIGINS must list the exact Vercel origin (no trailing slash); the frontend sends `credentials: 'include'` and header `X-Requested-By: trusthire` on every non-GET request. Safari/Brave may block third-party cookies: a custom domain with API on a subdomain of the same site avoids this.

## Google OAuth
Google Cloud Console, OAuth client (Web), Authorized JavaScript origins = the Vercel origin (and http://localhost:5173 for dev). Put the client ID in GOOGLE_CLIENT_ID (backend) and the frontend env.

## Keep warm and rollback
Free Render sleeps after ~15 min idle: run `npm run demo:warmup` 10 minutes before presenting, or ping `/api/v1/health` every 10 minutes with an uptime monitor. Rollback: Render dashboard, Deploys, pick the previous deploy, Rollback. Data is in Atlas, so a rollback does not touch it. Do not change DB shape in the final hours.

## Custom domain
Render Settings, Custom Domains, add CNAME; keep API and frontend on the same registrable domain if third-party cookies are a problem.
