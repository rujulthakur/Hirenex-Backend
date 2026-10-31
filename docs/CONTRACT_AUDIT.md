# Contract audit (Prompt 15)

Static review of routes, controllers and zod schemas against SHARED API CONTRACT v1. Nothing was executed.
"Shape" = the response envelope and key fields follow the contract; the notes column lists where we return more than the contract names.

| Area | Endpoint | Impl | Controller | Request schema | Shape |
|---|---|---|---|---|---|
| Auth | POST /auth/send-otp | yes | auth.controller | auth.schema sendOtpSchema | yes |
| Auth | POST /auth/verify-otp | yes | auth.controller | verifyOtpSchema | yes (user flat under data) |
| Auth | POST /auth/google | yes | auth.controller | googleAuthSchema | yes |
| Auth | POST /auth/demo-login | yes | auth.controller | none | yes |
| Auth | POST /auth/refresh, /auth/logout | yes | auth.controller | none (cookies) | yes |
| Auth | GET /auth/me | yes | auth.controller | none | yes |
| Jobs | GET /jobs, POST /jobs | **added in P15** | job.controller | listQuery, createJobSchema | yes (201 on create, meta on list) |
| Jobs | GET /jobs/:id, PATCH /jobs/:id | **added in P15** | job.controller | jobParamsSchema, updateJobSchema | yes |
| Jobs | GET/PUT /jobs/:id/interviewers | **added in P15** | job.controller | replaceInterviewersSchema | yes |
| Resumes | POST /jobs/:id/resumes | yes | resume.controller | multer "files" | yes |
| Candidates | GET /jobs/:id/candidates | **added in P15** | candidate.controller | listCandidatesQuerySchema | yes (meta) |
| Candidates | GET /candidates/:id | **added in P15** | candidate.controller | idParams | yes (redacted text only) |
| Candidates | GET /candidates/:id/scores | yes | scoring.controller | scoreParams | yes |
| Candidates | PATCH /candidates/:id/scores/:criterionId | yes | scoring.controller | overrideScoreSchema | yes |
| Candidates | PATCH /candidates/:id, DELETE /candidates/:id | **added in P15** | candidate.controller | patchCandidateSchema | yes (delete is soft, audited) |
| Candidates | POST /candidates/:id/swap-test | yes | fairness.controller | idParams | yes (+ redactedIdentical, rescoredDelta) |
| Scoring | POST /jobs/:id/score, GET /jobs/:id/score/status | yes | scoring.controller | idParams | yes |
| Shortlist | GET /jobs/:id/shortlist, POST /rerank, POST /approve | yes | scoring.controller | rerankSchema, approveSchema | yes |
| Schedule | POST/GET /jobs/:id/schedule, GET /shortfall | yes | schedule.controller | idParams | yes |
| Schedule | POST /jobs/:id/interviewers/:iid/unavailable | yes | repair.controller | unavailableSchema | yes |
| Schedule | GET /jobs/:id/repairs | yes | repair.controller | idParams | yes |
| Invites | GET /jobs/:id/invites/preview, POST /send, GET /invites, PATCH /invites/:id | yes | invite.controller | idParams, edit body | yes |
| Portal | GET /portal/:token, GET /status, POST /accept | yes | invite.controller | portalTokenParamsSchema | yes |
| Portal | POST /portal/:token/decline, /reschedule | yes | repair.controller | portalTokenParamsSchema, {note} | yes |
| Audit | GET /jobs/:id/audit, GET /audit/verify, GET /audit/export | yes | audit.controller | auditQuerySchema | yes (CSV streamed) |
| Trace | GET /jobs/:id/trace | yes | trace.controller | idParams | yes |
| Analytics | GET /jobs/:id/analytics | yes | fairness.controller | idParams | yes |
| Notifications | GET /notifications, POST /notifications/read | yes | fairness.controller | pagination, read body | yes |
| Demo | POST /demo/seed, /demo/reset, GET /demo/qr | yes | demo.controller | seed body | yes |
| Health | GET /health | yes | health.controller | none | yes |

## Extra endpoints (not in the contract, each justified)
| Endpoint | Why |
|---|---|
| GET /auth/sessions | Lists active devices (refresh rotation, Prompt 4) |
| GET /jobs/:id/schedule/status | Polling a 202 scheduling run, same pattern as score/status |
| POST /candidates/:id/probes | Probe questions (Prompt 13) |

## Known contract notes for the frontend
- Soft-deleted candidates disappear from every list, score, rank and analytics query. Their file hash stays reserved (re-upload reports a duplicate).
- PATCH /jobs/:id refuses criteria, capacity, waitlist, duration and constraints changes after approval (CONFLICT).
- PUT /jobs/:id/interviewers is refused once a schedule exists (CONFLICT). Use the unavailable endpoint.
- DELETE /candidates/:id is refused while the candidate holds a booked slot (CONFLICT).
- New audit actions: `candidate.note`, `demo.qr`.
