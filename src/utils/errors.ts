import { ZodError } from 'zod';

export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'APPROVAL_REQUIRED',
  'RATE_LIMITED',
  'UPLOAD_REJECTED',
  'AI_UNAVAILABLE',
  'SLOT_TAKEN',
  'TOKEN_EXPIRED',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Contract error code -> HTTP status. */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  APPROVAL_REQUIRED: 409,
  RATE_LIMITED: 429,
  UPLOAD_REJECTED: 400,
  AI_UNAVAILABLE: 503,
  SLOT_TAKEN: 409,
  TOKEN_EXPIRED: 410,
  INTERNAL: 500,
};

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly details: unknown[];

  constructor(code: ErrorCode, message: string, details: unknown[] = [], status?: number) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status ?? ERROR_STATUS[code];
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Request validation failed', details: unknown[] = []) {
    super('VALIDATION_FAILED', message, details);
  }
}
export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication required') {
    super('UNAUTHENTICATED', message);
  }
}
export class ForbiddenError extends AppError {
  constructor(message = 'You do not have access to this resource') {
    super('FORBIDDEN', message);
  }
}
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super('NOT_FOUND', message);
  }
}
export class ConflictError extends AppError {
  constructor(message = 'The request conflicts with the current state', details: unknown[] = []) {
    super('CONFLICT', message, details);
  }
}
export class ApprovalRequiredError extends AppError {
  constructor(message = 'HR approval of the shortlist is required first') {
    super('APPROVAL_REQUIRED', message);
  }
}
export class RateLimitedError extends AppError {
  constructor(message = 'Too many requests. Please try again later') {
    super('RATE_LIMITED', message);
  }
}
export class UploadRejectedError extends AppError {
  constructor(message = 'Upload rejected', details: unknown[] = []) {
    super('UPLOAD_REJECTED', message, details);
  }
}
export class AiUnavailableError extends AppError {
  constructor(message = 'The AI service is unavailable right now') {
    super('AI_UNAVAILABLE', message);
  }
}
export class SlotTakenError extends AppError {
  constructor(message = 'That slot has just been taken') {
    super('SLOT_TAKEN', message);
  }
}
export class TokenExpiredError extends AppError {
  constructor(message = 'This link has expired') {
    super('TOKEN_EXPIRED', message);
  }
}
export class InternalError extends AppError {
  constructor(message = 'Something went wrong on our side') {
    super('INTERNAL', message);
  }
}

export interface ErrorEnvelope {
  error: { code: ErrorCode; message: string; details: unknown[] };
}

interface HttpLikeError {
  type?: string;
  status?: number;
  statusCode?: number;
  name?: string;
  code?: string;
  message?: string;
}

/** Turns anything thrown into a typed AppError. Unknown errors never leak their message. */
export function normalizeError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    return new ValidationError('Request validation failed', details);
  }

  if (typeof err === 'object' && err !== null) {
    const e = err as HttpLikeError;
    if (e.type === 'entity.parse.failed') {
      return new ValidationError('Request body is not valid JSON');
    }
    if (e.type === 'entity.too.large') {
      return new AppError('VALIDATION_FAILED', 'Request body is too large', [], 413);
    }
    if (e.name === 'MulterError') {
      const reason =
        e.code === 'LIMIT_FILE_SIZE'
          ? 'File is larger than the 5 MB limit'
          : e.code === 'LIMIT_FILE_COUNT' || e.code === 'LIMIT_UNEXPECTED_FILE'
            ? 'Too many files, or the upload field is not named "files"'
            : 'Upload could not be processed';
      return new UploadRejectedError(reason, [{ code: e.code }]);
    }
    if (e.message === 'CORS_ORIGIN_NOT_ALLOWED') {
      return new ForbiddenError('Origin is not allowed');
    }
  }

  return new InternalError();
}

export function toEnvelope(err: AppError): ErrorEnvelope {
  return { error: { code: err.code, message: err.message, details: err.details } };
}
