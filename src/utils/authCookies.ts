import type { CookieOptions, Request, Response } from 'express';
import {
  ACCESS_COOKIE,
  ACCESS_TTL_SECONDS,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
  REFRESH_TTL_SECONDS,
} from '../config/constants';
import { env } from '../config/env';

export interface CookieConfig {
  NODE_ENV: string;
  COOKIE_SAMESITE: 'lax' | 'strict' | 'none';
  COOKIE_DOMAIN?: string | undefined;
}

export type CookieKind = 'access' | 'refresh';

/**
 * PURE. httpOnly always; Secure in production and whenever SameSite=None (browsers reject None without Secure).
 * The refresh cookie is scoped to /api/v1/auth so it is not sent with ordinary API calls.
 */
export function buildCookieOptions(kind: CookieKind, cfg: CookieConfig, withMaxAge = true): CookieOptions {
  const options: CookieOptions = {
    httpOnly: true,
    secure: cfg.NODE_ENV === 'production' || cfg.COOKIE_SAMESITE === 'none',
    sameSite: cfg.COOKIE_SAMESITE,
    path: kind === 'refresh' ? REFRESH_COOKIE_PATH : '/',
  };
  if (cfg.COOKIE_DOMAIN) options.domain = cfg.COOKIE_DOMAIN;
  if (withMaxAge) {
    options.maxAge = (kind === 'access' ? ACCESS_TTL_SECONDS : REFRESH_TTL_SECONDS) * 1000;
  }
  return options;
}

export function setAuthCookies(res: Response, tokens: { accessToken: string; refreshToken: string }): void {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, buildCookieOptions('access', env));
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, buildCookieOptions('refresh', env));
}

export function setAccessCookie(res: Response, accessToken: string): void {
  res.cookie(ACCESS_COOKIE, accessToken, buildCookieOptions('access', env));
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, buildCookieOptions('access', env, false));
  res.clearCookie(REFRESH_COOKIE, buildCookieOptions('refresh', env, false));
}

function readCookie(req: Request, name: string): string | undefined {
  const jar = req.cookies as Record<string, unknown> | undefined;
  const value = jar?.[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export const readAccessCookie = (req: Request): string | undefined => readCookie(req, ACCESS_COOKIE);
export const readRefreshCookie = (req: Request): string | undefined => readCookie(req, REFRESH_COOKIE);
