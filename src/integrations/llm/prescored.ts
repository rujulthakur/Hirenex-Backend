import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { extractAndScoreSchema, type ExtractAndScoreOutput } from './schemas';
import { logger } from '../../utils/logger';

/**
 * Prescored fixtures: validated extract_and_score outputs keyed by textHash. Demo mode falls back
 * to these when the LLM is unavailable so the live demo never depends on a network call.
 * The file is written by the Prompt 14 script (npm run demo:prescore) from a real pipeline run.
 */
const DEFAULT_PATH = path.resolve(process.cwd(), 'src/seed/prescored.json');

let store: Map<string, ExtractAndScoreOutput> | null = null;

function load(file: string): Map<string, ExtractAndScoreOutput> {
  const map = new Map<string, ExtractAndScoreOutput>();
  if (!existsSync(file)) return map;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    for (const [textHash, value] of Object.entries(raw)) {
      const parsed = extractAndScoreSchema.safeParse(value);
      if (parsed.success) map.set(textHash, parsed.data);
      else logger.warn('prescored fixture ignored (invalid)', { textHash: textHash.slice(0, 12) });
    }
  } catch (err) {
    logger.warn('prescored fixtures could not be read', { error: err instanceof Error ? err.message : 'unknown' });
  }
  return map;
}

export function getPrescored(textHash: string): ExtractAndScoreOutput | null {
  if (store === null) store = load(DEFAULT_PATH);
  return store.get(textHash) ?? null;
}

export function hasPrescored(): boolean {
  if (store === null) store = load(DEFAULT_PATH);
  return store.size > 0;
}

/** Tests and the prescore script replace the in-memory store. Pass null to reload from disk. */
export function setPrescoredForTests(entries: Record<string, ExtractAndScoreOutput> | null): void {
  store = entries === null ? null : new Map(Object.entries(entries));
}

/**
 * Prescored-only mode (POST /demo/seed with usePrescored=true): scoring reads the fixture first and never
 * calls the LLM for candidates that have one. Turned on by the demo seeder, off again when its run finishes.
 */
let prescoredOnly = false;
export function setPrescoredOnly(value: boolean): void {
  prescoredOnly = value;
}
export function isPrescoredOnly(): boolean {
  return prescoredOnly;
}
