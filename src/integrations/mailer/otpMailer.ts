import nodemailer, { type Transporter } from 'nodemailer';
import { APP_NAME, OTP_TTL_SECONDS } from '../../config/constants';
import { env } from '../../config/env';
import { renderLayout } from '../../domain/emailLayout';
import { AppError } from '../../utils/errors';

/** Port so tests can inject a fake mailer. Gmail SMTP is used for HR OTP email ONLY (never candidate mail). */
export interface OtpMailer {
  sendOtp(to: string, code: string): Promise<void>;
}

export function buildOtpMessage(code: string): { subject: string; text: string; html: string } {
  const minutes = Math.round(OTP_TTL_SECONDS / 60);
  return {
    subject: `${code} is your ${APP_NAME} sign-in code`,
    text: `Your ${APP_NAME} sign-in code is ${code}. It expires in ${minutes} minutes. If you did not ask for it, ignore this email.`,
    html: renderLayout({
      preheader: `Your sign-in code is ${code}`,
      eyebrow: 'Secure sign-in',
      title: 'Your sign-in code',
      body: `Use this code to sign in to ${APP_NAME}. It expires in ${minutes} minutes.`,
      code,
      note: 'If you did not ask for this code, you can safely ignore this email.',
    }),
  };
}

export class GmailOtpMailer implements OtpMailer {
  private transporter: Transporter | null = null;

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;
    if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) {
      throw new AppError(
        'INTERNAL',
        'Email sign-in is not configured on this server. Use the demo login instead.',
        [],
        503,
      );
    }
    this.transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
    });
    return this.transporter;
  }

  async sendOtp(to: string, code: string): Promise<void> {
    const message = buildOtpMessage(code);
    try {
      await this.getTransporter().sendMail({
        from: `"${APP_NAME}" <${env.GMAIL_USER}>`,
        to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      // Never include the code or the SMTP response in the error.
      throw new AppError('INTERNAL', 'Could not send the sign-in email. Please try again.', [], 502);
    }
  }
}

export const otpMailer: OtpMailer = new GmailOtpMailer();
