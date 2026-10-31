import {
  OTP_MAX_ATTEMPTS,
  OTP_SENDS_PER_HOUR,
  OTP_SEND_WINDOW_SECONDS,
  OTP_TTL_SECONDS,
} from '../config/constants';
import { env } from '../config/env';
import { otpMailer, type OtpMailer } from '../integrations/mailer/otpMailer';
import { otpStore, type OtpStore } from '../integrations/otpStore';
import { generateOtpCode, safeEqual, sha256Hex } from '../utils/crypto';
import { RateLimitedError, UnauthenticatedError } from '../utils/errors';

export interface OtpServiceDeps {
  store: OtpStore;
  mailer: OtpMailer;
  /** Server-side secret mixed into the stored hash so a leaked Redis dump cannot be brute-forced offline. */
  pepper: string;
  generateCode?: () => string;
}

const INVALID_CODE_MESSAGE = 'That code is invalid or has expired. Request a new one.';

export interface OtpService {
  /** Same outcome whether or not an account exists: no account enumeration. */
  send(email: string): Promise<void>;
  /** Resolves only for a correct, unexpired, unused code. Throws UNAUTHENTICATED otherwise. */
  verify(email: string, code: string): Promise<void>;
}

export function createOtpService(deps: OtpServiceDeps): OtpService {
  const emailKey = (email: string): string => sha256Hex(email);
  const hashCode = (email: string, code: string): string => sha256Hex(`${deps.pepper}:${email}:${code}`);
  const makeCode = deps.generateCode ?? generateOtpCode;

  return {
    async send(email) {
      const key = emailKey(email);
      const sends = await deps.store.recordSend(key, OTP_SEND_WINDOW_SECONDS);
      if (sends > OTP_SENDS_PER_HOUR) {
        throw new RateLimitedError('Too many sign-in codes requested for this email. Try again in an hour.');
      }
      const code = makeCode();
      // Only the hash is stored (SHA-256), with a 5 minute TTL and an attempts counter starting at 0.
      await deps.store.saveCode(key, hashCode(email, code), OTP_TTL_SECONDS);
      await deps.mailer.sendOtp(email, code);
    },

    async verify(email, code) {
      const key = emailKey(email);
      const record = await deps.store.registerAttempt(key);
      if (!record) throw new UnauthenticatedError(INVALID_CODE_MESSAGE);

      if (record.attempts > OTP_MAX_ATTEMPTS) {
        await deps.store.discard(key);
        throw new UnauthenticatedError(INVALID_CODE_MESSAGE);
      }

      const matches = safeEqual(record.hash, hashCode(email, code));
      if (!matches) {
        // The 5th wrong attempt invalidates the code, so a 6th guess finds nothing.
        if (record.attempts >= OTP_MAX_ATTEMPTS) await deps.store.discard(key);
        throw new UnauthenticatedError(INVALID_CODE_MESSAGE);
      }

      // One-time use: only the caller whose DEL actually removed the key may continue.
      const consumed = await deps.store.consume(key);
      if (!consumed) throw new UnauthenticatedError(INVALID_CODE_MESSAGE);
    },
  };
}

export const otpService: OtpService = createOtpService({
  store: otpStore,
  mailer: otpMailer,
  pepper: env.JWT_REFRESH_SECRET,
});
