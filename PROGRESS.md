# Progress

- Prompt 1: done (scaffold, config, errors, health, Docker).
- Prompt 2: DONE (written, not compiled)
  - src/types: enums, common, user, job, candidate, schedule, invite, audit, ops schemas (zod)
  - src/models: users, refreshTokens, jobs, interviewers, candidates, candidateTexts, scores, slots, invites,
    auditLogs (append-only hooks), counters, aiTraces, runs, repairs, notifications,
    auditOnly/syntheticLabels
  - .eslintrc.cjs: no-restricted-imports blocks syntheticLabels outside biasPanel service + seed
  - docs/DATA_MODEL.md: diagram, index table, TTL policy
- Prompt 3 HALF 1: DONE (written, not compiled, not tested)
  - env: INTERVIEWER_EMAILS (role allow-list); constants: auth/OTP/cookie constants
  - utils: crypto (sha256, safeEqual, otp code, hashIp), mutex, authCookies (pure buildCookieOptions)
  - integrations: otpStore (Redis: send counter, code hash, Lua attempt counter, one-time DEL), mailer/otpMailer (Gmail, port)
  - services: otp (send/verify, rate limit 5/h, 5 attempts, 5 min TTL, one-time), token (access + refresh JWT),
    session, auth (sendOtp, verifyOtp, logout), audit (append only; hash chain core, Prompt 5 adds list/verify/export)
  - domain/hashchain.ts (pure: canonicalJson, computeHash, verifyChain)
  - repositories: user, refreshToken
  - middleware: authenticate, authorize, authorizeGroup; config/rolePolicy.ts (rule table)
  - routes live: POST /auth/send-otp, /auth/verify-otp, /auth/logout, GET /auth/me
  - audit action 'auth.logout' added to AUDIT_ACTIONS
- Prompt 3 HALF 2: DONE (written, not compiled, not tested)
  - POST /auth/demo-login: middleware/demoGate.ts (404 unless DEMO_MODE=true) -> DEMO_LOGIN_LIMIT -> authService.demoLogin
    (upserts demo_hr user, audits 'demo.login' with ip hash on EVERY use, issues cookies)
  - POST /auth/refresh (simple): verifies refresh JWT, checks stored hash not revoked/expired, sets NEW ACCESS cookie only
  - utils/authCookies: setAccessCookie added
  - tests: helpers/memoryOtp (in-memory store + fake mailer), unit: otp.service (rate limit, attempts, expiry, one-time,
    replace, enumeration), authCookies (flags), authorize (+rule table, demo gate), auth.service (demo gating/audit,
    role allow-list, refresh); integration: auth.routes (cookie flags, CSRF, validation, generic send-otp), auth.demo-off (404)
- Prompt 4 HALF 1 (Google sign-in): DONE (written, not compiled, not tested)
  - integrations/google/googleVerifier.ts (port + google-auth-library impl; pure validateGoogleClaims: aud, iss, exp, email_verified)
  - POST /auth/google {idToken}: strict limiter -> authService.googleLogin -> userRepository.upsertFromGoogle
    (link by email, create if new, refuse if email already linked to a different googleSub) -> same cookies, audit auth.login method=google
  - tests: unit/google.test.ts (claims + service, wrong audience rejected), integration/auth.google.test.ts
- Prompt 4 HALF 2 (refresh rotation): DONE (written, not compiled, not tested)
  - refreshTokens: + deviceLabel, lastUsedAt; repo: markReplaced (atomic conditional update), listActiveForUser
  - POST /auth/refresh now rotates (new refresh token, same family, old marked replacedBy, both cookies reset)
  - reuse (replaced/revoked token or lost race) -> revoke family + all user sessions, audit auth.refresh_reuse_detected, UNAUTHENTICATED
  - GET /auth/sessions (authSession group): [{id, deviceLabel, createdAt, lastUsedAt, current}] (extra to the contract; tell frontend)
  - session.service: deviceLabelFromUserAgent; createSession(user, family?, deviceLabel?)
  - tests: unit/auth.service (rotation chain, reuse revokes family, race, revoked/expired, listSessions); integration refresh sets both cookies
  => Prompt 4 complete.
