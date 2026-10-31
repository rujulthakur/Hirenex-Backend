import { describe, expect, it } from 'vitest';
import { assertAllowedHost, MailHostNotAllowedError } from '../../src/integrations/mailer/candidateMailer';
import { renderEmail, escapeHtml, type TemplateFacts } from '../../src/domain/emailTemplates';
import { computeExpiry, hashToken, isExpired, mintToken, portalLink, TOKEN_MAX_AGE_MS } from '../../src/domain/portalToken';
import { buildPortalStatus } from '../../src/domain/portalStatus';
import { buildIcs } from '../../src/domain/ics';
import { ApprovalRequiredError } from '../../src/utils/errors';
import { requireApproved } from '../../src/services/approval.guard';

const facts: TemplateFacts = { firstName: 'Asha', jobTitle: 'Backend Engineer', companyLabel: 'TrustHire', whenText: 'Tue 4 Nov 2026, 10:30 AM IST', durationMinutes: 45, format: 'virtual', whereText: 'https://meet.example/x' };
const links = { accept: 'https://p/c/T?action=accept', decline: 'https://p/c/T?action=decline', reschedule: 'https://p/c/T?action=reschedule' };

describe('approval guard blocks preview/send', () => {
  it('throws APPROVAL_REQUIRED for every unapproved status', () => {
    for (const status of ['draft', 'open', 'scored'] as const) expect(() => requireApproved({ status })).toThrow(ApprovalRequiredError);
  });
  it('passes once approved', () => {
    expect(() => requireApproved({ status: 'approved' })).not.toThrow();
  });
});

describe('mail host allow-list', () => {
  it('accepts only the Ethereal host', () => {
    expect(() => assertAllowedHost('smtp.ethereal.email')).not.toThrow();
    expect(() => assertAllowedHost(' SMTP.ETHEREAL.EMAIL ')).not.toThrow();
  });
  it('rejects Gmail, real hosts, lookalikes and empty values', () => {
    for (const h of ['smtp.gmail.com', 'smtp.ethereal.email.evil.com', 'mail.example.com', '', undefined]) {
      expect(() => assertAllowedHost(h)).toThrow(MailHostNotAllowedError);
    }
  });
});

describe('portal tokens', () => {
  it('is 32 random bytes base64url and stores only the SHA-256 hash', () => {
    const t = mintToken(0, 10 * TOKEN_MAX_AGE_MS);
    expect(Buffer.from(t.raw, 'base64url')).toHaveLength(32);
    expect(t.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(t.hash).toBe(hashToken(t.raw));
    expect(t.hash).not.toContain(t.raw);
    expect(mintToken(0, 1e12).raw).not.toBe(t.raw);
  });
  it('expires at the EARLIER of 7 days or interview start', () => {
    expect(computeExpiry(0, 10 * TOKEN_MAX_AGE_MS).getTime()).toBe(TOKEN_MAX_AGE_MS);
    expect(computeExpiry(0, 1000).getTime()).toBe(1000);
  });
  it('isExpired is true at and after expiry', () => {
    const d = new Date(1000);
    expect(isExpired(d, 999)).toBe(false);
    expect(isExpired(d, 1000)).toBe(true);
  });
  it('builds PORTAL_BASE_URL/c/:token links without double slashes', () => {
    expect(portalLink('https://x.test/', 'abc')).toBe('https://x.test/c/abc');
    expect(portalLink('https://x.test', 'abc', 'accept')).toBe('https://x.test/c/abc?action=accept');
  });
});

describe('email templates', () => {
  it('invitation has details, three buttons and the test-inbox footer in html and text', () => {
    const e = renderEmail('invitation', facts, links);
    for (const part of ['Asha', 'Tue 4 Nov 2026, 10:30 AM IST', '45 minutes', 'Virtual', 'https://meet.example/x']) expect(e.text).toContain(part);
    expect(e.html).toContain('Accept');
    expect(e.html).toContain('Decline');
    expect(e.html).toContain('Ask for another time');
    expect(e.text).toContain('Test inbox, synthetic data');
    expect(e.html).toContain('Test inbox, synthetic data');
  });
  it('decision emails have no buttons and no slot details', () => {
    const e = renderEmail('decision_not_selected', facts, links);
    expect(e.html).not.toContain('Accept');
    expect(e.text).not.toContain('When:');
  });
  it('uses the LLM body when given and escapes html in it', () => {
    const e = renderEmail('invitation', facts, links, 'Hi <script>x</script>');
    expect(e.html).not.toContain('<script>');
    expect(escapeHtml('<&>')).toBe('&lt;&amp;&gt;');
  });
});

describe('ics', () => {
  it('produces a UTC event with organizer, url and meeting link', () => {
    const ics = buildIcs({ uid: 'u1@t', title: 'Interview', startMs: Date.UTC(2026, 10, 4, 5, 0), endMs: Date.UTC(2026, 10, 4, 5, 45), format: 'virtual', whereText: 'https://meet.example/x', url: 'https://p/c/T' });
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('20261104T050000Z');
    expect(ics).toContain('ORGANIZER');
    expect(ics).toContain('URL:https://p/c/T');
    expect(ics).toContain('https://meet.example/x');
  });
});

describe('portal status', () => {
  const criteria = [{ id: 'a', name: 'Node.js' }, { id: 'b', name: 'MongoDB' }, { id: 'c', name: 'Testing' }];
  it('lists matched and missing from VERIFIED scores only, with no numbers', () => {
    const s = buildPortalStatus(criteria, [
      { criterionId: 'a', score: 9, verified: true, missing: false },
      { criterionId: 'b', score: 9, verified: false, missing: false }, // unverified claim does not count
    ], false);
    expect(s.matched).toEqual(['Node.js']);
    expect(s.missing).toEqual(['MongoDB', 'Testing']);
    expect(JSON.stringify(s)).not.toMatch(/\d{2,}|score|rank/i);
    expect(s.humanReviewed).toBe(false);
  });
  it('passes the human-reviewed flag through', () => {
    expect(buildPortalStatus(criteria, [], true).humanReviewed).toBe(true);
  });
});
