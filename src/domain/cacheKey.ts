import { sha256Hex } from '../utils/crypto';

export interface CacheKeyParts {
  redactedText: string;
  criteriaHash: string;
  promptId: string;
  model: string;
}

/**
 * PURE. cacheKey = sha256(redactedText + criteriaHash + promptId + model).
 * A NUL separator between parts stops "ab"+"c" colliding with "a"+"bc".
 * Changing any part (text, criteria or weights, prompt version, model) is a cache miss.
 */
export function computeCacheKey(parts: CacheKeyParts): string {
  return sha256Hex([parts.redactedText, parts.criteriaHash, parts.promptId, parts.model].join('\u0000'));
}

/** PURE. Stable hash of the job criteria (id, name, weight, description), order-independent. */
export function computeCriteriaHash(
  criteria: ReadonlyArray<{ id: string; name: string; weight: number; description: string }>,
): string {
  const canonical = [...criteria]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((c) => `${c.id}|${c.name}|${c.weight}|${c.description}`)
    .join('\n');
  return sha256Hex(canonical);
}