- Prompt 5 HALF 2 / FILE SET A (audit): DONE (written, not compiled, not tested)
  - services/audit.service: + list (filters actor/action/date, newest first, paged), verify (batched ascending scan), verifyAndRecord
    (appends audit.verify), iterateAll, CSV helpers (formula-injection safe)
  - controllers/audit.controller, routes/audit.routes: GET /jobs/:id/audit, GET /audit/verify, GET /audit/export (CSV stream), HR roles only
  - tests: unit/hashchain (tamper pinpoint, gap, forged hash), unit/audit.service (50 parallel appends gap-free, verify tamper, csv)
- Prompt 5 FILE SET B (trace): DONE (written, not compiled, not tested)
  - services/trace.service: wrap(runId, tool, fn, inputSummary, {jobId, describe?, model?, promptId?}) records duration/status/model/promptId/
    tokens/error (errors re-thrown), summaries clipped to 300 chars, summarizeText() = length + hash only, trace write failures never break callers;
    listForJob (limit 100, newest first)
  - controller + routes/trace.routes: GET /jobs/:id/trace (HR roles)
  - tests: unit/trace.service (ok, fallback status, failure recorded + rethrown, no raw text, write failure swallowed, limit cap)
  => Prompt 5 complete. NEXT: Prompt 6 (ingestion).
- Prompt 6 (ingestion) in progress:
  - [x] domain/stages.ts (+ tests/unit/stages.test.ts)
  - [x] domain/text.ts (normalize NFKC, sha256 textHash, unreadable < 200 chars)
  - [x] services/ingestion/validate.ts (extension + magic bytes, DOCX zip-bomb caps)
  - [x] services/ingestion/extractPdf.ts (pdfjs items + pdf-parse fallback), extractDocx.ts (mammoth + XML parts)
  - [x] services/ingestion/shieldAdapter.ts (port + baseline; Prompt 7 calls setShield() with the full detectors)
  - [x] repositories/candidate.repository.ts (redacted text on candidate, original in candidateTexts, dup guard)
  - [x] services/ingestion.service.ts (p-limit 4; traced parse_resume, scan_hidden_text, scan_injection, redact; audit resume.upload)
  - [x] controller + routes/resume.routes.ts mounted: POST /jobs/:id/resumes -> data: [{fileName, status, candidateId?, flags[], reason?}]
  - [x] tests/unit/ingestion.test.ts (text + validation)
  - [x] tests/helpers/fixtures.ts (pdfkit text PDF, image-only PDF, docx lib DOCX, renamed exe, corrupted PDF)
  - [x] tests/integration/ingestion.pipeline.test.ts (mixed batch, duplicate, partial failure; repo/audit/trace mocked, no DB)
  => Prompt 6 complete. NEXT: Prompt 7 (shield: injection, hidden text, redaction, fence).

Contract assumption to confirm with frontend: /auth/verify-otp and /auth/me return the user object flat under
`data` ({id, email, name, role, isDemo}); send-otp returns {data:{sent:true}}; logout {data:{loggedOut:true}}.

Note: no tsc / build / test run was performed on this snapshot (by request).
  - Prompt 7 [x] domain/shield/injection.ts (scanInjection, neutralizeControlChars)
  - Prompt 7 [x] domain/shield/hiddenDocx.ts (detectHiddenDocx, isNearWhite)
  - Prompt 7 [x] domain/shield/hiddenPdf.ts (detectHiddenPdf; white-fill limit documented)
  - Prompt 7 [x] domain/redaction.ts (redact, detectNameTokens; schools -> [INSTITUTION], grad years/affiliations removed)
  - Prompt 7 [x] domain/shield/fence.ts (fenceResume, buildFenceSystemRules, makeNonce; random-nonce delimiters + exact system rules)
  - Prompt 7 [x] domain/shield/index.ts (fullShield + installShield(), called at boot in server.ts)
  - Prompt 7 [x] docs/SHIELD.md (6 defence layers + honest limits)
  - Prompt 7 tests [x] tests/unit/shield/injection.test.ts (16 detect + 7 clean + 2 behaviour)
  - Prompt 7 tests [x] tests/unit/shield/hiddenDocx.test.ts (7 isNearWhite + 12), hiddenPdf.test.ts (7)
  - Prompt 7 fix: redaction PHONE now needs 10+ digits so job date ranges ("2021 - 2024") are kept
  - Prompt 7 tests [x] tests/unit/shield/redaction.test.ts (14), fence.test.ts (6)
  => Prompt 7 complete (shield + 80+ test cases, written NOT run). NEXT: Prompt 8 (LLM gateway). Note: fence.ts is the helper extract_and_score_v1 must use.
