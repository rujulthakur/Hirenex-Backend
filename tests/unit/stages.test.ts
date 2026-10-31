import { describe, expect, it } from 'vitest';
import { assertTransition, canTransition, IllegalStageTransitionError, legalNextStages, STAGE_TRANSITIONS } from '../../src/domain/stages';
import { CANDIDATE_STAGES } from '../../src/types/enums';

describe('stage transitions', () => {
  it('defines moves for every stage', () => {
    for (const s of CANDIDATE_STAGES) expect(STAGE_TRANSITIONS[s]).toBeDefined();
  });
  it('allows the happy path', () => {
    const path = ['applied', 'scored', 'shortlisted', 'invited', 'confirmed'] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
  });
  it('blocks skipping stages', () => {
    expect(canTransition('applied', 'shortlisted')).toBe(false);
    expect(canTransition('applied', 'invited')).toBe(false);
    expect(canTransition('scored', 'confirmed')).toBe(false);
    expect(canTransition('waitlisted', 'confirmed')).toBe(false);
  });
  it('allows waitlist promotion and decline recovery', () => {
    expect(canTransition('waitlisted', 'shortlisted')).toBe(true);
    expect(canTransition('invited', 'declined')).toBe(true);
    expect(canTransition('declined', 'shortlisted')).toBe(true);
  });
  it('assertTransition throws a typed error for illegal moves and allows no-ops', () => {
    expect(() => assertTransition('applied', 'confirmed')).toThrow(IllegalStageTransitionError);
    expect(assertTransition('scored', 'scored')).toBe('scored');
    expect(assertTransition('scored', 'shortlisted')).toBe('shortlisted');
  });
  it('legalNextStages never lists the stage itself', () => {
    for (const s of CANDIDATE_STAGES) expect(legalNextStages(s)).not.toContain(s);
  });

  it('review timeline: HR can hold or reject before inviting, and reopen from hold or rejected', () => {
    expect(canTransition('shortlisted', 'on_hold')).toBe(true);
    expect(canTransition('scored', 'rejected')).toBe(true);
    expect(canTransition('on_hold', 'invited')).toBe(true);
    expect(canTransition('on_hold', 'rejected')).toBe(true);
    expect(canTransition('rejected', 'shortlisted')).toBe(true);
    expect(canTransition('rejected', 'applied')).toBe(true);
    expect(canTransition('on_hold', 'waitlisted')).toBe(true);
    expect(canTransition('confirmed', 'rejected')).toBe(false);
  });
});
