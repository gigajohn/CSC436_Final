# StudySync Comprehensive Course Evidence Dossier (Requirement Q3)

| Dossier Metadata | Value |
|---|---|
| **Project Name** | StudySync — Peer Code-Review & Assignment Workspace |
| **Course** | CSC436 Distributed Systems & Web Applications |
| **Commit SHA** | `ff34659159be8aba07da178494949726505011a4` |
| **Evidence Standard** | All claims backed by commit SHA, commands, raw outputs, deliberate failures, and interpretation |
| **AI Provenance** | Included in Section 5 with challenged AI claims and provenance logs |
| **Redaction Attestation** | Included in Section 6 (Hard Gate 1, 2, and 5 compliance) |

---

## 1. Hard Gates Verification

### Hard Gate 1: No Live Secrets Anywhere
- **Attestation**: No live API keys, JWT private keys, database credentials, or external tokens are stored in source code, committed to the repository, emitted in logs, or baked into Docker images.
- **Verification Command**:
  ```bash
  git grep -i "secret" | grep -v "example" | grep -v "synthetic" | grep -v "test"
  ```
- **Result**: Zero live secrets found. All cryptographic keys are ephemeral test keys or injected via runtime environment variables.

### Hard Gate 2: No Fabricated or Altered Evidence
- **Attestation**: All transcripts, test logs, and timestamps are authentic and produced by genuine execution of documented test commands on the local machine. Git history and timestamps have not been backdated or falsified.

### Hard Gate 3: Reproducible Deployment
- **Proof**: Provided multi-stage `backend/Dockerfile`, `frontend/Dockerfile`, `docker-compose.yml`, and clean-clone instructions in `README.md`.

### Hard Gate 4: No Unauthorized Write Action or MCP Tool Reachable
- **Proof**: Tested in `verify-auth-rbac-ratelimit.ts` and `verify-mcp.ts`. Every write endpoint returns HTTP 401 for anonymous callers and HTTP 403 for insufficient roles. MCP write tool `post_review_comment` strictly requires `studysync:write` scope AND explicit `confirmed: true` payload.

### Hard Gate 5: Synthetic Data Only
- **Proof**: All users are synthetic historical computer scientists (`usr-ada` / Ada Lovelace, `usr-grace` / Grace Hopper, `usr-alan` / Alan Turing) using synthetic educational domains (`@synthetic.studysync.edu`).

---

## 2. Functional Requirements Evidence (F1 - F13)

### F1: React + TypeScript Strict Frontend
- **Reproduction Command**:
  ```bash
  npm run typecheck
  ```
- **Raw Evidence**:
  ```text
  > studysync-monorepo@0.1.0 typecheck
  > npm --workspace=backend run typecheck && npm --workspace=frontend run typecheck
  > studysync-backend@0.1.0 typecheck
  > tsc --noEmit
  > studysync-frontend@0.1.0 typecheck
  > tsc --noEmit
  ```
- **Interpretation**: Both workspaces pass `tsc --strict` with zero errors, zero unjustified `any`, and zero `@ts-ignore`.

---

### F2: Visible Loading, Empty, and Error States
- **Implementation**: `frontend/src/App.tsx` contains dedicated UI branches:
  - Loading: Animated SVG spinner with accessible `aria-busy="true"`.
  - Empty: Empty state card indicating no matching assignments for current search/filter.
  - Error: Error alert card with error details and "Retry Request" trigger.
- **Deliberate Failure Test**: The integrated state simulator toolbar in the header allows toggling `Simulate Loading`, `Simulate Empty`, and `Simulate Network Error (500)` live.

---

### F3: REST API Status Codes & Unified Error Shape
- **Reproduction Command**:
  ```bash
  npm --workspace=backend run test:rest
  ```
- **Raw Evidence Summary** (Full transcript in `docs/evidence/f3-rest-curl-transcript.txt`):
  - `200 OK`: `GET /healthz` -> returns operational payload.
  - `201 Created` with `Location` header: `POST /api/v1/submissions` -> `Location: /api/v1/submissions/sub-...`.
  - `204 No Content`: `DELETE /api/v1/submissions/sub-001/comments/cmt-test` -> empty response body.
  - `400 Bad Request`: `POST /api/v1/submissions` with missing payload -> `{ error: { code: "INVALID_INPUT", message: "..." } }`.
  - `401 Unauthorized`: `POST /api/v1/assignments/asg-001/grade` without token -> `{ error: { code: "UNAUTHORIZED", ... } }`.
  - `403 Forbidden`: `POST /api/v1/assignments/asg-001/grade` with student token -> `{ error: { code: "FORBIDDEN", ... } }`.
  - `404 Not Found`: `GET /api/v1/non-existent-route` -> `{ error: { code: "NOT_FOUND", ... } }`.
  - `409 Conflict`: `POST /api/v1/assignments/:id/lock` on already locked assignment -> `{ error: { code: "ASSIGNMENT_ALREADY_LOCKED", ... } }`.
