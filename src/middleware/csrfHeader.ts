import type { RequestHandler } from 'express';
import { CSRF_HEADER_NAME, CSRF_HEADER_VALUE } from '../config/constants';
import { ForbiddenError } from '../utils/errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie auth.
 * A custom request header cannot be set by a cross-site <form> or <img>; a cross-site fetch/XHR that
 * sets it triggers a CORS preflight, which our origin allow-list rejects. Together with SameSite
 * cookies this is enough for this app. Safe methods never change state, so they are exempt.
 */
export const csrfHeader: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.header(CSRF_HEADER_NAME) !== CSRF_HEADER_VALUE) {
    return next(new ForbiddenError(`Missing ${CSRF_HEADER_NAME} header`));
  }
  return next();
};