- Prompt 8 (LLM gateway) in progress:
  - [x] integrations/llm/types.ts (LlmClient, LlmTransport, LlmHttpError, LlmSchemaError)
  - [x] integrations/llm/jsonExtract.ts (extractJson: fences, prose, balanced-brace scan)
  - [x] integrations/llm/retry.ts (withRetry, backoffDelay, isRetryableError: 429/5xx/network, max 3)
  - [x] integrations/llm/gatewayClient.ts (createLlmClient: p-limit 3, timeout, retry, zod, 1 corrective retry -> LlmSchemaError, exhausted -> AI_UNAVAILABLE)
  - [x] integrations/llm/postJson.ts (fetch + timeout, errors -> LlmHttpError, no keys/bodies in messages)
  - [x] integrations/llm/gemini.adapter.ts (createGeminiTransport, key in header, temp 0, JSON mime type)
  - [x] integrations/llm/groq.adapter.ts (createGroqTransport, json_object mode, temp 0)
  - [x] integrations/llm/index.ts (getLlmClient, setLlmClient, getModelName)
  - [x] integrations/llm/schemas.ts (extractAndScoreSchema, draftEmailSchema, probeQuestionsSchema, candidateSummarySchema; all .strict(), missing=>score 0)
  - [x] integrations/llm/prompts.ts (PROMPT_IDS; buildExtractAndScorePrompt uses fenceResume; draft invitation/promotion, probe questions, summary: full text)
  - [x] domain/cacheKey.ts (computeCacheKey, computeCriteriaHash)
  - [x] repositories/score.repository.ts (findCacheHit) + models/score.model.ts gets rawOutput (Mixed, internal only)
  - [x] integrations/llm/prescored.ts (getPrescored(textHash), hasPrescored, setPrescoredForTests; reads src/seed/prescored.json, validates with schema)
  - [x] services/llmScoring.service.ts (proposeScores: cache -> LLM -> needs_review | prescored fallback in DEMO_MODE; bypassCache for swap test; traced with token usage). Prompt 9 persists cacheKey/rawOutput/cachedFrom on the score doc.
  - [x] integrations/llm/mock.ts (createMockLlmClient normal|adversarial, createScriptedTransport, httpError). setLlmClient(mock) in tests; getModelName() returns 'mock-model' for provider 'mock'.
  - tests [x] tests/unit/llm/gateway.test.ts (success, schema failure retry/needs_review, retry/backoff, concurrency<=3, extractJson)
  - tests [x] tests/unit/llm/cache.test.ts (cache key parts, hit/miss/corrupt/bypass, needs_review, demo prescored fallback, token usage to trace)
  - tests [x] tests/unit/llm/adversarial.test.ts (adversarial/normal mock, prompt registry + fencing, strict schemas)
  => Prompt 8 complete (written NOT compiled/run). NEXT: Prompt 9 (orchestrator, quote verification, scoring, ranking, shortlist, overrides, approval gate).
  Prompt 9 must: persist cacheKey + rawOutput + cachedFrom on the score doc from proposeScores(); on status 'needs_review' add flag needs_review and skip scoring; use bypassCache for swap test (Prompt 13).
