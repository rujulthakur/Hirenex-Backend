# Performance and resilience review (Prompt 15)

Reviewed from the code and index definitions. No explain() output was captured because nothing was run.

## Three heaviest queries and their indexes
1. **Candidate list for a job** (`find({jobId, deletedAt absent, stage?}).sort(rank|totalScore|uploadOrder)`): served by `{jobId, stage, rank}`, `{jobId, totalScore:-1}`, `{jobId, uploadOrder}`. `redactedText` is excluded from list reads and results are `lean()` and paged (limit max 100). Searching `q` on `fileName` is a case-insensitive regex, which scans the job's candidates only (bounded by the jobId prefix, tens to hundreds of docs).
2. **Open slots for scheduling** (`find({jobId, status:'open'}).sort({start:1})`): `{jobId, status, start}`. Booking is one atomic `findOneAndUpdate({_id, status:'open'})`, with unique `{interviewerId, start}` as the second guard.
3. **Analytics** (6 aggregation pipelines in parallel over candidates, slots, invites, scores, with a `$lookup` to labels for the bias panel): each starts with a `$match` on `jobId`, which hits the compound indexes above. Roughly 20 candidates per job in the demo, so cost is trivial; the pipelines stay linear in job size.

## Other checks
- Pagination on every list endpoint (default 20, max 100). Audit export streams CSV in batches instead of loading the chain.
- `lean()` on read paths; compression enabled; analytics uses aggregation rather than loading documents.
- Bounded concurrency for Render free tier (512 MB): ingestion 4, LLM calls 3, in-process runs via p-limit; 5 MB per file in memory.
- Timeouts: LLM 30 s with retry/backoff, HTTP requests 30 s (uploads 120 s), health probes 1.5 s.

## Failure behaviour
| Failure | What still works | What does not |
|---|---|---|
| LLM down | Upload, shield, redaction, ranking from stored scores, scheduling, repairs, audit. Demo mode falls back to prescored fixtures (trace says so). Email drafting falls back to templates. | New scoring outside demo mode: candidate is `needs_review`, never a guessed score |
| Redis down | Demo login, all authenticated routes, portal, scheduling. Candidate email throttle fails open. | OTP login (send and verify) |
| Ethereal down | Everything except delivery; invites are marked `failed` and can be retried | Sending |
| MongoDB slow or down | `/health` reports it; requests fail with INTERNAL, timeout answers 503 | Everything that needs data |
| Corrupt upload | That file is rejected with a reason; the rest of the batch continues | That file |
| Duplicate or racing writes | Unique indexes and atomic updates return CONFLICT or SLOT_TAKEN | |
