# TrustHire data model (Prompt 2)

## Relationship diagram

```
users 1---* refreshTokens            users 1---* notifications
users 1---* jobs (ownerId)
jobs  1---* interviewers             interviewers 1---* slots
jobs  1---* candidates               jobs 1---* slots
jobs  1---* runs / aiTraces / repairs / auditLogs(jobId?)
candidates 1---1 candidateTexts      (ORIGINAL text, never in API/LLM)
candidates 1---1 scores              candidates 1---1 syntheticLabels (AUDIT-ONLY)
slots 0..1---1 candidates (booked)   invites *---1 slot, *---1 candidate
invites 0..1---1 invites (supersededBy)
counters (_id 'auditLogs') ---> auditLogs.seq
```

## Collections and indexes

| collection | indexes | why |
|---|---|---|
| users | email unique; googleSub unique sparse | login lookup; Google linking |
| refreshTokens | tokenHash unique; family; (userId, revokedAt); expiresAt TTL(0) | rotation lookup; revoke family; auto-purge |
| jobs | (ownerId, createdAt -1); (status, createdAt -1) | job list |
| interviewers | jobId | list/replace per job |
| candidates | (jobId, textHash) unique; (jobId, stage, rank); (jobId, totalScore -1); (jobId, uploadOrder); (jobId, deletedAt) | dedupe; filtered list; ranking; tie-break; soft delete |
| candidateTexts | candidateId unique; jobId | original text lookup (email name, swap test) |
| scores | candidateId unique; jobId; cacheKey sparse | per-candidate read; rerank; LLM cache |
| slots | (interviewerId, start) unique; (jobId, status, start); (jobId, candidateId) sparse | double-booking guard; earliest open slot; candidate lookup |
| invites | tokenHash unique; (jobId, emailStatus); (jobId, candidateId); slotId | portal; send drafts; status table; repair |
| auditLogs | seq unique; (jobId, seq -1); (actor.id, seq -1); (action, seq -1); ts -1 | chain order; filters |
| counters | _id | atomic audit seq |
| aiTraces | (jobId, ts -1); (runId, ts); ts TTL 30d | trace feed; run view; cleanup |
| runs | (jobId, type, createdAt -1) | latest run |
| repairs | (jobId, ts -1) | latest diffs |
| notifications | (userId, readAt, ts -1); ts TTL 90d | unread list; cleanup |
| syntheticLabels | candidateId unique; (jobId, group) | bias panel only |

## TTL / cleanup policy

- refreshTokens: removed at expiresAt (TTL index).
- aiTraces: 30 days. notifications: 90 days.
- auditLogs and counters: never deleted, including by demo reset (deleting would break the chain).
- Demo reset wipes job-scoped data (candidates, texts, scores, slots, invites, runs, repairs, labels) and logs `demo.reset`.
- Candidate delete is soft (`deletedAt`), audited.

## Audit-only rule

`syntheticLabels` lives in `src/models/auditOnly/`, is not exported from `src/models/index.ts`, and the ESLint
`no-restricted-imports` rule blocks it everywhere except `src/services/biasPanel.service.ts`, `src/seed/**`.
