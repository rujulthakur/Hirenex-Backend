import { describe, expect, it } from 'vitest';
import { GENESIS_HASH, computeHash, verifyChain, type HashableEntry, type StoredAuditLike } from '../../src/domain/hashchain';

function buildChain(n: number): StoredAuditLike[] {
  const rows: StoredAuditLike[] = [];
  let prev = GENESIS_HASH;
  for (let seq = 1; seq <= n; seq++) {
    const entry: HashableEntry = {
      seq,
      ts: new Date(1_800_000_000_000 + seq * 1000).toISOString(),
      actor: { id: 'u1', role: 'hr_admin', name: 'HR' },
      action: 'job.update',
      entityType: 'job',
      entityId: 'j1',
      payload: { n: seq, b: 2, a: 1 },
      prevHash: prev,
    };
    const hash = computeHash(entry);
    rows.push({ ...entry, hash });
    prev = hash;
  }
  return rows;
}

describe('hash chain', () => {
  it('a clean chain is valid', () => {
    expect(verifyChain(buildChain(10))).toEqual({ valid: true });
  });
  it('is deterministic regardless of key order', () => {
    const a = computeHash({ seq: 1, ts: 't', actor: { id: 'a', role: 'r', name: 'n' }, action: 'x', entityType: 'e', entityId: '1', payload: { a: 1, b: 2 }, prevHash: GENESIS_HASH });
    const b = computeHash({ seq: 1, ts: 't', actor: { name: 'n', role: 'r', id: 'a' }, action: 'x', entityType: 'e', entityId: '1', payload: { b: 2, a: 1 }, prevHash: GENESIS_HASH });
    expect(a).toBe(b);
  });
  it('TAMPER: editing one stored entry is pinpointed at that exact seq', () => {
    const rows = buildChain(10);
    rows[4] = { ...rows[4]!, payload: { n: 999 } };
    expect(verifyChain(rows)).toEqual({ valid: false, brokenAtSeq: 5 });
  });
  it('a deleted entry is detected at the gap', () => {
    const rows = buildChain(10);
    rows.splice(6, 1);
    expect(verifyChain(rows)).toEqual({ valid: false, brokenAtSeq: 8 });
  });
  it('a rewritten hash that fits its own row still breaks the next link', () => {
    const rows = buildChain(5);
    const { hash: _old, ...rest } = rows[1]!;
    const forgedBody = { ...rest, action: 'score.override' };
    const forged = { ...forgedBody, hash: computeHash(forgedBody) };
    rows[1] = forged;
    expect(verifyChain(rows)).toEqual({ valid: false, brokenAtSeq: 3 });
  });
});
