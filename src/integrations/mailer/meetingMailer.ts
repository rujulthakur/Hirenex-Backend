import nodemailer, { type Transporter } from 'nodemailer';
import { APP_NAME } from '../../config/constants';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';

export interface MeetingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Shown as the sender name, e.g. the company. */
  fromName: string;
}

export interface MeetingMailResult {
  ok: boolean;
  /** "live" = delivered through the configured Gmail account. "test" = Ethereal test inbox (nothing reaches the candidate). */
  channel: 'live' | 'test';
  previewUrl?: string;
  error?: string;
}

let gmail: Transporter | null = null;
let ethereal: Transporter | null = null;

function gmailTransport(): Transporter | null {
  if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) return null;
  gmail ??= nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD } });
  return gmail;
}

async function etherealTransport(): Promise<Transporter> {
  if (ethereal) return ethereal;
  const a = await nodemailer.createTestAccount();
  ethereal = nodemailer.createTransport({ host: a.smtp.host, port: a.smtp.port, secure: a.smtp.secure, auth: { user: a.user, pass: a.pass } });
  return ethereal;
}

/** Sends the meeting invite through the HR Gmail account when it is configured, otherwise to a test inbox. */
export async function sendMeetingMail(mail: MeetingMail): Promise<MeetingMailResult> {
  const live = gmailTransport();
  try {
    if (live) {
      await live.sendMail({ from: `"${mail.fromName || APP_NAME}" <${env.GMAIL_USER}>`, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
      return { ok: true, channel: 'live' };
    }
    const t = await etherealTransport();
    const info = await t.sendMail({ from: `"${mail.fromName || APP_NAME}" <no-reply@ethereal.email>`, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
    const preview = nodemailer.getTestMessageUrl(info);
    return { ok: true, channel: 'test', ...(preview ? { previewUrl: preview } : {}) };
  } catch (err) {
    logger.warn('meeting mail failed', { message: (err as Error).message });
    return { ok: false, channel: live ? 'live' : 'test', error: (err as Error).message.slice(0, 200) };
  }
}
