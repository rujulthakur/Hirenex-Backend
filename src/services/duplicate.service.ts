import { findNearDuplicates } from '../domain/duplicates';
import { addFlag, candidateScoringRepository } from '../repositories/candidateScoring.repository';
import { auditService, type AuditActor } from './audit.service';
import { logger } from '../utils/logger';

/**
 * P2: flags near-duplicate / template-clone resumes after an upload. FLAG ONLY: never rejects, never changes scores.
 * The later upload (higher uploadOrder) gets the badge; the earlier one is treated as the original.
 * Redacted text only, so no identity data is compared. Pairwise cost is O(n^2), fine for the 50-per-request cap.
 */
export async function flagNearDuplicates(jobId: string, actor: AuditActor): Promise<number> {
  try {
    const cands = await candidateScoringRepository.listScorable(jobId);
    const order = new Map(cands.map((c) => [String(c._id), c.uploadOrder]));
    const pairs = findNearDuplicates(cands.map((c) => ({ id: String(c._id), text: c.redactedText })));
    const flagged = new Set<string>();
    for (const p of pairs) {
      const later = (order.get(p.a) ?? 0) >= (order.get(p.b) ?? 0) ? p.a : p.b;
      const earlier = later === p.a ? p.b : p.a;
      if (flagged.has(later)) continue;
      flagged.add(later);
      await addFlag(later, 'near_duplicate');
      await auditService.append({ actor, action: 'candidate.near_duplicate', entityType: 'candidate', entityId: later, jobId, payload: { similarTo: earlier, similarity: p.similarity } });
    }
    return flagged.size;
  } catch (err) {
    logger.warn('near-duplicate scan failed', { message: (err as Error).message });
    return 0;
  }
}
