# Security pass (Prompt 15)

Honest scope: reviewed by reading the code, not by penetration testing. Tamper-EVIDENT, not tamper-proof.

| Threat | Control | File |
|---|---|---|
| NoSQL injection | `$`/dotted keys stripped from body, query, params, then zod validation; search `q` is an escaped literal, never a user regex; sort fields allow-listed | middleware/sanitize.ts, middleware/validate.ts, utils/pagination.ts, repositories/candidate.repository.ts |
| XSS in stored fields and emails | API is JSON only; email templates HTML-escape every interpolated value; no user HTML is ever rendered; helmet headers | domain/emailTemplates.ts, app.ts |
| File upload abuse | 50 files, 5 MB each, memory storage; extension + magic-byte check; DOCX capped at 300 entries and 30 MB declared uncompressed; per-file failures isolated; ingestion concurrency 4 | middleware/upload.ts, services/ingestion/validate.ts |
| SSRF | No outbound fetch is built from user input. LLM and Google endpoints are fixed; candidate mail only to the Ethereal host (allow-list throws otherwise) | integrations/llm/postJson.ts, integrations/mailer/candidateMailer.ts |
| Token handling | OTP codes and portal/refresh tokens stored as SHA-256 only; constant-time compare; one-time OTP delete; refresh rotation with reuse detection revokes the family | utils/crypto.ts, services/otp.service.ts, domain/portalToken.ts, services/auth.service.ts |
| Cookies | httpOnly, Secure in production, SameSite from env, refresh cookie scoped to /api/v1/auth | utils/authCookies.ts |
| CORS | Allow-list from CORS_ORIGINS, credentials on | app.ts |
| CSRF | `X-Requested-By: trusthire` required on every non-GET; cross-site forms cannot set it, cross-site fetch hits the CORS preflight | middleware/csrfHeader.ts |
| Rate limits | Global 300/min; auth 30 per 15 min (strict); demo login 10/min; upload 20/min; portal 30/min; invite send 10/min; job/candidate writes 60/min; OTP 5 sends/hour/email in Redis | middleware/rateLimit.ts, routes/*.ts, services/otp.service.ts |
| Request abuse | JSON body limit 1 MB; 30 s request timeout (120 s for uploads) | app.ts, middleware/timeout.ts |
| Secrets | Env validated at boot with zod, never logged, Gemini key sent in a header, error messages carry no keys or bodies | config/env.ts, integrations/llm/*.adapter.ts |
| Log redaction | Keys containing password, token, otp, authorization, cookie, secret are redacted; resume text is never logged (length + hash only in traces) | utils/logger.ts, services/trace.service.ts |
| Dependency risk | `npm run audit:deps` (npm audit, production deps) | package.json |
| Least privilege | Rule table by route group: interviewers can only read their own schedule; portal routes need a valid token only | config/rolePolicy.ts, middleware/authorize.ts |
| Audit completeness | Every state change appends a hash-chained entry (job.create/update, resume.upload, score.run/override, shortlist.approve, schedule.run, slot.booked, invite.*, portal.*, repair.*, candidate.note/delete, demo.*, auth.*) | services/audit.service.ts |
| Data leakage | Original resume text lives in its own collection and is never returned or sent to the LLM; synthetic group labels are import-blocked from scoring code by ESLint | models/candidateText.model.ts, .eslintrc.cjs |
| Prompt injection | See below | domain/shield/*, integrations/llm/prompts.ts |

## Prompt-injection defence recap
Layers: (1) injection phrase scanner flags, never rejects; (2) hidden-text detection for DOCX and PDF; (3) redaction before the model sees text;
(4) randomised-nonce fencing of resume text with fixed system rules; (5) strict zod output schemas; (6) code verifies every quote and computes
totals, so a model that is tricked still cannot raise a score without a quote that exists in the resume; (7) humans approve before any email.

What it does NOT catch: paraphrased or non-English instructions, text hidden in images, white text in PDFs with unusual colour spaces,
instructions split across many small items, and anything a human reviewer overlooks. It reduces risk; it does not eliminate it.
