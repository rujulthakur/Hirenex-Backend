import type { ErrorRequestHandler, RequestHandler } from 'express';
import { logger } from '../utils/logger';
import { NotFoundError, normalizeError, toEnvelope } from '../utils/errors';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`Route not found: ${req.method} ${req.path}`));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const appError = normalizeError(err);
  if (appError.status >= 500) {
    logger.error('request failed', { requestId: req.id, path: req.path, method: req.method, err });
  } else {
    logger.debug('request rejected', {
      requestId: req.id,
      code: appError.code,
      status: appError.status,
    });
  }
  res.status(appError.status).json(toEnvelope(appError));
};
