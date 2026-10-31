import { beforeEach, describe, expect, it } from 'vitest';
import { createOtpService } from '../../src/services/otp.service';
import { OTP_TTL_SECONDS } from '../../src/config/constants';
import { FakeMailer, MemoryOtpStore } from '../helpers/memoryOtp';

let store: MemoryOtpStore;
let mailer: FakeMailer;
let otp: ReturnType<typeof createOtpService>;

beforeEach(() => {
  store = new MemoryOtpStore();
  mailer = new FakeMailer();
  otp = createOtpService({ store, mailer, pepper: 'pepper' });
});

const EMAIL = 'hr@example.com';

describe('OTP rate limit', () => {
  it('allows 5 sends per hour and rejects the 6th with RATE_LIMITED', async () => {
    for (let i = 0; i < 5; i += 1) await otp.send(EMAIL);
    await expect(otp.send(EMAIL)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(mailer.sent).toHaveLength(5);
  });
  it('counts per email, not globally', async () => {
    for (let i = 0; i < 5; i += 1) await otp.send(EMAIL);
    await expect(otp.send('other@example.com')).resolves.toBeUndefined();
  });
});

describe('OTP verification', () => {
  it('accepts the correct code once', async () => {
    await otp.send(EMAIL);
    await expect(otp.verify(EMAIL, mailer.last())).resolves.toBeUndefined();
  });
  it('is one-time use: the same code fails the second time', async () => {
    await otp.send(EMAIL);
    const code = mailer.last();
    await otp.verify(EMAIL, code);
    await expect(otp.verify(EMAIL, code)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
  it('rejects a wrong code', async () => {
    await otp.send(EMAIL);
    const wrong = mailer.last() === '000000' ? '111111' : '000000';
    await expect(otp.verify(EMAIL, wrong)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
  it('invalidates the code after 5 wrong attempts, even if the 6th guess is correct', async () => {
    await otp.send(EMAIL);
    const good = mailer.last();
    const wrong = good === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i += 1) {
      await expect(otp.verify(EMAIL, wrong)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    }
    await expect(otp.verify(EMAIL, good)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
  it('expires after the TTL', async () => {
    await otp.send(EMAIL);
    const code = mailer.last();
    store.advance((OTP_TTL_SECONDS + 1) * 1000);
    await expect(otp.verify(EMAIL, code)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
  it('a fresh send replaces the older code', async () => {
    await otp.send(EMAIL);
    const first = mailer.last();
    await otp.send(EMAIL);
    const second = mailer.last();
    if (first !== second) {
      await expect(otp.verify(EMAIL, first)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    }
  });
  it('gives the same error for unknown email and wrong code (no enumeration)', async () => {
    const a = await otp.verify('nobody@example.com', '123456').catch((e: Error) => e.message);
    await otp.send(EMAIL);
    const b = await otp.verify(EMAIL, mailer.last() === '123456' ? '654321' : '123456').catch((e: Error) => e.message);
    expect(a).toBe(b);
  });
});
