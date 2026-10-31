import { describe, expect, it } from 'vitest';
import { findNearDuplicates } from '../../src/domain/duplicates';
import { CANDIDATE_FLAGS } from '../../src/types/enums';

describe('near-duplicate flag', () => {
  it('flag exists in the enum', () => expect(CANDIDATE_FLAGS).toContain('near_duplicate'));
  it('clone pair is found, distinct resume is not', () => {
    const base = 'Built REST APIs with Node and Express. Deployed services on Docker. Wrote unit tests with Vitest. Led a team of four engineers on a payments project.';
    const pairs = findNearDuplicates([
      { id: 'a', text: base },
      { id: 'b', text: base + ' Added logging.' },
      { id: 'c', text: 'Designed mobile interfaces in Figma and ran usability studies with twelve participants across three cities.' },
    ]);
    expect(pairs.map((p) => [p.a, p.b])).toEqual([['a', 'b']]);
  });
});
