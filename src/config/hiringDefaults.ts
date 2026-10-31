/** Review timeline defaults. Every value can be changed per HR account in Settings. */
export const HIRING_DEFAULTS = { autoRejectEnabled: true, autoRejectDays: 3, holdDays: 7, emailCandidates: true } as const;
/** Stages that count as "no HR decision yet": the auto-reject clock runs here. */
export const PENDING_STAGES = ['applied', 'scored', 'shortlisted', 'waitlisted'] as const;
