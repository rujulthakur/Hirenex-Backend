import type { CandidateStage } from '../types/enums';

/**
 * PURE. The single source of truth for legal candidate stage moves.
 *
 *   applied -> scored -> shortlisted | waitlisted
 *   shortlisted -> invited | waitlisted (demoted when capacity changes)
 *   waitlisted  -> shortlisted (promoted by a repair or override) | invited
 *   invited     -> confirmed | declined | shortlisted (HR reverts after a decline/repair)
 *   declined    -> shortlisted (re-open) ; confirmed -> declined (candidate cancels)
 *   scored      -> applied (rescore resets) ; shortlisted/waitlisted -> scored (re-rank resets)
 *
 * "applied" candidates flagged unreadable never leave "applied" because they are never scored.
 */
export const STAGE_TRANSITIONS: Readonly<Record<CandidateStage, readonly CandidateStage[]>> = {
  applied: ['scored'],
  scored: ['applied', 'shortlisted', 'waitlisted'],
  shortlisted: ['scored', 'waitlisted', 'invited'],
  waitlisted: ['scored', 'shortlisted', 'invited'],
  invited: ['confirmed', 'declined', 'shortlisted'],
  confirmed: ['declined'],
  declined: ['shortlisted'],
};

export function canTransition(from: CandidateStage, to: CandidateStage): boolean {
  return STAGE_TRANSITIONS[from].includes(to);
}

export class IllegalStageTransitionError extends Error {
  constructor(
    public readonly from: CandidateStage,
    public readonly to: CandidateStage,
  ) {
    super(`Illegal stage change: ${from} -> ${to}`);
    this.name = 'IllegalStageTransitionError';
  }
}

/** Returns `to` when the move is legal; throws otherwise. A move to the same stage is a no-op and allowed. */
export function assertTransition(from: CandidateStage, to: CandidateStage): CandidateStage {
  if (from === to) return to;
  if (!canTransition(from, to)) throw new IllegalStageTransitionError(from, to);
  return to;
}

export function legalNextStages(from: CandidateStage): readonly CandidateStage[] {
  return STAGE_TRANSITIONS[from];
}
