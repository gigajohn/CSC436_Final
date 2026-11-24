# StudySync — Peer Code-Review & Assignment Workspace

StudySync is a full-stack, distributed web application for collaborative academic peer code reviews and assignment submissions, built for **CSC436 Distributed Systems & Web Applications**.

---

## 1. Quick Start (Clean-Clone Reproduction)

### Prerequisites
- **Node.js**: v20+ (tested on Node.js v22.21.0)
- **npm**: v10+ (tested on npm 11.14.1)
- **Docker & Docker Compose** (optional: in-process PGlite database is built-in for zero-daemon operation)

### One-Command Setup & Verification
```bash
# 1. Clone the repository
git clone https://github.com/synthetic/CSC436_Final.git
cd CSC436_Final

# 2. Install workspace dependencies
npm install

# 3. Verify strict TypeScript compilation (F1)
npm run typecheck

# 4. Run unified verification test suite across all course requirements (Q1)
npm run test
```

### Running Locally
```bash
# Start backend Express server (http://localhost:4000)
npm run dev:backend

# In a separate terminal, start frontend React + Vite dev server (http://localhost:5173)
npm run dev:frontend
```

### Containerized Deployment (Docker Compose)
```bash
# Build and run backend, frontend, postgres, and redis containers
docker compose up --build -d

# Verify backend readiness gate
curl -i http://localhost:4000/healthz

# Access frontend in your browser
open http://localhost:3000
```

---

## 2. Architecture & Technology Stack

- **Frontend (F1, F2, F9, F13)**: React 18 + TypeScript SPA built with Vite under `strict` mode. Includes search, filter, loading/empty/error states, OIDC/RBAC testing toolbar, live SSE stream consumer, and interactive React MCP App.
- **Backend (F3, F7-F12, S1, D10)**: Node.js 22 + Express + TypeScript under `strict` mode.
- **Datastore (F4, F5, F6)**: PostgreSQL 16 (relational schema, foreign keys, 3 justified explicit indexes, forward/backward schema migrations, and database-level immutable audit trail triggers).
- **Authentication & RBAC (F7, F8, F9)**: OIDC Authorization Code Flow with PKCE (S256), `state`, and `nonce`. Server-side token validation against remote JWKS (signature, issuer, audience, expiry, scopes). Student vs. Instructor RBAC with 401/403 enforcement.
- **Resilient Integrations (F10)**: Automated Code Analysis client with 2000ms timeout, 3 bounded retries, 300s TTL cache in Redis, Zod schema validation, and graceful degradation fallback.
- **Real-Time Streaming (F11)**: Server-Sent Events (SSE) with monotonic event sequence and 500-event circular replay buffer (`Last-Event-ID`).
- **Model Context Protocol (F12, F13)**: JSON-RPC 2.0 MCP server with 3 read tools (`list_submissions`, `get_submission_details`, `list_review_comments`) and 1 confirmed write tool (`post_review_comment`).
- **Observability (D10)**: OpenTelemetry W3C `traceparent` distributed tracing spanning multiple components, structured JSON logging, Prometheus `/metrics`, SLI/SLO tracking, and alerting.

---

## 3. Course Requirements & Evidence Matrix

