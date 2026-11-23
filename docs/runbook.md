# StudySync Operations Runbook (Requirement S2)

This runbook provides clear, step-by-step procedures that an operator or on-call engineer can follow to operate, diagnose, scale, and recover StudySync in production.

---

## 1. System Overview & Key Endpoints

| Endpoint | Method | Purpose | Authentication |
|---|---|---|---|
| `/healthz` | GET | Comprehensive readiness/liveness check | Public (unauthenticated) |
| `/metrics` | GET | Prometheus scrape endpoint (SLIs, requests, latencies) | Public / internal monitor |
| `/api/v1/observability/summary` | GET | Real-time SLIs, SLO status, and firing alerts | Public / internal monitor |
| `/api/v1/events/stream` | GET | Real-time Server-Sent Events (SSE) stream | Public / Session |
| `/api/v1/mcp` | POST | MCP JSON-RPC 2.0 tool execution endpoint | Bearer token with scopes |
| `/api/v1/auth/login` | GET | OIDC PKCE Authorization Code initiation | Public |
| `/api/v1/assignments/:id/grade` | POST | Instructor grade submission (audited) | Bearer token (instructor role) |

---

## 2. Deployment & Startup Procedure

### 2.1 Clean-Clone Provisioning
1. Clone the repository:
   ```bash
   git clone https://github.com/synthetic/CSC436_Final.git
   cd CSC436_Final
   ```
2. Verify environment configuration:
   ```bash
   cp .env.example .env
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Run unified verification test suite:
   ```bash
   npm run test
   ```
5. Launch containerized stack with Docker Compose:
   ```bash
   docker compose up --build -d
   ```
6. Verify `/healthz` returns `HTTP 200` with `status: "ok"`:
   ```bash
   curl -i http://localhost:4000/healthz
   ```

---

## 3. Database Operations & Schema Migrations (Requirements F4, F5)

StudySync uses versioned forward and reversible backward migrations managed by the built-in migrator.

### 3.1 Check Migration Status
```bash
npm --workspace=backend run test:storage
```

### 3.2 Executing Forward Migrations (Up)
Forward migrations apply automatically on application startup. To trigger manually:
```bash
npx --workspace=backend tsx -e "import { migrator } from './src/db/migrator.js'; migrator.migrateUp().then(console.log);"
```

### 3.3 Reversible Migration Rollback (Down)
To revert the most recently applied migration (e.g. `002_reversible_rubric_weights`):
```bash
npx --workspace=backend tsx -e "import { migrator } from './src/db/migrator.js'; migrator.rollbackLatest().then(console.log);"
```

### 3.4 Validating Relational Foreign Keys & Audit Immutability
To verify that database-level trigger `trg_audit_trail_immutable` is rejecting unauthorized tampering:
```bash
# Attempt to tamper with an audit trail entry (must fail with SQL exception)
npx --workspace=backend tsx -e "import { getDb } from './src/db/connection.js'; getDb().query('DELETE FROM audit_trail').catch(err => console.log('Expected immutability rejection:', err.message));"
```

---

## 4. Secret & Credential Rotation Procedures

### 4.1 OIDC JWKS Private Key Rotation
1. Generate a new RSA 2048-bit key pair with a new key ID (`kid`, e.g. `studysync-key-2026-v2`).
2. Add the new public key to the remote JWKS endpoint alongside the existing key so existing issued tokens remain valid during the rotation window.
3. Update `serverKeyStore` in `backend/src/auth/jwksValidator.ts` to sign newly issued tokens with the new private key.
4. After 24 hours (all old tokens expired per 1h TTL), decommission the old public key from the JWKS endpoint.

### 4.2 Third-Party Code Analysis API Key Rotation
1. Update `CODE_ANALYSIS_API_KEY` in the production secret store (e.g. AWS Secrets Manager or HashiCorp Vault).
2. Trigger zero-downtime rolling reload:
   ```bash
   docker compose restart backend
   ```
3. Verify external integration health:
   ```bash
   curl -i http://localhost:4000/api/v1/analysis/status
   ```

---

## 5. Incident Response Procedures

### 5.1 Incident: High Error Rate Alert Firing (`HighErrorRateBreach`)
- **Symptoms**: Alert `HighErrorRateBreach` status is `firing` on `/api/v1/observability/summary`, and `/metrics` shows `studysync_availability_percent < 99.5`.
- **Diagnostic Steps**:
  1. Inspect recent OpenTelemetry structured logs:
     ```bash
     docker logs --tail 100 studysync-backend | grep '"level":"ERROR"'
     ```
  2. Filter logs by `traceId` to identify failing call stacks:
     ```bash
     docker logs studysync-backend | grep '<TRACE_ID>'
     ```
  3. Inspect `/healthz` to determine if the datastore is reachable:
     ```bash
     curl -s http://localhost:4000/healthz | jq .
     ```
- **Remediation**:
  - If database latency is elevated or disconnected, verify host disk space and Postgres connectivity.
  - If a recent deployment introduced regressions, execute automated rollback:
    ```bash
    docker compose down && docker run -d -p 4000:4000 studysync-backend:<LAST_KNOWN_GOOD_SHA>
    ```

### 5.2 Incident: Third-Party Code Analysis API Outage
- **Symptoms**: Third-party API calls timing out or returning 5xx; `X-StudySync-Degraded: true` header observed on responses.
- **Diagnostic Steps**:
  1. Check analysis telemetry endpoint:
     ```bash
     curl -i http://localhost:4000/api/v1/analysis/status
     ```
  2. Confirm fallback degradation mode is active (`isDegraded: true`).
- **Remediation**:
  - StudySync automatically activates graceful degradation fallback: submissions are accepted and queued, synthetic heuristic scores are returned, and retry storms are bounded by exponential backoff (max 3 retries).
  - No manual service restart is required. When upstream recovers, the circuit breaker automatically resumes live analysis calls.

