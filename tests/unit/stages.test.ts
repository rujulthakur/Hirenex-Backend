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
});
