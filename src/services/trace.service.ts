import { Types } from 'mongoose';
import { AiTraceModel, type AiTraceDoc, type TRACE_STATUSES } from '../models/aiTrace.model';
import { sha256Hex } from '../utils/crypto';
import { logger } from '../utils/logger';

export type TraceStatus = (typeof TRACE_STATUSES)[number];

export const TRACE_LIST_LIMIT = 100;
const SUMMARY_MAX = 300;

/** What a traced call may report about itself (all optional). Never put raw resume text in here. */
export interface TraceReport {
  outputSummary?: string;
  model?: string;
  promptId?: string;
  tokensIn?: number;
  tokensOut?: number;
  /** 'fallback' = the deterministic fallback produced the answer instead of the LLM. */
  status?: Extract<TraceStatus, 'ok' | 'fallback'>;
}

export interface TraceMeta {
  jobId: string;
  /** Called with the result to extract model, tokens and an output summary. */
  describe?: (result: unknown) => TraceReport;
  /** Known up front (e.g. the configured model), recorded even when the call throws. */
  model?: string;
  promptId?: string;
}

/**
 * Privacy-safe summary of text: length plus a short hash, never the text itself.
 * Use this to build `inputSummary` for anything derived from a resume.
 */
export function summarizeText(label: string, text: string): string {
  return `${label}: ${text.length} chars, sha256:${sha256Hex(text).slice(0, 12)}`;
}

function clip(text: string): string {
  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX - 1)}…` : text;
}

function errorText(err: unknown): string {
  // Only the message, clipped: error objects from providers can echo prompts.
  return clip(err instanceof Error ? err.message : 'Unknown error');
}

async function record(row: Omit<AiTraceDoc, '_id'>): Promise<void> {
  try {
    await AiTraceModel.create(row);
  } catch (err) {
    // Tracing must never break the pipeline it observes.
    logger.warn('trace write failed', { err: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Runs `fn`, records start time, duration, status, model, promptId, token usage and error.
 * Failures are recorded and then re-thrown unchanged, so callers keep their own error handling.
 */
async function wrap<T>(runId: string, tool: string, fn: () => Promise<T>, inputSummary: string, meta: TraceMeta): Promise<T> {
  const started = Date.now();
  const ts = new Date(started);
  const base = {
    jobId: new Types.ObjectId(meta.jobId),
    runId,
    tool,
    inputSummary: clip(inputSummary),
    ts,
  };
  try {
    const result = await fn();
    const report = meta.describe?.(result) ?? {};
    await record({
      ...base,
      outputSummary: clip(report.outputSummary ?? ''),
      durationMs: Date.now() - started,
      status: report.status ?? 'ok',
      ...(report.model ?? meta.model ? { model: (report.model ?? meta.model) as string } : {}),
      ...(report.promptId ?? meta.promptId ? { promptId: (report.promptId ?? meta.promptId) as string } : {}),
      ...(report.tokensIn !== undefined ? { tokensIn: report.tokensIn } : {}),
      ...(report.tokensOut !== undefined ? { tokensOut: report.tokensOut } : {}),
    } as Omit<AiTraceDoc, '_id'>);
    return result;
  } catch (err) {
    await record({
      ...base,
      outputSummary: '',
      durationMs: Date.now() - started,
      status: 'error',
      error: errorText(err),
      ...(meta.model ? { model: meta.model } : {}),
      ...(meta.promptId ? { promptId: meta.promptId } : {}),
    } as Omit<AiTraceDoc, '_id'>);
    throw err;
  }
}

/** Latest entries for a job, newest first, capped at 100. */
async function listForJob(jobId: string, limit: number = TRACE_LIST_LIMIT): Promise<AiTraceDoc[]> {
  return AiTraceModel.find({ jobId: new Types.ObjectId(jobId) })
    .sort({ ts: -1 })
    .limit(Math.min(limit, TRACE_LIST_LIMIT))
    .lean<AiTraceDoc[]>();
}

export const traceService = { wrap, listForJob };
export type TraceService = typeof traceService;