- Prompt 9 (scoring + approval) in progress:
  - [x] domain/quote.ts (verifyQuote, normalizeQuote, MIN_QUOTE_CHARS=12; reasons too_short|placeholder_only|repeats_criterion|repeats_job_text|not_found; location mapped to stored redacted text)
  - [x] domain/scoring.ts (computeTotal, applyVerification, computeCoverage, summarizeCandidate, deriveFlags, applyOverride; verified skill = mentioned in a VERIFIED quote)
  - [x] domain/ranking.ts (rankCandidates stable + tieBreakTrace, compareCandidates, cutShortlist, TIE_RULE_TEXT)
  - [x] domain/approval.ts (validateApproval, isApproved, APPROVED_JOB_STATUSES)
  - [x] services/approval.guard.ts (requireApproved(job) -> APPROVAL_REQUIRED; MUST be called by schedule, invites preview/send, portal-email paths)
  - [x] repositories/job.repository.ts (findById, setStatus, markApproved atomic)
  - Prompt 9 [x] repositories/run.repository.ts (create, latestForJob, hasActive, markRunning, incrementDone, addFailure, finish)
  - Prompt 9 [x] repositories/score.repository.ts (upsert, findByCandidate, findByJob, saveCriteria + findCacheHit)
  - Prompt 9 [x] repositories/candidateScoring.repository.ts (listScorable, listRankable, stageMap, applyScore, applySummary, setFlags, saveRanking, setStages, getOriginalText)
  - Prompt 9 [x] services/ranking.service.ts (rankJob, getShortlist, rerank = in-memory, no LLM, not saved)
  - Prompt 9 [x] services/scoringRun.service.ts (startScoring -> 202 runId, p-limit 3, traced scan_hidden_text/score/verify_quotes/rank, one failure never stops the run, getStatus)
  - Prompt 9 [x] services/override.service.ts (getScores, overrideScore: reason>=10, originalScore, recompute total+rank, audit score.override, returns auditSeq)
  - Prompt 9 [x] services/approval.service.ts (approve: validateApproval, atomic markApproved, stages, audit shortlist.approve)
  - Prompt 9 [x] controllers/scoring.controller.ts + routes/scoring.routes.ts mounted: POST /jobs/:id/score, GET /jobs/:id/score/status, GET /jobs/:id/shortlist, POST /jobs/:id/rerank, POST /jobs/:id/approve, GET /candidates/:id/scores, PATCH /candidates/:id/scores/:criterionId
  - Prompt 9 tests [x] unit/quote (28-row table), unit/scoring, unit/ranking (200-case determinism property), unit/approval (+guard)
  => Prompt 9 complete (written NOT compiled/run). NEXT: Prompt 10 (scheduler). Prompts 10-12 MUST call requireApproved(job) on schedule, invites preview/send and portal email paths.
  Notes: GET /candidates and GET /candidates/:id, jobs CRUD, PATCH/DELETE candidate are NOT built yet (not in prompts 1-9 scope as written) - add before the demo. Contract assumption: override returns {candidateId, criterionId, oldScore, newScore, total, rank, auditSeq}; shortlist returns {shortlist[], waitlist[], tieRule, approved, capacity, waitlistSize}.
