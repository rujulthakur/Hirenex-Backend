import nodemailer, { type Transporter } from 'nodemailer';
import { APP_NAME } from '../../config/constants';
import { getRedis } from '../redis';
import { AppError } from '../../utils/errors';
import { logger } from '../../utils/logger';

/**
 * Candidate email goes through the Ethereal TEST inbox ONLY. A host allow-list throws if anything else is ever
 * configured, so a real candidate address can never receive mail. Gmail SMTP stays in the HR OTP path.
 */
export const ALLOWED_CANDIDATE_MAIL_HOSTS: readonly string[] = ['smtp.ethereal.email'];
export const CANDIDATE_EMAIL_LIMIT_PER_MINUTE = 30;

export interface CandidateMail {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: Array<{ filename: string; content: string; contentType: string }>;
}

export interface CandidateMailResult {
  ok: boolean;
  previewUrl?: string;
  error?: string;
}

/** Port so tests inject a fake. */
export interface CandidateMailer {
  send(mail: CandidateMail): Promise<CandidateMailResult>;
}

export class MailHostNotAllowedError extends Error {
  constructor(host: string) {
    super(`Candidate email may only use the Ethereal test host. Refusing host: ${host}`);
    this.name = 'MailHostNotAllowedError';
  }
}

/** Throws unless the host is on the allow-list. Called before EVERY candidate send. */
export function assertAllowedHost(host: string | undefined): void {
  const h = (host ?? '').trim().toLowerCase();
  if (!ALLOWED_CANDIDATE_MAIL_HOSTS.includes(h)) throw new MailHostNotAllowedError(h || '(none)');
}

interface EtherealAccount {
  user: string;
  pass: string;
  smtp: { host: string; port: number; secure: boolean };
}

let account: EtherealAccount | null = null;
let transporter: Transporter | null = null;

async function getTransporter(forceNew = false): Promise<Transporter> {
  if (transporter && !forceNew) return transporter;
  if (!account || forceNew) account = (await nodemailer.createTestAccount()) as EtherealAccount;
  assertAllowedHost(account.smtp.host);
  transporter = nodemailer.createTransport({ host: account.smtp.host, port: account.smtp.port, secure: account.smtp.secure, auth: { user: account.user, pass: account.pass } });
  return transporter;
}

/** Redis counter: max 30 candidate emails per minute. Fails OPEN if Redis is down (degraded, not broken). */
export async function takeThrottleToken(now: number = Date.now()): Promise<boolean> {
  try {
    const redis = getRedis();
    const key = `throttle:candidate-email:${Math.floor(now / 60_000)}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 90);
    return count <= CANDIDATE_EMAIL_LIMIT_PER_MINUTE;
  } catch (err) {
    logger.warn('email throttle unavailable, allowing send', { message: (err as Error).message });
    return true;
  }
}

async function attempt(mail: CandidateMail, forceNew: boolean): Promise<CandidateMailResult> {
  const t = await getTransporter(forceNew);
  const info = await t.sendMail({
    from: `"${APP_NAME} (test inbox)" <no-reply@ethereal.email>`,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    ...(mail.attachments ? { attachments: mail.attachments } : {}),
  });
  const preview = nodemailer.getTestMessageUrl(info);
  return { ok: true, ...(preview ? { previewUrl: preview } : {}) };
}

export class EtherealCandidateMailer implements CandidateMailer {
  async send(mail: CandidateMail): Promise<CandidateMailResult> {
    if (!(await takeThrottleToken())) throw new AppError('RATE_LIMITED', 'Candidate email limit reached (30 per minute). Try again shortly.');
    try {
      return await attempt(mail, false);
    } catch (err) {
      if (err instanceof MailHostNotAllowedError) throw err;
      try {
        return await attempt(mail, true); // recreate the cached test account once on failure
      } catch (err2) {
        if (err2 instanceof MailHostNotAllowedError) throw err2;
        return { ok: false, error: (err2 as Error).message.slice(0, 200) };
      }
    }
  }
}

let current: CandidateMailer = new EtherealCandidateMailer();
export const getCandidateMailer = (): CandidateMailer => current;
/** Tests inject a fake; pass null to restore Ethereal. */
export function setCandidateMailer(m: CandidateMailer | null): void {
  current = m ?? new EtherealCandidateMailer();
}
