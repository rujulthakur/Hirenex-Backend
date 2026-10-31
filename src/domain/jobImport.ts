/**
 * PURE. Turns the AI's reading of a job document into values the job record accepts:
 * unique criteria, at least 3, integer weights that add up to exactly 100, de-duplicated skills.
 */
export interface RawCriterion {
  name: string;
  weight: number;
  description: string;
}

export interface NormalizedCriterion {
  id: string;
  name: string;
  weight: number;
  description: string;
}

const FALLBACK_CRITERIA: ReadonlyArray<RawCriterion> = [
  { name: 'Skills match', weight: 40, description: 'Required and preferred skills shown in the resume.' },
  { name: 'Relevant experience', weight: 35, description: 'Work history that matches this role.' },
  { name: 'Project evidence', weight: 25, description: 'Projects or results that prove the skills.' },
];

/** Largest-remainder rounding so the integer weights add up to exactly 100 and none is below 1. */
export function normalizeWeights(weights: ReadonlyArray<number>): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const safe = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 1));
  const total = safe.reduce((a, b) => a + b, 0);
  const exact = safe.map((w) => (w / total) * 100);
  const floors = exact.map((x) => Math.max(1, Math.floor(x)));
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac);
  let k = 0;
  while (left > 0) {
    const slot = order[k % n];
    if (slot) floors[slot.i] = (floors[slot.i] ?? 0) + 1;
    left -= 1;
    k += 1;
  }
  // Rare: the min-1 floor pushed the sum over 100. Take points back from the biggest weights.
  while (left < 0) {
    let big = 0;
    floors.forEach((w, i) => {
      if (w > (floors[big] ?? 0)) big = i;
    });
    if ((floors[big] ?? 0) <= 1) break;
    floors[big] = (floors[big] ?? 0) - 1;
    left += 1;
  }
  return floors;
}

export function normalizeCriteria(raw: ReadonlyArray<RawCriterion>): NormalizedCriterion[] {
  const seen = new Set<string>();
  const picked: RawCriterion[] = [];
  for (const c of raw) {
    const name = c.name.trim().slice(0, 80);
    const key = name.toLowerCase();
    if (name.length === 0 || seen.has(key)) continue;
    seen.add(key);
    picked.push({ name, weight: c.weight, description: c.description.trim().slice(0, 500) });
    if (picked.length === 8) break;
  }
  for (const f of FALLBACK_CRITERIA) {
    if (picked.length >= 3) break;
    if (!seen.has(f.name.toLowerCase())) {
      seen.add(f.name.toLowerCase());
      picked.push({ ...f });
    }
  }
  const weights = normalizeWeights(picked.map((c) => c.weight));
  return picked.map((c, i) => ({ id: `crit_${i + 1}`, name: c.name, weight: weights[i] ?? 1, description: c.description }));
}

export function cleanSkills(list: ReadonlyArray<string>, max: number, exclude: ReadonlySet<string> = new Set()): string[] {
  const out: string[] = [];
  const seen = new Set<string>(exclude);
  for (const s of list) {
    const v = s.trim().replace(/\s+/g, ' ').slice(0, 60);
    const key = v.toLowerCase();
    if (v.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length === max) break;
  }
  return out;
}
