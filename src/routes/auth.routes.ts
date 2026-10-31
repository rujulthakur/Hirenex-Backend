import { Router } from 'express';
import { AUTH_ROUTE_LIMIT, DEMO_LOGIN_LIMIT } from '../config/constants';
import {
  demoLoginController,
  googleLoginController,
  logoutController,
  meController,
  refreshController,
  sendOtpController,
  sessionsController,
  verifyOtpController,
} from '../controllers/auth.controller';
import { authenticate } from '../middleware/authenticate';
import { authorizeGroup } from '../middleware/authorize';
import { requireDemoMode } from '../middleware/demoGate';
import { createRateLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { googleAuthSchema, sendOtpSchema, verifyOtpSchema } from '../types/auth.schema';
import { asyncHandler } from '../utils/asyncHandler';

export const authRouter = Router();

const strictAuthLimiter = createRateLimiter({
  ...AUTH_ROUTE_LIMIT,
  message: 'Too many sign-in attempts from this network. Please wait a few minutes.',
});

// Public entry points (strict per-IP limit on top of the per-email Redis limits).
authRouter.post('/send-otp', strictAuthLimiter, validate({ body: sendOtpSchema }), asyncHandler(sendOtpController));
authRouter.post('/verify-otp', strictAuthLimiter, validate({ body: verifyOtpSchema }), asyncHandler(verifyOtpController));

authRouter.post('/google', strictAuthLimiter, validate({ body: googleAuthSchema }), asyncHandler(googleLoginController));

const demoLimiter = createRateLimiter({ ...DEMO_LOGIN_LIMIT, message: 'Too many demo logins. Please wait a minute.' });

// Demo login: 404 unless DEMO_MODE=true (gate runs BEFORE the limiter so a disabled route reveals nothing).
authRouter.post('/demo-login', requireDemoMode(), demoLimiter, asyncHandler(demoLoginController));

// Refresh with rotation + reuse detection: replaces both cookies on every call.
authRouter.post('/refresh', strictAuthLimiter, asyncHandler(refreshController));

// Session routes.
authRouter.post('/logout', asyncHandler(logoutController));
authRouter.get('/me', authenticate, authorizeGroup('authSession'), asyncHandler(meController));

// Settings: list active sessions (device label, createdAt, lastUsedAt).
authRouter.get('/sessions', authenticate, authorizeGroup('authSession'), asyncHandler(sessionsController));
