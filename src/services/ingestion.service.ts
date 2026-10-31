import pLimit from 'p-limit';
import { Types } from 'mongoose';
import { JobModel } from '../models/job.model';
import { candidateRepository } from '../repositories/candidate.repository';
import { hashText, isUnreadable, normalizeText } from '../domain/text';
import { notificationService } from './notification.service';
import { validateUpload } from './ingestion/validate';
import { extractPdf, type PdfExtraction } from './ingestion/extractPdf';
import { extractDocx, type DocxExtraction } from './ingestion/extractDocx';
import { extractProfile } from './ingestion/profileExtract';
import { getShield, type HiddenFinding } from './ingestion/shieldAdapter';
import { summarizeText, traceService } from './trace.service';
import { auditService, type AuditActor } from './audit.service';
import { flagNearDuplicates } from './duplicate.service';
import { NotFoundError } from '../utils/errors';
import type { CandidateFlag, FileType } from '../types/enums';

/** Bounded concurrency: parsing PDFs is memory-heavy on Render's free tier (512 MB). */
export const INGEST_CONCURRENCY = 4;

export type FileStatus = 'accepted' | 'rejected' | 'duplicate' | 'unreadable';

export interface FileResult {
  fileName: string;
  status: FileStatus;
  candidateId?: string;
  flags: CandidateFlag[];
  reason?: string;
}

export interface IncomingFile {
  originalname: string;
  buffer: Buffer;
}

interface Extracted {
  text: string;
  pdf?: PdfExtraction;
  docx?: DocxExtraction;
}

async function ingestOne(jobId: string, runId: string, file: IncomingFile, uploadedBy: string): Promise<FileResult> {
  const { originalname: fileName, buffer } = file;
  const meta = { jobId };

  const valid = await validateUpload(fileName, buffer);
  if (!valid.ok) return { fileName, status: 'rejected', flags: [], reason: valid.reason };
  const fileType: FileType = valid.fileType;

  let extracted: Extracted;
  try {
    extracted = await traceService.wrap(
      runId,
      'parse_resume',
      async () => (fileType === 'pdf' ? { text: '', pdf: await extractPdf(buffer) } : { text: '', docx: await extractDocx(buffer) }),
      `${fileType} ${buffer.length} bytes`,
      { ...meta, describe: (r) => ({ outputSummary: `${(r as Extracted).pdf?.pageCount ?? 'docx'} parsed` }) },
    );
  } catch {
    return { fileName, status: 'rejected', flags: [], reason: 'File is corrupted and could not be read' };
  }
  const raw = extracted.pdf?.text ?? extracted.docx?.text ?? '';
  const text = normalizeText(raw);
  const textHash = hashText(text);

  if (isUnreadable(text)) {
    const flags: CandidateFlag[] = ['unreadable_scan'];
    const created = await candidateRepository.create({
      jobId, fileName, fileType, textHash, uploadedBy, originalText: text, redactedText: '', flags, hiddenFindings: [],
    });
    if (!created.created) return { fileName, status: 'duplicate', candidateId: created.duplicateOf, flags: [], reason: 'Duplicate of an existing upload' };
    return { fileName, status: 'unreadable', candidateId: created.candidateId, flags, reason: 'No readable text found (image-only scan). OCR is on the roadmap.' };
  }

  const existing = await candidateRepository.findByHash(jobId, textHash, uploadedBy);
  if (existing) return { fileName, status: 'duplicate', candidateId: existing, flags: [], reason: 'Duplicate of an existing upload' };

  const shield = getShield();
  const flags: CandidateFlag[] = [];

  const hidden: HiddenFinding[] = await traceService.wrap(
    runId,
    'scan_hidden_text',
    async () =>
      shield.scanHidden({
        fileType, fileName, text,
        ...(extracted.pdf ? { pdfItems: extracted.pdf.items, pdfMetadata: extracted.pdf.metadata } : {}),
        ...(extracted.docx ? { docxParts: extracted.docx.parts } : {}),
      }),
    summarizeText('text', text),
    { ...meta, describe: (r) => ({ outputSummary: `${(r as HiddenFinding[]).length} hidden findings` }) },
  );
  if (hidden.length > 0) flags.push('hidden_text_found', 'flagged');

  const injection = await traceService.wrap(
    runId,
    'scan_injection',
    async () => shield.scanInjection([text, ...hidden.map((h) => h.text)].join('\n')),
    summarizeText('text', text),
    { ...meta, describe: (r) => ({ outputSummary: `${(r as { count: number }).count} phrases` }) },
  );
  if (injection.count > 0) flags.push('injection_phrase_found');
  if (injection.count > 0 && !flags.includes('flagged')) flags.push('flagged');

  const redacted = await traceService.wrap(
    runId,
    'redact',
    async () => shield.redact(text, fileName),
    summarizeText('text', text),
    { ...meta, describe: (r) => ({ outputSummary: `removed: ${(r as { removedCategories: string[] }).removedCategories.join(',') || 'none'}` }) },
  );

  const created = await candidateRepository.create({
    jobId, fileName, fileType, textHash, uploadedBy, originalText: text, redactedText: redacted.redactedText, flags, hiddenFindings: hidden,
    profile: extractProfile(text, fileName),
  });
  if (!created.created) return { fileName, status: 'duplicate', candidateId: created.duplicateOf, flags: [], reason: 'Duplicate of an existing upload' };
  return { fileName, status: 'accepted', candidateId: created.candidateId, flags };
}

async function ingestBatch(jobId: string, files: IncomingFile[], actor: AuditActor): Promise<FileResult[]> {
  const job = await JobModel.findById(new Types.ObjectId(jobId)).select({ _id: 1 }).lean();
  if (!job) throw new NotFoundError('Job not found');

  const runId = `ingest-${new Types.ObjectId().toHexString()}`;
  const limit = pLimit(INGEST_CONCURRENCY);
  const results = await Promise.all(
    files.map((f) =>
      limit(async (): Promise<FileResult> => {
        try {
          return await ingestOne(jobId, runId, f, actor.id);
        } catch {
          return { fileName: f.originalname, status: 'rejected', flags: [], reason: 'Unexpected error while processing this file' };
        }
      }),
    ),
  );

  const counts = results.reduce<Record<FileStatus, number>>(
    (acc, r) => ({ ...acc, [r.status]: acc[r.status] + 1 }),
    { accepted: 0, rejected: 0, duplicate: 0, unreadable: 0 },
  );
  await auditService.append({
    actor, action: 'resume.upload', entityType: 'job', entityId: jobId, jobId, payload: { files: files.length, ...counts },
  });
  if (counts.accepted > 0) await flagNearDuplicates(jobId, actor);
  if (counts.accepted > 0) {
    const skipped = files.length - counts.accepted;
    await notificationService.notify(actor.id, 'resumes_added', `${counts.accepted} resume${counts.accepted === 1 ? '' : 's'} added`, `${skipped > 0 ? `${skipped} file${skipped === 1 ? ' was' : 's were'} skipped (duplicate, unreadable or wrong type). ` : ''}Candidate details were read from each resume.`, `/app/jobs/${jobId}/candidates`);
  }
  return results;
}

export const ingestionService = { ingestBatch };
