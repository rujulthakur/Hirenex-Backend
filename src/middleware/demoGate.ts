import type { RequestHandler } from 'express';
import { env } from '../config/env';
import { NotFoundError } from '../utils/errors';

/** Routes behind this gate answer 404 unless DEMO_MODE=true, as if they did not exist. */
export function requireDemoMode(isEnabled: () => boolean = () => env.DEMO_MODE): RequestHandler {
  return (_req, _res, next) => (isEnabled() ? next() : next(new NotFoundError()));
}
