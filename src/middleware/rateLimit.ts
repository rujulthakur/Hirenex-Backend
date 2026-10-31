import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { RateLimitedError } from '../utils/errors';

export interface LimiterOptions {
  windowMs: number;
  max: number;
  message?: string;
}

/** IP-based limiter that reports through the contract envelope (RATE_LIMITED, 429). */
export function createRateLimiter(options: LimiterOptions): RequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new RateLimitedError(options.message)),
  });
}
