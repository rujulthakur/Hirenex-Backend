# Test plan (Prompt 16)

Run everything: `npm run test:all` (vitest, no CI needed). Unit only: `npm run test:unit`.

| Layer | What | Tool | File(s) |
|---|---|---|---|
| Domain | Quote verification (30 cases, unicode, paraphrase) | vitest | tests/unit/quote.test.ts |
| Domain | Injection scanner, false-positive guards | vitest | tests/unit/shield/injection.test.ts |
| Domain | Hidden text DOCX / PDF detectors | vitest | tests/unit/shield/hiddenDocx.test.ts, hiddenPdf.test.ts |
| Domain | Redaction + prompt fence | vitest | tests/unit/shield/redaction.test.ts, fence.test.ts |
| Domain | Scoring maths | vitest | tests/unit/scoring.test.ts |
| Domain | Ranking tie-break + determinism property tests | vitest | tests/unit/ranking.test.ts |
| Domain | Slot generation (3 zones incl. Asia/Kolkata, DST day) | vitest | tests/unit/slots.test.ts |
| Domain | Assignment + no-double-booking invariant, shortfall | vitest | tests/unit/scheduler.test.ts |
| Domain | Repair invariants, minimal movement, idempotency | vitest | tests/unit/repair.test.ts |
| Domain | Audit chain tamper test, 50 parallel appends | vitest | tests/unit/hashchain.test.ts, audit.service.test.ts |
| Domain | Stage transitions | vitest | tests/unit/stages.test.ts |
| Domain | Swap test, impact ratio, analytics shaping | vitest | tests/unit/fairness.test.ts |
| Service | OTP limits, one-time use, enumeration safety | vitest | tests/unit/otp.service.test.ts, auth.service.test.ts |
| Service | Approval guard on dependent routes | vitest | tests/unit/approval.test.ts |
| Service | Token expiry, hash storage, host allow-list | vitest | tests/unit/email.test.ts |
| Service | LLM retry, schema failure, cache, adversarial mock | vitest | tests/unit/llm/*.test.ts |
| Middleware | authorize rules, cookies, sanitize, errors, pagination, env | vitest | tests/unit/*.test.ts |
| HTTP | Health, auth routes, demo gating, Google, ingestion pipeline | vitest + supertest | tests/integration/*.test.ts |
| E2E | 6-step demo through the HTTP API (PASS/FAIL per step) | tsx script, live server | `npm run demo:script` |

## Known gaps (honest)
- Nothing in this pack was compiled or run in the build environment. First action on your machine: `npm i && npm run build && npm run test:all`, fix whatever surfaces.
- Tests needing a real Mongo (analytics aggregation, atomic-booking concurrency against Mongo, demo script on a test DB) require `mongodb-memory-server` or a local Mongo; the pure-domain parts are covered without it.
- `src/seed/prescored.json` is not shipped: run `npm run demo:prescore` once with a real LLM key.
