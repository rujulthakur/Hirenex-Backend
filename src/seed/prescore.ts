/**
 * npm run demo:prescore
 * Runs the REAL pipeline once against the configured LLM (needs LLM_PROVIDER + key) and writes
 * src/seed/prescored.json keyed by textHash. Demo mode then falls back to it when the LLM is unavailable.
 * Only validated extract_and_score outputs are written; nothing is invented.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Types } from 'mongoose';
import { closeMongo, connectMongo } from '../config/db';
import { extractAndScoreSchema, type ExtractAndScoreOutput } from '../integrations/llm/schemas';
import { setPrescoredOnly } from '../integrations/llm/prescored';
import { CandidateModel } from '../models/candidate.model';
import { ScoreModel } from '../models/score.model';
import { demoService } from '../services/demo.service';
import { scoringRunService } from '../services/scoringRun.service';
import type { AuditActor } from '../services/audit.service';

const OUT = path.resolve(process.cwd(), 'src/seed/prescored.json');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  await connectMongo();
  setPrescoredOnly(false);
  const actor: AuditActor = { id: new Types.ObjectId().toHexString(), role: 'demo_hr', name: 'Prescore script' };
  const { newJobId } = await demoService.reset(actor);
  const seeded = await demoService.seed(actor, { usePrescored: false });
  process.stdout.write(`Uploaded ${seeded.uploaded} files. Scoring with the real LLM...\n`);
  await scoringRunService.startScoring(newJobId, actor);

  for (;;) {
    await sleep(2000);
    const s = await scoringRunService.getStatus(newJobId);
    process.stdout.write(`  ${s.state} ${s.done}/${s.total}\n`);
    if (s.state === 'done' || s.state === 'failed') break;
  }

  const candidates = await CandidateModel.find({ jobId: new Types.ObjectId(newJobId) }).select({ _id: 1, textHash: 1 }).lean<Array<{ _id: Types.ObjectId; textHash: string }>>();
  const hashById = new Map(candidates.map((c) => [String(c._id), c.textHash]));
  const scores = await ScoreModel.find({ jobId: new Types.ObjectId(newJobId) }).select({ candidateId: 1, rawOutput: 1 }).lean<Array<{ candidateId: Types.ObjectId; rawOutput?: unknown }>>();

  const fixtures: Record<string, ExtractAndScoreOutput> = {};
  let skipped = 0;
  for (const s of scores) {
    const hash = hashById.get(String(s.candidateId));
    const parsed = extractAndScoreSchema.safeParse(s.rawOutput);
    if (hash && parsed.success) fixtures[hash] = parsed.data;
    else skipped += 1;
  }
  await writeFile(OUT, `${JSON.stringify(fixtures, null, 2)}\n`, 'utf8');
  process.stdout.write(`Wrote ${Object.keys(fixtures).length} fixtures to ${OUT} (${skipped} skipped: not scored or invalid).\n`);
  await closeMongo();
}

main().catch(async (e: Error) => {
  process.stderr.write(`prescore failed: ${e.message}\n`);
  await closeMongo().catch(() => undefined);
  process.exit(1);
});