| Req # | Requirement Name | Key Implementation Files | Verification Command | Proof Document |
|---|---|---|---|---|
| **Hard Gates** | No live secrets, synthetic data only, no unauthorized write | Root config, synthetic seed data | `npm run test` | [`docs/evidence-dossier.md`](docs/evidence-dossier.md) |
| **F1** | React + TS strict SPA | `frontend/src/App.tsx` | `npm run typecheck` | [`docs/evidence-dossier.md`](docs/evidence-dossier.md#f1-react--typescript-strict-frontend) |
| **F2** | Loading, empty, and error states | `frontend/src/App.tsx` | Interactive simulator in UI | [`docs/evidence-dossier.md`](docs/evidence-dossier.md#f2-visible-loading-empty-and-error-states) |
| **F3** | REST API semantics & uniform error shape | `backend/src/routes/eventsRouter.ts` | `npm --workspace=backend run test:rest` | [`docs/evidence/f3-rest-curl-transcript.txt`](docs/evidence/f3-rest-curl-transcript.txt) |
| **F4, F5** | Relational DB, indexes, migrations | `backend/src/db/migrator.ts` | `npm --workspace=backend run test:storage` | [`docs/evidence-dossier.md`](docs/evidence-dossier.md#f4--f5-relational-persistence-migrations--justified-indexes) |
| **F6** | Append-only audit trail & trigger | `backend/src/db/migrator.ts` | `npm --workspace=backend run test:storage` | [`docs/evidence-dossier.md`](docs/evidence-dossier.md#f6-append-only-audit-trail) |
| **F7, F8** | OIDC PKCE & JWKS validation | `backend/src/auth/jwksValidator.ts` | `npm --workspace=backend run test:auth` | [`docs/evidence-dossier.md`](docs/evidence-dossier.md#f7-f8-f9-s1-oidc-pkce-auth-jwks-validation-rbac--rate-limiting) |
| **F9** | Student vs Instructor RBAC | `backend/src/middleware/rbac.ts` | `npm --workspace=backend run test:auth` | [`docs/evidence-dossier.md`](docs/evidence-dossier.md#f7-f8-f9-s1-oidc-pkce-auth-jwks-validation-rbac--rate-limiting) |
| **F10** | Third-party resilient API client | `backend/src/integrations/codeAnalysisClient.ts` | `npm --workspace=backend run test:thirdparty` | [`docs/evidence-dossier.md`](docs/evidence-dossier.md#f10-third-party-api-integration--resilience) |
| **F11** | Live updates via SSE & replay buffer | `backend/src/realtime/sseHandler.ts` | `npm --workspace=backend run test:sse` | [`docs/evidence-dossier.md`](docs/evidence-dossier.md#f11-real-time-sse-stream-with-reconnection-buffer) |
| **F12, F13**| MCP Server & Interactive MCP App | `backend/src/mcp/mcpTools.ts` | `npm --workspace=backend run test:mcp` | [`docs/evidence-dossier.md`](docs/evidence-dossier.md#f12--f13-oauth-protected-mcp-server--interactive-mcp-app) |
| **D4** | CI/CD pipeline & healthz rollback | `.github/workflows/ci.yml` | GitHub Actions / Docker | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) |
| **D5** | Reproducible build & clean-clone | `backend/Dockerfile`, `frontend/Dockerfile` | `docker compose up --build` | [`README.md`](README.md#1-quick-start-clean-clone-reproduction) |
| **D6, D7** | CDN cache policy, CORS & headers | `frontend/nginx.conf`, `backend/src/app.ts` | `npm --workspace=backend run generate:transcript` | [`docs/evidence/f3-rest-curl-transcript.txt`](docs/evidence/f3-rest-curl-transcript.txt) |
| **D8** | Performance: Code-splitting & Core Web Vitals | `frontend/vite.config.ts`, `frontend/src/App.tsx` | `npm --workspace=frontend run build` | [`docs/evidence/performance-core-web-vitals.md`](docs/evidence/performance-core-web-vitals.md) |
| **D9** | Accessibility: Zero axe violations & keyboard | `frontend/src/scripts/verify-d9-accessibility.ts` | `npm --workspace=frontend run test:axe` | [`docs/evidence/accessibility-report.md`](docs/evidence/accessibility-report.md) |
| **D10** | OpenTelemetry Tracing & SLI/SLO | `backend/src/observability/tracer.ts` | `npm --workspace=backend run test:observability` | [`docs/evidence-dossier.md`](docs/evidence-dossier.md#d10-opentelemetry-tracing-slislo--alerting) |
| **D11** | Cost scaling analysis (1×, 10×, 100×) | `docs/cost-scaling-analysis.md` | Static Analysis | [`docs/cost-scaling-analysis.md`](docs/cost-scaling-analysis.md) |
| **S1** | Sliding window rate limiting (429) | `backend/src/middleware/rateLimiter.ts` | `npm --workspace=backend run test:auth` | [`docs/evidence-dossier.md`](docs/evidence-dossier.md#f7-f8-f9-s1-oidc-pkce-auth-jwks-validation-rbac--rate-limiting) |
| **S2** | Operations Runbook & Game Day Postmortem | `docs/runbook.md`, `docs/game-day-postmortem.md` | Runbook walkthrough | [`docs/runbook.md`](docs/runbook.md) & [`docs/game-day-postmortem.md`](docs/game-day-postmortem.md) |
| **Q1** | Unified automated test suite | `package.json` | `npm run test` | [`docs/evidence-dossier.md`](docs/evidence-dossier.md) |
| **Q2** | Architecture & trust boundaries | `docs/architecture.md` | Mermaid Diagrams | [`docs/architecture.md`](docs/architecture.md) |
| **Q3** | Comprehensive evidence dossier | `docs/evidence-dossier.md` | Git & CLI Audit | [`docs/evidence-dossier.md`](docs/evidence-dossier.md) |

---

## 4. Documentation Directory

- **[System Architecture & Trust Boundaries](docs/architecture.md)** (Mermaid diagrams of request path and security boundaries)
- **[Operations Runbook](docs/runbook.md)** (Startup, migration steps, secret rotation, and incident triage)
- **[Game Day Postmortem](docs/game-day-postmortem.md)** (Deliberate upstream failure drill, 5 Whys, and failover verification)
- **[Cost & Scaling Analysis](docs/cost-scaling-analysis.md)** (1×, 10×, and 100× traffic capacity planning and arithmetic)
- **[Accessibility & axe-core Report](docs/evidence/accessibility-report.md)** (Zero critical/serious violations, full keyboard walkthrough)
- **[Core Web Vitals & Performance Report](docs/evidence/performance-core-web-vitals.md)** (Code-splitting, 89.1% bundle reduction, LCP/TBT improvements)
- **[Course Evidence Dossier](docs/evidence-dossier.md)** (Comprehensive audit trail of commit SHAs, reproduction commands, raw logs, deliberate failures, and AI provenance)
- **[REST API curl -i Transcript](docs/evidence/f3-rest-curl-transcript.txt)** (Raw HTTP request/response transcripts across all methods, status codes, and error envelopes)
