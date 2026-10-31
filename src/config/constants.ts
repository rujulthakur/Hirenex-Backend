/** Single place for the product name: renaming TrustHire is a one-line change. */
export const APP_NAME = 'TrustHire';
export const APP_SLUG = 'trusthire';

export const API_PREFIX = '/api/v1';

/** CSRF defence for cookie auth: every non-safe request must carry this header. */
export const CSRF_HEADER_NAME = 'x-requested-by';
export const CSRF_HEADER_VALUE = APP_SLUG;

export const REQUEST_ID_HEADER = 'x-request-id';

export const JSON_BODY_LIMIT = '1mb';

export const GLOBAL_RATE_LIMIT = { windowMs: 60_000, max: 300 } as const;

export const HEALTH_PROBE_TIMEOUT_MS = 1500;

/** Keys whose values are never written to logs. Matched case-insensitively as substrings. */
export const LOG_REDACT_KEYS = [
  'password',
  'token',
  'otp',
  'authorization',
  'cookie',
  'secret',
] as const;

/* ---------------- Auth (Prompt 3) ---------------- */
export const JWT_ISSUER = APP_SLUG;
export const ACCESS_TTL_SECONDS = 15 * 60;
/** Sliding 30-day session: every refresh issues a new token, so an HR user who opens the app at least monthly stays signed in. */
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

export const ACCESS_COOKIE = 'th_access';
export const REFRESH_COOKIE = 'th_refresh';
/** The refresh cookie is only sent to auth routes, so it never travels with ordinary API calls. */
export const REFRESH_COOKIE_PATH = `${API_PREFIX}/auth`;

export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 5 * 60;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_SENDS_PER_HOUR = 5;
export const OTP_SEND_WINDOW_SECONDS = 60 * 60;

export const DEMO_USER_EMAIL = `demo.judge@${APP_SLUG}.test`;
export const DEMO_USER_NAME = 'Judge (demo)';

export const AUTH_ROUTE_LIMIT = { windowMs: 15 * 60_000, max: 30 } as const;
export const DEMO_LOGIN_LIMIT = { windowMs: 60_000, max: 10 } as const;

/* ---------------- Hardening (Prompt 15) ---------------- */
export const REQUEST_TIMEOUT_MS = 30_000;
export const UPLOAD_TIMEOUT_MS = 120_000;
