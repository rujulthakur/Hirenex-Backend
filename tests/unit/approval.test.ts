import { describe, expect, it } from 'vitest';
import { APPROVED_JOB_STATUSES, isApproved, validateApproval } from '../../src/domain/approval';
import { requireApproved } from '../../src/services/approval.guard';
import { ApprovalRequiredError } from '../../src/utils/errors';
import { JOB_STATUSES, type CandidateStage } from '../../src/types/enums';

const stages = (entries: Record<string, CandidateStage>): Map<string, CandidateStage> => new Map(Object.entries(entries));
const base = { capacity: 2, waitlistSize: 2 };

describe('validateApproval', () => {
  const stageById = stages({ a: 'scored', b: 'scored', c: 'scored', d: 'scored', e: 'applied', f: 'declined' });
  it('accepts a valid selection', () => {
    expect(validateApproval({ ...base, stageById, shortlistIds: ['a', 'b'], waitlistIds: ['c', 'd'] })).toEqual({ ok: true, errors: [] });
  });
  it.each([
    ['empty shortlist', [], ['c'], /at least one/],
    ['over capacity', ['a', 'b', 'c'], [], /capacity is 2/],
    ['over waitlist size', ['a'], ['b', 'c', 'd'], /limit is 2/],
    ['duplicate in shortlist', ['a', 'a'], [], /duplicate/],
    ['overlap', ['a', 'b'], ['b'], /both lists/],
    ['unknown id (other job)', ['a', 'zzz'], [], /does not belong/],
    ['not yet scored', ['a', 'e'], [], /cannot be selected/],
    ['declined candidate', ['a', 'f'], [], /cannot be selected/],
  ])('rejects: %s', (_n, shortlistIds, waitlistIds, msg) => {
    const res = validateApproval({ ...base, stageById, shortlistIds, waitlistIds });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' | ')).toMatch(msg);
  });
});

describe('approval guard', () => {
  it('only approved, scheduled and invited jobs pass', () => {
    for (const status of JOB_STATUSES) {
      const expected = APPROVED_JOB_STATUSES.includes(status);
      expect(isApproved(status)).toBe(expected);
      if (expected) expect(() => requireApproved({ status })).not.toThrow();
      else expect(() => requireApproved({ status })).toThrow(ApprovalRequiredError);
    }
  });
  it('blocks draft, open and scored with the contract code APPROVAL_REQUIRED', () => {
    for (const status of ['draft', 'open', 'scored'] as const) {
      try {
        requireApproved({ status });
        expect.unreachable('guard should throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ApprovalRequiredError);
        expect((err as ApprovalRequiredError).code).toBe('APPROVAL_REQUIRED');
      }
    }
  });
});
