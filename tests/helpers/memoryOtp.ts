import type { OtpRecord, OtpStore } from '../../src/integrations/otpStore';
import type { OtpMailer } from '../../src/integrations/mailer/otpMailer';

/** In-memory OtpStore with a manual clock so TTL expiry can be tested without waiting. */
export class MemoryOtpStore implements OtpStore {
  private sends = new Map<string, number>();
  private codes = new Map<string, { hash: string; attempts: number; expiresAt: number }>();
  now = 0;

  async recordSend(emailKey: string): Promise<number> {
    const n = (this.sends.get(emailKey) ?? 0) + 1;
    this.sends.set(emailKey, n);
    return n;
  }
  async saveCode(emailKey: string, codeHash: string, ttlSeconds: number): Promise<void> {
    this.codes.set(emailKey, { hash: codeHash, attempts: 0, expiresAt: this.now + ttlSeconds * 1000 });
  }
  async registerAttempt(emailKey: string): Promise<OtpRecord | null> {
    const rec = this.codes.get(emailKey);
    if (!rec || rec.expiresAt <= this.now) return null;
    rec.attempts += 1;
    return { hash: rec.hash, attempts: rec.attempts };
  }
  async consume(emailKey: string): Promise<boolean> {
    return this.codes.delete(emailKey);
  }
  async discard(emailKey: string): Promise<void> {
    this.codes.delete(emailKey);
  }
  advance(ms: number): void {
    this.now += ms;
  }
}

export class FakeMailer implements OtpMailer {
  sent: Array<{ to: string; code: string }> = [];
  async sendOtp(to: string, code: string): Promise<void> {
    this.sent.push({ to, code });
  }
  last(): string {
    const m = this.sent[this.sent.length - 1];
    if (!m) throw new Error('no mail sent');
    return m.code;
  }
}