- Prompt 10 (scheduler) complete (written NOT compiled/run):
  - [x] domain/slots.ts (generateSlots Luxon: job-tz grid, breaks, per-interviewer-zone availability, DST-safe, UTC + local display; slotsPerDay)
  - [x] domain/assignment.ts (assignCandidates earliest slot + least-loaded tie rule, countConflicts), domain/booking.ts (bookWithRetry), domain/shortfall.ts (computeShortfall)
  - [x] repositories/slot.repository.ts (insertMissing idempotent, atomic book via findOneAndUpdate status:'open', free), repositories/interviewer.repository.ts
  - [x] services/schedule.service.ts (startSchedule requires requireApproved, getSchedule w/ interviewer filter + conflictCount, getShortfall, getRunStatus; audit schedule.run + slot.booked; job -> scheduled)
  - [x] controllers/schedule.controller.ts + routes/schedule.routes.ts mounted: POST /jobs/:id/schedule (202), GET /jobs/:id/schedule, GET /jobs/:id/shortfall
  - [x] tests: unit/slots (3 zones incl Asia/Kolkata + DST both ways), unit/scheduler (assignment, 300-case no-double-booking property, 20-parallel booking, shortfall maths)
  Contract change requests: (1) EXTRA endpoint GET /jobs/:id/schedule/status for polling the scheduling run (contract only lists the 202). (2) GET /jobs/:id/schedule returns {jobTimeZone, breaks[], interviewers[{interviewerId,name,timeZone,slots[]}], unscheduled[], conflictCount}. (3) /shortfall returns {needed, available, deficit, fixes[{kind,amount,unit,description}]}.
  Assumptions: interviewer availability windows are in the interviewer's own zone; empty availability = free for all job hours; interviewer role is matched to an Interviewer by case-insensitive name (no userId on interviewers yet).
  Not done: unavailable/repairs endpoints (Prompt 11). Real-DB 20-parallel booking test is simulated with a check-and-set fake; add a mongodb-memory-server variant if time allows.
  => NEXT: Prompt 11 (repair engine).
- Prompt 11 part 2 (service wrappers) in progress:
  - [x] repositories/invite.repository.ts (findByRawToken, findLiveForCandidate, respondIfPending = idempotency guard, createDraft, supersedeOthers, repointSlot)
  - [x] repositories/repair.repository.ts (save, latestForJob, slotsForJob, blockSlot, handOver atomic, notifyHr)
  - [x] domain/repairDrafts.ts (pure: firstNameFromText, promotionTemplate, rescheduleTemplate fallbacks, no links)
  - [x] services/repair.service.ts (decline w/ double idempotency guard + atomic handOver + promotion draft invite; markUnavailable: book-new-then-block-old, reschedule drafts, old tokens expired; requestReschedule; latest)
  Note for Prompt 12: repair drafts store a placeholder tokenHash; the SEND step must mint the real token and overwrite tokenHash. Drafts have no links (template adds buttons).
  - [x] controllers/repair.controller.ts (unavailable, repairs, portalDecline, portalReschedule)
  - [x] routes/repair.routes.ts mounted: POST /jobs/:id/interviewers/:iid/unavailable, GET /jobs/:id/repairs, POST /portal/:token/decline, POST /portal/:token/reschedule (Prompt 12 adds GET /portal/:token and accept to the same /portal mount)
  - [x] tests/unit/repair.test.ts (decline with/without waitlist, double-decline idempotency, partial placement, minimal movement, 300-case no-double-booking property, draft templates)
  => Prompt 11 complete (written NOT compiled/run). NEXT: Prompt 12 (email + portal tokens + invites + .ics). Prompt 12 SEND must mint the real token for repair drafts (placeholder tokenHash) and the portal GET /:token must be added to the existing /portal mount.
