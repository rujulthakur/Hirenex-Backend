/**
 * PURE. P2 near-duplicate and template-clone detector. Word shingles (default 3 words) -> Jaccard similarity.
 * FLAG ONLY: it never removes, merges or scores anything; HR decides.
 */
export const SHINGLE_SIZE = 3;
export const DUPLICATE_THRESHOLD = 0.8;

export function shingles(text: string, size = SHINGLE_SIZE): Set<string> {
  const words = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 0);
  const out = new Set<string>();
  if (words.length < size) {
    if (words.length > 0) out.add(words.join(' '));
    return out;
  }
  for (let i = 0; i <= words.length - size; i++) out.add(words.slice(i, i + size).join(' '));
  return out;
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const s of a) if (b.has(s)) inter += 1;
  return inter / (a.size + b.size - inter);
}

export interface DuplicatePair {
  a: string;
  b: string;
  similarity: number;
}

export function findNearDuplicates(items: ReadonlyArray<{ id: string; text: string }>, threshold = DUPLICATE_THRESHOLD): DuplicatePair[] {
  const sets = items.map((i) => ({ id: i.id, set: shingles(i.text) }));
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const s = jaccard((sets[i] as { set: Set<string> }).set, (sets[j] as { set: Set<string> }).set);
      if (s >= threshold) pairs.push({ a: (sets[i] as { id: string }).id, b: (sets[j] as { id: string }).id, similarity: Math.round(s * 1000) / 1000 });
    }
  }
  return pairs.sort((x, y) => y.similarity - x.similarity);
}