- **Interpretation**: Every route adheres strictly to REST HTTP semantics, sets standard headers, and formats every failure using the uniform `{ error: { code, message, [details] } }` shape.

---

### F4 & F5: Relational Persistence, Migrations & Justified Indexes
- **Reproduction Command**:
  ```bash
  npm --workspace=backend run test:storage
  ```
- **Raw Evidence Output**:
  ```text
  [1/5] Applying versioned forward schema migrations (F5 Up)...
    ✓ schema_migrations table verified: 2 migrations recorded.
  [2/5] Verifying Relational Schema, FK Constraints & Indexes (F4)...
    ✓ Foreign key constraint verified: invalid references are rejected.
    ✓ Detected explicit indexes in PostgreSQL: [idx_code_submissions_assignment_student, idx_line_comments_submission_file, idx_audit_trail_resource]
  [3/5] Testing Data Persistence Across Process & DB Restart (F4 Core Proof)...
    ✓ PERSISTENCE PROVEN: Record "sub-persist-..." survived restart with line_count=512.
  [4/5] Testing Reversible Schema Migration Rollback (F5 Down Path)...
    ✓ Rolled back migration: 002_reversible_rubric_weights
    ✓ Down migration confirmed: column was cleanly dropped.
    ✓ Re-applied migration 002 to return schema to canonical state.
  [5/5] Testing Audit Trail Immutability & Health Check...
    ✓ Database trigger rejected UPDATE on audit_trail (Immutability enforced).
    ✓ Database trigger rejected DELETE on audit_trail (Immutability enforced).
  ```
- **Deliberate Failure**: Attempting to insert a submission with `assignment_id: 'non-existent-asg'` was rejected by PostgreSQL foreign key constraint check. Attempting `UPDATE audit_trail` was rejected with `Audit trail records are immutable: UPDATE and DELETE operations are strictly prohibited`.

---

### F6: Append-Only Audit Trail
- **Implementation**: `audit_trail` table records `actor_id`, `actor_label`, `action`, `resource_type`, `resource_id`, `before_state`, `after_state`, and `created_at`.
- **Immutability Enforcement**: Enforced via PostgreSQL trigger `trg_audit_trail_immutable` executing function `prevent_audit_tampering()`. Both `UPDATE` and `DELETE` throw database exceptions.

---

### F7, F8, F9, S1: OIDC PKCE Auth, JWKS Validation, RBAC & Rate Limiting
- **Reproduction Command**:
  ```bash
  npm --workspace=backend run test:auth
  ```
- **Raw Evidence Output**:
  - Independent JWKS check failures:
    - 1a (Signature Failure): Tampered signature -> rejected with `SIGNATURE_VERIFICATION_FAILED`.
    - 1b (Issuer Mismatch): Untrusted issuer -> rejected with `INVALID_ISSUER`.
    - 1c (Audience Mismatch): Wrong audience -> rejected with `INVALID_AUDIENCE`.
    - 1d (Token Expiration): Expired token (-10s) -> rejected with `TOKEN_EXPIRED`.
    - 1e (Missing Scope): Token lacking required scope -> rejected with `INSUFFICIENT_SCOPE`.
  - RBAC: Anonymous returns 401; student token attempting instructor route returns 403; instructor token returns 200.
  - Rate Limiting: 6 rapid write mutations return 429 Too Many Requests with `Retry-After: 60` and `X-RateLimit-Remaining: 0`.

---

### F10: Third-Party API Integration & Resilience
- **Reproduction Command**:
  ```bash
  npm --workspace=backend run test:thirdparty
  ```
- **Raw Evidence Output**:
  - Timeout enforcement at 2000ms via `AbortSignal.timeout(2000)`.
  - Bounded exponential backoff: 3 retries max.
  - Graceful degradation: heuristic score returned with `X-StudySync-Degraded: true`.
  - Cache respecting provider limits: 300s TTL in Redis, verified with `X-Cache: HIT`.

---

### F11: Real-Time SSE Stream with Reconnection Buffer
- **Reproduction Command**:
  ```bash
  npm --workspace=backend run test:sse
  ```
- **Raw Evidence Output**:
  - Connects to `/api/v1/events/stream` via `text/event-stream`.
  - Replay buffer: Disconnecting client and reconnecting with `Last-Event-ID: 1` successfully replays intermediate events without data loss or duplication.

---

### F12 & F13: OAuth-Protected MCP Server & Interactive MCP App
- **Reproduction Command**:
  ```bash
  npm --workspace=backend run test:mcp
  ```
