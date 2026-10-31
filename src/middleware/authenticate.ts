import type { RequestHandler } from 'express';
import { userRepository } from '../repositories/user.repository';
import { verifyAccessToken } from '../services/token.service';
import { asyncHandler } from '../utils/asyncHandler';
import { readAccessCookie } from '../utils/authCookies';
import { UnauthenticatedError } from '../utils/errors';

/**
 * Reads the httpOnly access cookie, verifies the JWT and attaches the CURRENT user row to req.user.
 * The database lookup means a deleted user, or a role change, takes effect immediately.
 */
export const authenticate: RequestHandler = asyncHandler(async (req, _res, next) => {
  const token = readAccessCookie(req);
  if (!token) throw new UnauthenticatedError();
  const claims = verifyAccessToken(token);
  const user = await userRepository.findById(claims.sub);
  if (!user) throw new UnauthenticatedError('Your account no longer exists. Please sign in again.');
  req.user = user;
  next();
});
