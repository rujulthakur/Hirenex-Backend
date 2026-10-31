import { describe, expect, it } from 'vitest';
import { cleanSkills, normalizeCriteria, normalizeWeights } from '../../src/domain/jobImport';

const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0);

describe('normalizeWeights', () => {
  it('always adds up to exactly 100 with integers of at least 1', () => {
    for (const w of [[1, 1, 1], [50, 30, 20], [3, 3, 3, 3, 3, 3], [0, 0, 0], [97, 1, 1, 1], [0.2, 0.3, 0.5]]) {
      const out = normalizeWeights(w);
      expect(sum(out)).toBe(100);
      expect(out.every((n) => Number.isInteger(n) && n >= 1)).toBe(true);
    }
  });
});

describe('normalizeCriteria', () => {
  it('pads to at least 3, removes duplicates and gives unique ids', () => {
    const out = normalizeCriteria([
      { name: 'Backend', weight: 5, description: '' },
      { name: 'backend', weight: 5, description: '' },
    ]);
    expect(out.length).toBeGreaterThanOrEqual(3);
    expect(new Set(out.map((c) => c.id)).size).toBe(out.length);
    expect(sum(out.map((c) => c.weight))).toBe(100);
  });
  it('keeps at most 8', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `C${i}`, weight: 1, description: '' }));
    expect(normalizeCriteria(many)).toHaveLength(8);
  });
});

describe('cleanSkills', () => {
  it('trims, de-duplicates ignoring case, and skips excluded', () => {
    expect(cleanSkills([' Node.js ', 'node.js', 'React', ''], 10, new Set(['react']))).toEqual(['Node.js']);
  });
});
