# Backend checklist (tick before the freeze)

## Endpoints (all in docs/CONTRACT_AUDIT.md)
- [ ] Auth: send-otp, verify-otp, google, demo-login, refresh, logout, me
- [ ] Jobs: list/create/get/patch, interviewers get/put
- [ ] Resumes upload; Candidates list/detail/scores/override/patch/delete/swap-test
- [ ] Scoring run + status; Shortlist get/rerank/approve
- [ ] Schedule run/get/shortfall/unavailable/repairs
- [ ] Invites preview/edit/send/list; Portal get/accept/decline/reschedule/status
- [ ] Audit list/verify/export; Trace; Analytics; Notifications; Demo seed/reset/qr; Health

## Collections and indexes
- [ ] users, refreshTokens (TTL), jobs, interviewers, candidates (unique jobId+textHash), candidateTexts, scores
- [ ] slots (unique interviewerId+start), invites (unique tokenHash), auditLogs (unique seq), counters, aiTraces, runs, repairs, notifications, syntheticLabels (audit-only, lint-blocked)

## Pure functions with tests
- [ ] quote, scoring, ranking, stages, slots, assignment, repair, hashchain, redaction, shield (injection/hiddenDocx/hiddenPdf/fence), swap, impactRatio, analytics, portalStatus

## Security
- [ ] Hashed OTP/tokens, cookie flags, CORS allow-list, X-Requested-By rule, rate limits, sanitize, upload magic bytes, log redaction, `npm run audit:deps`, Ethereal host allow-list

## Audit actions
- [ ] Every action in the Prompt 5 list appears at least once in a demo run

## Demo
- [ ] `npm run demo:script` PASS x6; prescored.json generated; Verify chain valid; 0 conflicts

## Deployment
- [ ] Order in docs/DEPLOYMENT.md followed; health shows db+redis; cross-site cookies work from Vercel

## Banned-claims search (must return nothing in UI/copy/templates)
`grep -rniE "legally compliant|unhackable|proven" src docs README.md`  (docs that list the banned words themselves are fine)

## "2 hours left" cut list
Drop first: stability check, reminders, duplicate detector, refresh rotation, Google sign-in.
Never drop: quote verification, shield, approval gate, scheduler + repair, audit chain, portal.

## First thing on your machine
`npm i && npm run build && npm run test:all` (nothing was compiled or run while generating this pack).
