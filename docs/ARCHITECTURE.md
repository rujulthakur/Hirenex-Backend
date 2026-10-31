# TrustHire backend: architecture (Prompt 1)

Principle: **AI proposes, code verifies, humans decide.**

## Folders

| folder | responsibility | may import from |
|---|---|---|
| src/config | zod-validated env, constants, Mongo connection | utils, (logger) |
| src/server.ts, src/app.ts | process boot and Express wiring | everything below |
| src/routes | URL -> middleware -> controller mapping only | controllers, middleware |
| src/controllers | parse validated input, call one service, shape the envelope. No business logic | services, utils, types |
| src/services | use-cases and orchestration. Never touch req/res | repositories, domain, integrations, utils, types |
| src/repositories | all database queries and atomic updates | models, utils, types |
| src/models | Mongoose schemas and indexes | types, utils |
| src/middleware | auth, authorize, validate, rateLimit, errorHandler, requestId, csrfHeader, upload | config, utils, services (auth only) |
| src/domain | PURE functions (no I/O): quote, scoring, ranking, slots, assignment, repair, hashchain, redaction, shield | types, utils (pure) |
| src/integrations | llm, mailer, redis, google. Wrappers around outside systems | config, utils |
| src/jobs | small in-process run queue (p-limit + runs collection) | services, repositories |
| src/seed | synthetic data generators | services, domain |
| src/utils | errors, logger, pagination, asyncHandler | nothing internal except config/constants |
| src/types | zod schemas and shared types | nothing |
| tests/{unit,integration} | vitest and supertest | anything |

## Dependency flow

1. Request flow is routes -> controllers -> services -> repositories -> models. Never upward.
2. Controllers hold no business rules; services never see `req` or `res`.
3. `domain` is pure and imported by services only, so every rule is unit-testable without a database.
4. `integrations` are the only code that talks to Redis, SMTP, Google or an LLM.
5. `utils`, `types` and `config/constants` are leaves that anything may import.

## CSRF decision

Auth uses httpOnly cookies, so the browser attaches them automatically. Every non-GET/HEAD/OPTIONS request
must carry `X-Requested-By: trusthire`. A cross-site `<form>` or `<img>` cannot set a custom header. A
cross-site `fetch` that sets it triggers a CORS preflight, which our allow-list (`CORS_ORIGINS`) rejects.
Add `SameSite` cookies and the attack surface left is small enough for this app. Safe methods never change
state, so they are exempt.

## Error envelope and status codes

`{ "error": { "code", "message", "details": [] } }`

| code | HTTP |
|---|---|
| VALIDATION_FAILED | 400 (413 for oversized JSON body) |
| UNAUTHENTICATED | 401 |
| FORBIDDEN | 403 |
| NOT_FOUND | 404 |
| CONFLICT, APPROVAL_REQUIRED, SLOT_TAKEN | 409 |
| TOKEN_EXPIRED | 410 |
| UPLOAD_REJECTED | 400 |
| RATE_LIMITED | 429 |
| INTERNAL | 500 |
| AI_UNAVAILABLE | 503 |

## Health

`GET /api/v1/health` -> `{ "data": { status, db, redis, llm } }`. 200 when the database is up (status `ok` or
`degraded` when Redis is down), 503 when the database is down. `llm` is the configured provider name or
`unconfigured`; the LLM is never called.
