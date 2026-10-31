import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCorruptedPdf, makeDocx, makeImageOnlyPdf, makeRenamedExe, makeTextPdf } from '../helpers/fixtures';

const store = new Map<string, string>(); // textHash -> candidateId
let counter = 0;

vi.mock('../../src/models/job.model', () => ({
  JobModel: { findById: () => ({ select: () => ({ lean: async () => ({ _id: 'job' }) }) }) },
}));
vi.mock('../../src/repositories/candidate.repository', () => ({
  candidateRepository: {
    findByHash: async (_job: string, hash: string) => store.get(hash) ?? null,
    create: async (input: { textHash: string }) => {
      const dup = store.get(input.textHash);
      if (dup) return { created: false, duplicateOf: dup };
      counter += 1;
      const id = `c${counter}`;
      store.set(input.textHash, id);
      return { created: true, candidateId: id };
    },
  },
}));
vi.mock('../../src/services/notification.service', () => ({ notificationService: { notify: vi.fn(async () => undefined) } }));
vi.mock('../../src/services/audit.service', () => ({ auditService: { append: vi.fn(async () => undefined) } }));
vi.mock('../../src/services/trace.service', () => ({
  summarizeText: (l: string) => l,
  traceService: { wrap: async (_r: string, _t: string, fn: () => Promise<unknown>) => fn() },
}));

import { ingestionService } from '../../src/services/ingestion.service';

const JOB = '64b7f0f0f0f0f0f0f0f0f0f0';
const actor = { id: 'u1', role: 'hr_admin' as const, name: 'HR' };

describe('ingestion pipeline with generated fixtures', () => {
  beforeEach(() => {
    store.clear();
    counter = 0;
  });

  it('returns the right per-file status for a mixed batch', async () => {
    const pdf = await makeTextPdf('A');
    const docx = await makeDocx('B');
    const results = await ingestionService.ingestBatch(
      JOB,
      [
        { originalname: 'a.pdf', buffer: pdf },
        { originalname: 'b.docx', buffer: docx },
        { originalname: 'evil.pdf', buffer: makeRenamedExe() },
        { originalname: 'broken.pdf', buffer: makeCorruptedPdf() },
        { originalname: 'scan.pdf', buffer: await makeImageOnlyPdf() },
        { originalname: 'notes.txt', buffer: Buffer.from('hello') },
      ],
      actor,
    );
    const by = Object.fromEntries(results.map((r) => [r.fileName, r]));
    expect(by['a.pdf']?.status).toBe('accepted');
    expect(by['b.docx']?.status).toBe('accepted');
    expect(by['evil.pdf']?.status).toBe('rejected');
    expect(by['notes.txt']?.status).toBe('rejected');
    expect(by['broken.pdf']?.status).not.toBe('accepted');
    expect(by['scan.pdf']?.status).toBe('unreadable');
    expect(by['scan.pdf']?.flags).toContain('unreadable_scan');
  });

  it('marks an exact re-upload as duplicate and links the original', async () => {
    const pdf = await makeTextPdf('DUP');
    const first = await ingestionService.ingestBatch(JOB, [{ originalname: 'x.pdf', buffer: pdf }], actor);
    const second = await ingestionService.ingestBatch(JOB, [{ originalname: 'x-copy.pdf', buffer: pdf }], actor);
    expect(first[0]?.status).toBe('accepted');
    expect(second[0]?.status).toBe('duplicate');
    expect(second[0]?.candidateId).toBe(first[0]?.candidateId);
  });

  it('does not stop the batch when one file fails', async () => {
    const results = await ingestionService.ingestBatch(
      JOB,
      [
        { originalname: 'bad.pdf', buffer: makeRenamedExe() },
        { originalname: 'ok.docx', buffer: await makeDocx('OK') },
      ],
      actor,
    );
    expect(results).toHaveLength(2);
    expect(results[1]?.status).toBe('accepted');
  });
});
