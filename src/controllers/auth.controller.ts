import type { Request, Response } from 'express';
import { env } from '../config/env';
import { userRepository } from '../repositories/user.repository';
import { authService, type RequestContext } from '../services/auth.service';
import { deviceLabelFromUserAgent } from '../services/session.service';
import { tryVerifyAccessToken } from '../services/token.service';
import {
  googleAuthSchema,
  sendOtpSchema,
  verifyOtpSchema,
  type AuthUser,
} from '../types/auth.schema';
import { clearAuthCookies, readAccessCookie, readRefreshCookie, setAuthCookies } from '../utils/authCookies';
import { hashIp } from '../utils/crypto';
import { UnauthenticatedError } from '../utils/errors';
import { typed } from '../middleware/validate';

function contextOf(req: Request): RequestContext {
  return { ipHash: hashIp(req.ip, env.JWT_REFRESH_SECRET) };
}

/** The contract returns the user object (role included) directly under `data`. */
function userPayload(user: AuthUser): AuthUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role, isDemo: user.isDemo };
}

export async function sendOtpController(req: Request, res: Response): Promise<void> {
  const body = typed(sendOtpSchema, req.body);
  await authService.sendOtp(body.email);
  // Identical response for every email: no account enumeration.
  res.status(200).json({ data: { sent: true } });
}

export async function verifyOtpController(req: Request, res: Response): Promise<void> {
  const body = typed(verifyOtpSchema, req.body);
  const { user, session } = await authService.verifyOtp(body.email, body.code, contextOf(req));
  setAuthCookies(res, session);
  res.status(200).json({ data: userPayload(user) });
}

export async function logoutController(req: Request, res: Response): Promise<void> {
  // Logout must work even when the access token has already expired, so identify the actor best-effort.
  const accessToken = readAccessCookie(req);
  const claims = accessToken ? tryVerifyAccessToken(accessToken) : null;
  const actor = claims ? await userRepository.findById(claims.sub) : null;
  await authService.logout(actor, readRefreshCookie(req), contextOf(req));
  clearAuthCookies(res);
  res.status(200).json({ data: { loggedOut: true } });
}

export async function meController(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new UnauthenticatedError();
  res.status(200).json({ data: userPayload(req.user) });
}

export async function demoLoginController(req: Request, res: Response): Promise<void> {
  const { user, session } = await authService.demoLogin(contextOf(req));
  setAuthCookies(res, session);
  res.status(200).json({ data: userPayload(user) });
}

export async function refreshController(req: Request, res: Response): Promise<void> {
  const label = deviceLabelFromUserAgent(req.get('user-agent'));
  const { user, session } = await authService.refresh(readRefreshCookie(req), contextOf(req), label);
  // Rotation: both cookies are replaced on every refresh.
  setAuthCookies(res, session);
  res.status(200).json({ data: userPayload(user) });
}

export async function sessionsController(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new UnauthenticatedError();
  const sessions = await authService.listSessions(req.user.id, readRefreshCookie(req));
  res.status(200).json({ data: sessions });
}

export async function googleLoginController(req: Request, res: Response): Promise<void> {
  const body = typed(googleAuthSchema, req.body);
  const { user, session } = await authService.googleLogin(body.idToken, contextOf(req));
  setAuthCookies(res, session);
  res.status(200).json({ data: userPayload(user) });
}
