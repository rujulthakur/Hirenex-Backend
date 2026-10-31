/**
 * npm run demo:script   (server must be running with DEMO_MODE=true; set DEMO_BASE_URL to override)
 * Executes the 6-step live demo through the HTTP API and prints PASS/FAIL per check.
 * Exit code 1 if any check fails.
 */
import { generateDemoFiles } from './generateResumes';

const BASE = process.env['DEMO_BASE_URL'] ?? 'http://localhost:4000/api/v1';
const HEADERS = { 'x-requested-by': 'trusthire' } as const;

type Json = Record<string, unknown>;
const cookies = new Map<string, string>();
let failures = 0;

function report(step: string, ok: boolean, detail: string): void {
  if (!ok) failures += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${step}  ${detail}\n`);
}

async function call(method: string, path: string, body?: unknown, form?: FormData): Promise<{ status: number; json: Json }> {
  const headers: Record<string, string> = { ...HEADERS };
  if (cookies.size > 0) headers['cookie'] = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  if (body !== undefined) headers['content-type'] = 'application/json';
  const init: RequestInit = { method, headers };
  if (form) init.body = form;
  else if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, init);
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const idx = pair?.indexOf('=') ?? -1;
    if (pair && idx > 0) cookies.set(pair.slice(0, idx), pair.slice(idx + 1));
  }
  const json = (await res.json().catch(() => ({}))) as Json;
  return { status: res.status, json };
}

const data = (j: Json): Json => (j['data'] ?? {}) as Json;
const list = (j: Json, key: string): Json[] => (((data(j)[key]) ?? []) as Json[]);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(path: string, label: string, maxMs = 180_000): Promise<Json> {
  const start = Date.now();
  for (;;) {
    const { json } = await call('GET', path);
    const state = String(data(json)['state']);
    if (state === 'done' || state === 'failed') return data(json);
    if (Date.now() - start > maxMs) throw new Error(`${label} timed out`);
    await sleep(1500);
  }
}

async function main(): Promise<void> {
  const login = await call('POST', '/auth/demo-login');
  report('0 login', login.status === 200, `demo-login -> ${login.status}`);
  if (login.status !== 200) throw new Error('Cannot continue without login (is DEMO_MODE=true?)');

  const reset = await call('POST', '/demo/reset');
  const jobId = String(data(reset.json)['newJobId']);
  report('0 reset', reset.status === 200 && jobId.length === 24, `new demo job ${jobId}`);

  // ---- Step 1: upload 20+ files, evil resume flagged ----
  const files = await generateDemoFiles();
  const form = new FormData();
  for (const f of files) form.append('files', new Blob([f.buffer]), f.fileName);
  const upload = await call('POST', `/jobs/${jobId}/resumes`, undefined, form);
  const results = (upload.json['data'] ?? []) as Array<{ fileName: string; status: string; flags: string[]; candidateId?: string }>;
  report('1 upload', upload.status === 200 && results.length >= 20, `${results.length} files processed`);
  const evil = results.find((r) => r.fileName.includes('evil'));
  report('1 evil resume flagged', !!evil && evil.flags.includes('hidden_text_found') && evil.flags.includes('injection_phrase_found'), `flags: ${evil?.flags.join(',') ?? 'missing'}`);
  report('1 unreadable scans reported', results.filter((r) => r.status === 'unreadable').length === 2, 'two image-only PDFs');

  const score = await call('POST', `/jobs/${jobId}/score`);
  report('1 scoring started', score.status === 202, `-> ${score.status}`);
  const run = await waitFor(`/jobs/${jobId}/score/status`, 'scoring');
  report('1 stages move Applied -> Scored', run['state'] === 'done', `${String(run['done'])}/${String(run['total'])} scored`);

  // ---- Step 2: evidence drawer, quote verified ----
  const sl = await call('GET', `/jobs/${jobId}/shortlist`);
  const shortlist = list(sl.json, 'shortlist');
  const waitlist = list(sl.json, 'waitlist');
  const top = String(shortlist[0]?.['candidateId'] ?? '');
  const scores = await call('GET', `/candidates/${top}/scores`);
  const per = (data(scores.json)['perCriterion'] ?? []) as Array<{ criterionId: string; verified: boolean; quote: string; score: number }>;
  report('2 evidence receipts verified', per.some((c) => c.verified && c.quote.length > 0), `${per.filter((c) => c.verified).length} verified quotes`);

  // ---- Step 3: override, audit entry ----
  const target = per.find((c) => c.score < 10) ?? per[0];
  const auditBefore = await call('GET', `/jobs/${jobId}/audit?limit=200`);
  const before = ((auditBefore.json['data'] ?? []) as unknown[]).length;
  const ov = await call('PATCH', `/candidates/${top}/scores/${target?.criterionId ?? 'backend'}`, { score: Math.min(10, (target?.score ?? 5) + 1), reason: 'Demo override: reviewed the evidence drawer.' });
  const auditAfter = await call('GET', `/jobs/${jobId}/audit?limit=200`);
  const after = ((auditAfter.json['data'] ?? []) as Array<{ action: string }>);
  report('3 override audited', ov.status === 200 && after.length > before && after.some((a) => a.action === 'score.override'), `audit entries ${before} -> ${after.length}`);

  // ---- Step 4: approve, schedule across 3 interviewers with 0 conflicts ----
  const refreshed = await call('GET', `/jobs/${jobId}/shortlist`);
  const sIds = list(refreshed.json, 'shortlist').map((r) => String(r['candidateId']));
  const wIds = list(refreshed.json, 'waitlist').map((r) => String(r['candidateId']));
  const approve = await call('POST', `/jobs/${jobId}/approve`, { shortlistIds: sIds, waitlistIds: wIds });
  report('4 approve shortlist + waitlist', approve.status === 200, `${sIds.length} shortlisted, ${wIds.length} waitlisted`);
  const sched = await call('POST', `/jobs/${jobId}/schedule`);
  report('4 scheduling started', sched.status === 202, `-> ${sched.status}`);
  await waitFor(`/jobs/${jobId}/schedule/status`, 'scheduling');
  const schedule = await call('GET', `/jobs/${jobId}/schedule`);
  const interviewers = list(schedule.json, 'interviewers') as Array<Json & { slots?: Array<{ status: string }> }>;
  const used = interviewers.filter((i) => (i.slots ?? []).some((s) => s.status === 'booked')).length;
  report('4 three interviewers scheduled', interviewers.length === 3 && used === 3, `${used}/3 interviewers have bookings`);
  report('4 zero conflicts', data(schedule.json)['conflictCount'] === 0, `conflictCount=${String(data(schedule.json)['conflictCount'])}`);

  // ---- Step 5: invites to the Ethereal test inbox ----
  const prev = await call('GET', `/jobs/${jobId}/invites/preview`);
  report('5 invite drafts created', prev.status === 200, `-> ${prev.status}`);
  const send = await call('POST', `/jobs/${jobId}/invites/send`);
  const sendData = data(send.json);
  const invites = (sendData['invites'] ?? []) as Array<{ previewUrl?: string }>;
  report('5 invites sent to test inbox', send.status === 200 && Number(sendData['sent']) > 0 && invites.some((i) => !!i.previewUrl), `sent=${String(sendData['sent'])} failed=${String(sendData['failed'])}`);

  // ---- Step 6: decline from the portal link, repair verified ----
  const qr = await call('GET', '/demo/qr');
  const url = String(data(qr.json)['url'] ?? '');
  const token = url.split('/c/')[1]?.split('?')[0] ?? '';
  report('6 QR link for sandbox invite', qr.status === 200 && token.length > 20 && String(data(qr.json)['qrDataUrl']).startsWith('data:image/png'), url.replace(token, '<token>'));
  const decline = await call('POST', `/portal/${token}/decline`);
  const dd = data(decline.json);
  report('6 decline via portal', decline.status === 200, `status=${String(dd['status'])}`);
  report('6 repair verified (waitlist promoted into the freed slot)', !!dd['promotedCandidateId'] && dd['slotStatusAfter'] === 'booked', `promoted=${String(dd['promotedCandidateId'])} slot=${String(dd['slotStatusAfter'])}`);
  const repairs = await call('GET', `/jobs/${jobId}/repairs`);
  report('6 timeline repair recorded', repairs.status === 200, `-> ${repairs.status}`);

  const verify = await call('GET', '/audit/verify');
  report('7 audit chain verifies', verify.status === 200 && data(verify.json)['valid'] !== false, JSON.stringify(data(verify.json)).slice(0, 120));
}

main()
  .catch((e: Error) => {
    failures += 1;
    process.stdout.write(`FAIL  demo script aborted: ${e.message}\n`);
  })
  .finally(() => {
    process.stdout.write(failures === 0 ? '\nALL STEPS PASSED\n' : `\n${failures} CHECK(S) FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
  });
