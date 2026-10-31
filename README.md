# TrustHire backend

Node 20 + Express + TypeScript + MongoDB + Redis + LLM. Built prompt by prompt from the Backend Prompt Pack.

## Run

```bash
cp .env.example .env     # fill in MONGODB_URI, REDIS_URL, secrets
npm install
npm run dev
curl http://localhost:4000/api/v1/health
```

If env values are missing the app prints the list of problems and exits before opening a port.

## Scripts

`dev`, `build`, `start`, `lint`, `format`, `test`, `test:unit`, `test:integration`, `test:all`, `audit:deps`.

## Progress

- [x] Prompt 1: scaffold, architecture, config, errors, logging, health, Docker
