import { describe, expect, it } from 'vitest';
import { sanitizeValue } from '../../src/middleware/sanitize';
import { toDetail } from '../../src/services/candidate.service';
import { Types } from 'mongoose';

describe('NoSQL sanitizer', () => {
  it('drops $operators and dotted keys at any depth', () => {
    const out = sanitizeValue({ email: { $ne: null }, ok: 1, nested: { 'a.b': 1, $where: 'x', keep: [{ $gt: 1, v: 2 }] } });
    expect(out).toEqual({ email: {}, ok: 1, nested: { keep: [{ v: 2 }] } });
  });
  it('leaves scalars and arrays of scalars alone', () => {
    expect(sanitizeValue({ a: 'x', b: [1, 2], c: true })).toEqual({ a: 'x', b: [1, 2], c: true });
  });
  it('stops at excessive depth instead of recursing forever', () => {
    let deep: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < 40; i += 1) deep = { n: deep };
    expect(() => sanitizeValue(deep)).not.toThrow();
  });
});

describe('candidate detail DTO', () => {
  it('never exposes the original text reference and returns redacted text only', () => {
    const dto = toDetail({
      _id: new Types.ObjectId(), jobId: new Types.ObjectId(), fileName: 'a.pdf', fileType: 'pdf', textHash: 'h'.repeat(64),
      originalTextRef: new Types.ObjectId(), redactedText: 'redacted', parsedSkills: [], projects: [], flags: [], hiddenFindings: [],
      stage: 'applied', uploadOrder: 1, notes: '',
    } as never);
    expect(JSON.stringify(dto)).not.toContain('originalTextRef');
    expect(dto.redactedText).toBe('redacted');
  });
});
