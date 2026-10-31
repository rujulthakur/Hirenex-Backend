import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderResume } from './renderers';
import { buildDemoSpecs, buildUnseenSpecs, type ResumeSpec } from './resumeSpecs';

export interface GeneratedFile {
  spec: ResumeSpec;
  fileName: string;
  buffer: Buffer;
}

export async function generateFiles(specs: ResumeSpec[]): Promise<GeneratedFile[]> {
  const out: GeneratedFile[] = [];
  for (const spec of specs) out.push({ spec, fileName: spec.fileName, buffer: await renderResume(spec) });
  return out;
}

export const generateDemoFiles = (): Promise<GeneratedFile[]> => generateFiles(buildDemoSpecs());
export const generateUnseenFiles = (): Promise<GeneratedFile[]> => generateFiles(buildUnseenSpecs());

/** CLI: npm run seed:files  -> writes src/seed/generated/demo (22 files) and src/seed/generated/unseen (5 files). */
export async function writeToDisk(root: string): Promise<{ demo: number; unseen: number }> {
  const demoDir = path.join(root, 'demo');
  const unseenDir = path.join(root, 'unseen');
  await mkdir(demoDir, { recursive: true });
  await mkdir(unseenDir, { recursive: true });
  const demo = await generateDemoFiles();
  const unseen = await generateUnseenFiles();
  for (const f of demo) await writeFile(path.join(demoDir, f.fileName), f.buffer);
  for (const f of unseen) await writeFile(path.join(unseenDir, f.fileName), f.buffer);
  return { demo: demo.length, unseen: unseen.length };
}

if (require.main === module) {
  const root = path.resolve(process.cwd(), 'src/seed/generated');
  writeToDisk(root)
    .then((n) => process.stdout.write(`Wrote ${n.demo} demo files and ${n.unseen} unseen files to ${root}\n`))
    .catch((e: Error) => {
      process.stderr.write(`${e.message}\n`);
      process.exit(1);
    });
}
