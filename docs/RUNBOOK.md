# Demo-day runbook

## T-10 minutes
`npm run demo:warmup` (pings /health, primes Ethereal and the LLM). Then `POST /demo/seed` (idempotent) or press the seed button. Open the Ethereal preview inbox in a tab.

## If something fails
| Failure | What still works | Action |
|---|---|---|
| LLM down / rate limited | Everything deterministic | Seed with `usePrescored=true` (reads src/seed/prescored.json; trace says so). Generate it beforehand with `npm run demo:prescore`. |
| Ethereal down | Drafts, approval, schedule | Show invite drafts from `GET /jobs/:id/invites/preview` (stored drafts); retry send later. |
| Redis down | Demo login, all non-auth routes | OTP login disabled; use the Judge demo login. Rate limits fall back per the hardening notes in SECURITY.md. |
| Database slow | Nothing without it | Switch MONGODB_URI to a local mongod with a pre-seeded copy; restart. |
| Render asleep | n/a | Hit /health, wait ~40s. |
| Audit "Verify chain" shows broken | n/a | Do NOT reset the chain. Explain: tamper-evident detects it. Start a fresh demo job via `POST /demo/reset`. |

## Reset between runs
`POST /demo/reset` wipes demo job data only; the audit chain is never deleted (it logs demo.reset). Then seed again.

## Contract drift log (share with the frontend developer)
| Date/time | Endpoint or field | Change | Edited in both PDFs? | Frontend notified? |
|---|---|---|---|---|
| | | | | |

Open change requests so far: POST /candidates/:id/probes (extra endpoint); demo seed/reset/qr response shapes (see PROGRESS.md).
