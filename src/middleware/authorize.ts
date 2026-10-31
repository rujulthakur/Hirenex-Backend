import type { RequestHandler } from 'express';
import { ROLE_POLICY, type RouteGroup } from '../config/rolePolicy';
import type { Role } from '../types/enums';
import { ForbiddenError, UnauthenticatedError } from '../utils/errors';

/** Allows only the listed roles. Must run after `authenticate`. */
export function authorize(...roles: readonly Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(new UnauthenticatedError());
    if (!roles.includes(req.user.role)) {
      return next(new ForbiddenError('Your role cannot use this part of the app'));
    }
    return next();
  };
}

/** Same check, driven by the rule table in config/rolePolicy.ts so the policy lives in one place. */
export function authorizeGroup(group: RouteGroup): RequestHandler {
  const rule = ROLE_POLICY[group];
  if (rule === 'public' || rule === 'session') {
    return (req, _res, next) => (req.user ? next() : next(new UnauthenticatedError()));
  }
  return authorize(...rule);
}