- Prompt 12 (email/portal) in progress:
  - [x] domain/portalToken.ts (mintToken, hashToken, computeExpiry earlier-of-7d-or-start, portalLink PORTAL_BASE_URL/c/:token) + inviteRepository.setTokenWhileDraft
  - [x] integrations/mailer/candidateMailer.ts (Ethereal cached account recreated on failure, assertAllowedHost throws for non-Ethereal, Redis throttle 30/min fails open, getCandidateMailer/setCandidateMailer for tests; result carries previewUrl)
  - [x] domain/emailTemplates.ts (renderEmail for invitation|promotion|reschedule|decline_ack|decision_waitlist|decision_not_selected|reminder; HTML+text, buttons -> links, footer "Test inbox, synthetic data", fallbackBody, escapeHtml)
  - [x] domain/ics.ts (buildIcs via ics package: UTC, ORGANIZER, URL, location or meeting link)
  - [x] services/invite.service.ts (preview creates drafts [requireApproved], edit locked after send, send [requireApproved, atomic claim, mints real token, ICS, Ethereal, stage invited, audit], list) + invite/slot repo helpers (claimForSend, markDelivery, markViewed, patchWhileDraft, listByJob, findByIds, listBooked)
  Note: candidates have no email/zone fields: mail goes to candidate-<id>@candidates.test via Ethereal; times use the job time zone.
  - [x] domain/portalStatus.ts (buildPortalStatus: matched/missing names from VERIFIED scores only, no numbers, humanReviewed flag passed in)
  - [x] services/portal.service.ts (view marks viewed, accept->confirmed idempotent, decline->repair engine, reschedule, status plain-language) + score.evidenceOpenedAt set in override.service.getScores
  - [x] controllers/invite.controller.ts + routes/invite.routes.ts mounted: GET /jobs/:id/invites/preview, POST /jobs/:id/invites/send, GET /jobs/:id/invites, PATCH /invites/:id, GET /portal/:token, GET /portal/:token/status, POST /portal/:token/accept (decline + reschedule in repair.routes on same /portal mount). Rate limits per IP (token is in the URL so per-token is covered by the same window).
  Not done: reminders (P2) + DEMO_MODE fast-forward endpoint; decision emails sending (templates exist).
  - [x] tests/unit/email.test.ts (approval guard, host allow-list, token hash/expiry/links, templates, ics, portal status)
  => Prompt 12 complete except P2 reminders (written NOT compiled/run). NEXT: Prompt 13 (swap test, bias panel, probes, analytics, notifications).
- Prompt 13 (fairness/analytics) in progress:
  - [x] domain/swap.ts (swapIdentity fixed neutral mapping, compareRedactions hash equality, scoreDelta honest, SWAP_LIMIT_NOTE exact sentence)
  - [x] services/swap.service.ts (hash equality + fresh uncached rescore via proposeScores bypassCache, verified by same pure quote check; rescoredDelta null if AI unavailable; audit swap.test). Controller/route next.
  - [x] controllers/fairness.controller.ts + routes/fairness.routes.ts mounted: POST /candidates/:id/swap-test (extend these files for analytics/notifications)
  - [x] domain/impactRatio.ts (computeImpact: selection rate, ratio to highest, flag <0.8, smallSample <5, caveat text)
  - [x] services/biasPanel.service.ts (AUDIT-ONLY, the one allowed importer of syntheticLabels; $lookup aggregation -> computeImpact)
  - [x] domain/analytics.ts (normalizeFunnel, normalizeTimeInStage [approx: createdAt->updatedAt per current stage], computeUtilization, computeTrustMeter)
  - [x] services/analytics.service.ts (forJob: 6 aggregation pipelines in parallel -> funnel, timeInStageHours, interviewerUtilization, trustMeter, biasPanel). Route/controller next.
  - [x] services/notification.service.ts (notify, notifyHr never throw; list w/ pagination + unread; markRead own only). repair.repository.notifyHr kept as is (can be swapped to this helper).
  - [x] GET /jobs/:id/analytics, GET /notifications, POST /notifications/read added to fairness controller/routes and mounted
  - [x] services/probe.service.ts (probe_questions_v1 from claimed vs VERIFIED evidence, redacted text only, stored on score.probeQuestions) + POST /candidates/:id/probes (CONTRACT CHANGE REQUEST: extra endpoint)
  - [x] domain/duplicates.ts (P2: shingles + Jaccard, findNearDuplicates, flag only) and domain/stability.ts (P2: nearCutoff within 2, detectFlips). SERVICE WIRING for both NOT done (P2).
  - [x] tests/unit/fairness.test.ts (swap, impact-ratio hand fixtures, analytics shaping, duplicates, stability)
  => Prompt 13 complete (written NOT compiled/run). NOT done: service wiring for duplicates/stability (P2); swap-test mock-LLM integration test and analytics test on seeded Mongo data (needs mongodb-memory-server; domain math is covered). NEXT: Prompt 14 (demo mode).

