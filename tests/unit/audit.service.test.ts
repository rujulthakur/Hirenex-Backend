import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-ins for the two collections so the real service logic (mutex, counter, chain) is exercised.
const store = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], counter: 0 }));

vi.mock('../../src/models/counter.model', () => ({
  CounterModel: {
    findOneAndUpdate: vi.fn((_q: unknown, u: { $inc: { seq: number } }) => ({
      lean: async () => {
        await new Promise((r) => setTimeout(r, Math.random() * 3));
        store.counter += u.$inc.seq;
        return { seq: store.counter };
      },
    })),
    updateOne: vi.fn(async (_q: unknown, u: { $inc: { seq: number } }) => {
      store.counter += u.$inc.seq;
    }),
  },
}));

vi.mock('../../src/models/auditLog.model', () => ({
  AuditLogModel: {
    findOne: vi.fn(() => ({
      sort: () => ({
        select: () => ({
          lean: async () => {
            await new Promise((r) => setTimeout(r, Math.random() * 3));
            const last = store.rows[store.rows.length - 1];
            return last ? { seq: last['seq'], hash: last['hash'] } : null;
          },
        }),
      }),
    })),
    create: vi.fn(async (row: Record<string, unknown>) => {
      if (store.rows.some((r) => r['seq'] === row['seq'])) throw new Error('E11000 duplicate key');
      store.rows.push(row);
    }),
    find: vi.fn((q: { seq: { $gt: number } }) => ({
      sort: () => ({
        limit: (n: number) => ({
          lean: async () => store.rows.filter((r) => (r['seq'] as number) > q.seq.$gt).slice(0, n),
        }),
      }),
    })),
  },
}));

import { auditService } from '../../src/services/audit.service';
import { csvCell } from '../../src/services/audit.service';
import { verifyChain, type StoredAuditLike } from '../../src/domain/hashchain';

const actor = { id: 'u1', role: 'hr_admin' as const, name: 'HR' };

beforeEach(() => {
  store.rows = [];
  store.counter = 0;
});

describe('auditService.append', () => {
  it('50 parallel appends keep a gap-free, valid chain', async () => {
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        auditService.append({ actor, action: 'job.update', entityType: 'job', entityId: `j${i}`, payload: { i } }),
      ),
    );
    const seqs = store.rows.map((r) => r['seq'] as number);
    expect(seqs).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(verifyChain(store.rows as unknown as StoredAuditLike[])).toEqual({ valid: true });
  });

  it('verify() reports valid, then the exact seq after one stored row is edited', async () => {
    for (let i = 0; i < 12; i++) await auditService.append({ actor, action: 'job.update', entityType: 'job', entityId: 'j', payload: { i } });
    expect(await auditService.verify()).toMatchObject({ valid: true, entries: 12 });
    store.rows[6] = { ...store.rows[6]!, payload: { i: 'tampered' } };
    expect(await auditService.verify()).toMatchObject({ valid: false, brokenAtSeq: 7 });
  });

  it('verifyAndRecord appends an audit.verify entry', async () => {
    await auditService.append({ actor, action: 'job.create', entityType: 'job', entityId: 'j' });
    const v = await auditService.verifyAndRecord(actor);
    expect(v.valid).toBe(true);
    expect(store.rows[store.rows.length - 1]!['action']).toBe('audit.verify');
  });
});

describe('csvCell', () => {
  it('escapes quotes and neutralises formulas', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=SUM(A1)')).toBe('"\'=SUM(A1)"');
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
  });
});