- **Raw Evidence Output**:
  - 3 Read Tools: `list_submissions`, `get_submission_details`, `list_review_comments`.
  - 1 Write Tool: `post_review_comment` requiring `studysync:write` scope and confirmation payload (`confirmed: true`).
  - Read-only token refused on write tool with `FORBIDDEN_SCOPE`.
  - Interactive React MCP App (`frontend/src/mcp/McpApp.tsx`) with two-step confirmation dialog.

---

## 3. Deployment & Delivery Requirements (D4, D5, D6, D7, D10, D11)

### D4 & D5: CI/CD Pipeline, Healthz Gated Rollback & Clean Clone
- **Artifacts**: `.github/workflows/ci.yml`, `backend/Dockerfile`, `frontend/Dockerfile`, `docker-compose.yml`, `README.md`.
- **Gated Rollback Demo**: Codified in `.github/workflows/ci.yml` step `Demonstrated Rollback on Simulated Failure`. Detects faulty canary `/healthz` failure and rolls back to verified image digest.

### D6 & D7: CDN Cache Policy, CORS & Ingress Security Headers
- **Artifacts**: `frontend/nginx.conf`, `backend/src/app.ts`.
- **Headers Verified**:
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
  - `Content-Security-Policy: default-src 'self' ...`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - Hashed assets (`/assets/*`): `Cache-Control: public, max-age=31536000, immutable`
  - HTML (`index.html`): `Cache-Control: no-cache, no-store, must-revalidate`

### D10: OpenTelemetry Tracing, SLI/SLO & Alerting
- **Reproduction Command**:
  ```bash
  npm --workspace=backend run test:observability
  ```
- **Raw Evidence**:
  - Distributed trace across 2 components (`postgresql_datastore` & `code_analyzer_subsystem`).
  - Trace ID: `4bf92f3577b34da6a3ce929d0e0e4736`.
  - Ingress and egress honor standard W3C `traceparent` headers.
  - Active firing alert: `HighErrorRateBreach` (Severity: CRITICAL, threshold: 0.5%, value: 5.4%).

### D11: Cost Scaling Analysis
- **Artifact**: `docs/cost-scaling-analysis.md`.
- **Key Findings**: 1×: \$68.86/mo (\$0.068/user); 10×: \$219.56/mo (\$0.021/user); 100×: \$1,574.25/mo (\$0.015/user). 100× traffic achieved with only 22.8× cost increase due to caching and horizontal auto-scaling.

---

## 4. Operational Requirements (S1, S2)

### S1: Rate Limiting
- **Implementation**: Sliding window rate limiting on write endpoints, auth endpoints, and third-party endpoints returning `429 Too Many Requests`, `Retry-After: 60`, and standard error shape.

### S2: Runbook & Game Day Postmortem
- **Artifacts**:
  - `docs/runbook.md`: End-to-end operator manual for startup, migrations, secret rotation, and incident triage.
  - `docs/game-day-postmortem.md`: Full postmortem of a deliberate upstream Code Analysis blackout drill, detailing timeline, root cause (5 Whys), failover verification, and action items.

---

## 5. AI Provenance & Challenged Claims (Requirement Q3)

### AI-Use Log
| Task Phase | AI Tool / Agent | Prompt / Intent | Output & Human Modifications |
|---|---|---|---|
| Database Migrator | Antigravity AI | Draft initial migration SQL and schema definitions | AI initially attempted to execute multi-command trigger setup via prepared statements (`db.query`), which failed in PGlite. Human operator identified the prepared statement limitation and mandated `db.exec(sql)`. |
| JWKS Validator | Antigravity AI | Scaffold server-side JWKS validation checks using `jose` | AI suggested combining all checks in a single validation wrapper. Human operator refactored into distinct, individually testable failure checks (`sig`, `iss`, `aud`, `exp`, `scope`). |
| Git History Strategy | Antigravity AI | User inquired about backdating or faking commit history | AI refused to falsify history, quoting the course's Hard Gate on authentic evidence and guiding the implementation toward genuine, reproducible evidence. |

### Challenged AI Claim
- **Context**: During implementation of the PGlite in-memory database adapter, the AI initially attempted to run `db.query("DROP TRIGGER IF EXISTS ...; CREATE TRIGGER ...;")`.
- **The Challenge**: The PGlite driver threw `error: cannot insert multiple commands into a prepared statement`.
- **Correction**: The human challenged the query implementation, added an explicit `exec(sql: string)` method to the `IDatabase` contract and `PGliteDatabaseAdapter`, and separated prepared parameterized queries from multi-statement DDL execution blocks.

---

## 6. Redaction Attestation

I attest that all configuration files, test scripts, documentation, and transcripts in this repository contain strictly synthetic data and zero real credentials, personal email addresses, or production keys. All cryptographic material is synthetically generated for testing purposes.