- Prompt 14 (demo mode) complete (written NOT compiled/run):
  - [x] src/seed: demoJob (constants), resumeSpecs (22 specs + 5 unseen), resumeContent, renderers (pdfkit/docx, evil white 1pt run, image-only PDFs), generateResumes (+ npm run seed:files)
  - [x] src/seed/demoData.ts (job + interviewers, synthetic labels [only seed/ and biasPanel may import them], wipe, sandbox invite token swap)
  - [x] services/demo.service.ts (seed idempotent via real ingestion, reset keeps audit chain, qr), controller, routes/demo.routes.ts mounted at /demo (DEMO_MODE gate first)
  - [x] prescored-only mode (integrations/llm/prescored.ts) + hook in llmScoring.service; audit action demo.qr added
  - [x] src/seed/prescore.ts (npm run demo:prescore), demoScript.ts (npm run demo:script), warmup.ts (npm run demo:warmup)
  - [x] tests/unit/seed.test.ts, docs/DEMO.md
  Not done: src/seed/prescored.json is NOT shipped (needs a real LLM run: npm run demo:prescore). The script-against-test-DB test needs mongodb-memory-server; run npm run demo:script against a live server instead.
  Contract change requests: (1) POST /demo/seed body {usePrescored?: boolean}; data {jobId, reused, uploaded, accepted, unreadable, flagged[], labelsAssigned, scoring, note}. (2) POST /demo/reset data {wiped, newJobId, auditChainKept, note}. (3) GET /demo/qr data {url, qrDataUrl, candidateId, jobId}.
  => NEXT: Prompt 15 (contract audit, security, performance).

- Prompt 15 (audit + hardening) complete (written NOT compiled/run):
  - Contract audit found MISSING endpoints and added them: GET/POST /jobs, GET/PATCH /jobs/:id, GET/PUT /jobs/:id/interviewers (job.service/controller/routes), GET /jobs/:id/candidates, GET/PATCH/DELETE /candidates/:id (candidate.service/controller/routes; soft delete, refused while a slot is booked). Repos extended: job (list/create/update), interviewer (replaceForJob), candidate (listForJob/findLive/setNotes/softDelete/hasBookedSlot).
  - Hardening: middleware/sanitize.ts (NoSQL operator strip, mounted before CSRF), middleware/timeout.ts (30s / 120s uploads), constants REQUEST_TIMEOUT_MS/UPLOAD_TIMEOUT_MS, audit action candidate.note.
  - Docs: docs/CONTRACT_AUDIT.md, docs/SECURITY.md, docs/PERFORMANCE.md. Tests: tests/unit/sanitize.test.ts.
  Not verified: no explain() plans, no pen test; claims are from code reading. Contract notes for frontend are in CONTRACT_AUDIT.md.
  => NEXT: Prompt 16 (tests, deploy, runbook, final checklist).

- Prompt 16 complete (docs only, not compiled/run): docs/TEST_PLAN.md, DEPLOYMENT.md, RUNBOOK.md, CHECKLIST.md; render.yaml comment updated. ALL 16 PROMPTS DONE. NEXT: npm i && npm run build && npm run test:all on your machine, then npm run demo:prescore.
- Post-16: P2 reminders added (domain/reminders.ts, services/reminder.service.ts, POST /demo/fast-forward {jobId, kind} DEMO_MODE-gated, audit action demo.reminders, tests/unit/reminders.test.ts). Written NOT compiled/run. CONTRACT CHANGE REQUEST: extra endpoint POST /demo/fast-forward. Reminders carry no action buttons (raw tokens are not stored).
- Post-16: near-duplicate wiring done (P2): CANDIDATE_FLAGS += near_duplicate, services/duplicate.service.ts (flag only, later upload gets badge, audit candidate.near_duplicate), called at end of ingestBatch, repo addFlag, tests/unit/duplicateFlag.test.ts. CONTRACT CHANGE REQUEST: new badge string near_duplicate. Not compiled/run. Stability check service still not wired.
- Post-16: stability service (P2) written: services/stability.service.ts runStabilityCheck(jobId, actor), flag rank_unstable, audit candidate.rank_unstable. NOT yet routed/wired; no endpoint (would be extra to contract). Written NOT compiled/run.
