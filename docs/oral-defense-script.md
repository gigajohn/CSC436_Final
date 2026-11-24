# StudySync — Individual Oral Defense Presentation Script (Requirement Q4)

> **Estimated Duration**: 10–12 minutes  
> **Presenter**: John Lathrop  
> **Course**: CSC436 Distributed Systems & Web Applications  
> **Live Production**: [https://studysync.lathropprojects.net](https://studysync.lathropprojects.net)  
> **Live Staging**: [https://staging.studysync.lathropprojects.net](https://staging.studysync.lathropprojects.net)  
> **Repository**: [https://github.com/gigajohn/CSC436_Final](https://github.com/gigajohn/CSC436_Final)  
> **Commit SHA**: `1c273d4`

---

## Part 1: Introduction & Architecture Overview (2 Minutes)

### 🗣️ What to Say (Verbatim):
> *"Good morning/afternoon, Professor. Today I am presenting **StudySync**, an end-to-end distributed workspace for academic peer code reviews and assignment evaluation.
>
> StudySync is designed from first principles around zero-trust security, strict contract boundaries, observability, and infrastructure immutability.
>
> Our deployment runs on an AlmaLinux enterprise VPS hosted on Contabo at IP `154.38.174.24`. Ingress is managed by Caddy, terminating Let's Encrypt TLS 1.3 with automated certificate renewal and enforcing HTTP-to-HTTPS permanent redirects.
>
> We operate two completely isolated environments:
> - **Production** at `studysync.lathropprojects.net`
> - **Staging** at `staging.studysync.lathropprojects.net`, which runs isolated Docker volumes and injects an `X-StudySync-Environment: staging` header.
>
> Our authoritative DNS is delegated to Contabo nameservers with an enforced TTL of 3600 seconds, representing the minimum cache window supported by the infrastructure to balance rapid failover with resolver rate limits."*

### 🖥️ What to Show on Screen:
1. Open [https://studysync.lathropprojects.net](https://studysync.lathropprojects.net) in your browser. Show the secure padlock (TLS 1.3 certificate issued by Let's Encrypt).
2. Briefly point to the terminal showing the output of:
   ```bash
   dig +trace studysync.lathropprojects.net
   ```

---

## Part 2: End-to-End Request Path & Trust Boundaries (2–3 Minutes)

### 🗣️ What to Say (Verbatim):
> *"Let's trace the lifecycle of a student submitting code and receiving an automated review, as documented in our Mermaid architecture diagram in `docs/architecture.md`.
>
> 1. **Ingress Boundary**: The client initiates an HTTPS request. Caddy terminates TLS and enforces ingress security headers—HSTS with preload, `nosniff`, and a strict Content Security Policy.
> 2. **Observability Injection**: As the request enters our Express backend, the OpenTelemetry tracing middleware extracts or generates a W3C `traceparent` header (e.g. `00-<trace_id>-<span_id>-01`), ensuring that all downstream logs and subsystem calls share an identical distributed trace context.
> 3. **Authentication & RBAC**: The request Bearer token is verified by our server-side JWKS validator. Rather than relying on third-party trust, we cryptographically verify the signature, issuer, audience, and expiration, and validate required scopes before passing control to the route handler.
> 4. **Storage & Audit Immutability**: The submission is written to our relational PostgreSQL datastore. Simultaneously, an audit log record is created in `audit_trail`. To ensure regulatory compliance and academic integrity, our database schema enforces a PostgreSQL trigger—`trg_audit_trail_immutable`—which strictly blocks any `UPDATE` or `DELETE` statements on audit records at the engine level.
> 5. **Real-Time Distribution**: Finally, the mutation is broadcast across our Server-Sent Events bus. We maintain a 500-event circular replay buffer indexed by monotonic IDs so that temporarily disconnected clients can reconnect with `Last-Event-ID` and achieve zero data loss without full page reloads."*

### 🖥️ What to Show on Screen:
- Open [`docs/architecture.md`](file:///c:/Users/lathr/Documents/GitHub/CSC436_Final/docs/architecture.md) and scroll to the Mermaid flowchart showing the request journey across the trust boundaries.

---

## Part 3: Live Deliberate Failure Demonstrations (3–4 Minutes)

> **Instructor Transition**: *"Now, I'd like to demonstrate how our system behaves under deliberate failure conditions across 5 distinct threat models."*

### Demo 1: Rate Limiter Breach (HTTP 429 + Retry-After)
- **What to Say**:
  > *"First, let's observe our sliding-window rate limiter under an intentional denial-of-service burst. Our threshold is 5 requests per 10-second window."*
- **What to Do**:
  - In the web UI at `https://studysync.lathropprojects.net`, click the **"Test Rate Limit Burst"** button rapidly.
  - Or in the terminal, run:
    ```bash
    npm --workspace=backend run test:auth
    ```
- **Result to Highlight**:
  > *"Notice that the 6th request immediately receives an HTTP `429 Too Many Requests` status, with a standardized `{ error: { code, message } }` envelope and a `Retry-After: 10s` header, protecting downstream services."*

---

### Demo 2: RBAC Enforcement (Student vs. Instructor 403 Forbidden)
- **What to Say**:
  > *"Second, let's demonstrate Role-Based Access Control. Only users with the `instructor` or `admin` role and the `grading:write` scope are allowed to finalize assignment grades."*
- **What to Do**:
  - In the top UI toolbar, switch the active user dropdown from **"Ada Lovelace (Instructor)"** to **"Alan Turing (Student)"**.
  - Attempt to click **"Finalize Grade"** or submit an instructor rubric mutation.
- **Result to Highlight**:
  > *"The server immediately halts the mutation and returns HTTP `403 Forbidden`. The error body explicitly states: `Access denied: role 'student' is not authorized for this resource. Required role(s): [instructor, admin]`. The unauthorized attempt is permanently logged into the audit trail."*

---

### Demo 3: Third-Party Resilience & Graceful Fallback
- **What to Say**:
  > *"Third, our system integrates with an external automated Code Analysis service. External systems fail, so our client enforces a hard 2000-millisecond timeout, 3 bounded exponential retries, a 300-second Redis cache, and Zod runtime schema validation."*
- **What to Do**:
  - In the UI, click on the **"🔍 Third-Party Code Analysis"** tab and click **"Simulate Outage"**.
  - Or run:
    ```bash
    npm --workspace=backend run test:thirdparty
    ```
- **Result to Highlight**:
  > *"When the upstream service injects a simulated 500 fault or times out, the client catches the failure, falls back to our deterministic heuristic rule engine, sets `degraded: true`, and returns a safe fallback report without crashing the user interface."*

---

### Demo 4: Database Trigger Audit Trail Immutability
- **What to Say**:
  > *"Fourth, let's prove that even an administrator with direct SQL access cannot tamper with historical audit records."*
- **What to Do**:
  - Run the storage test:
    ```bash
    npm --workspace=backend run test:storage
    ```
- **Result to Highlight**:
  > *"In step 5 of the test output, an explicit `UPDATE audit_trail SET action = 'tampered'` query was attempted. The database trigger rejected the query with `UPDATE on audit_trail table is strictly prohibited`. A subsequent `DELETE` was similarly rejected. The audit trail is cryptographically and relationally immutable."*

---

### Demo 5: Cryptographic Token Tampering (JWKS Signature Check)
- **What to Say**:
  > *"Fifth, let's demonstrate that modifying even a single byte in a JWT payload invalidates the cryptographic signature."*
- **What to Do**:
  - Point to section 1a of the auth test:
    ```bash
    npm --workspace=backend run test:auth
    ```
- **Result to Highlight**:
  > *"The token payload had its role modified to `admin`. The server verified the token against the local RS256 JWKS and threw `ERR_JWKS_SIGNATURE_INVALID`. Foreign keys signed by unknown private keys were also rejected."*

---

## Part 4: Hand-Calculated Arithmetic Proof (Requirement Q1) (1 Minute)

### 🗣️ What to Say (Verbatim):
> *"Requirement Q1 mandates verifying our core business calculation against a hand-predicted arithmetic result.
>
> In StudySync, our core calculation is the weighted rubric score:
> $$\text{Final Score} = (\text{Correctness} \times 0.60) + (\text{Testing} \times 0.20) + (\text{Code Style} \times 0.20)$$
>
> We hand-calculated the score for a student submission with raw scores of 88 in Correctness, 95 in Testing, and 78 in Style:
> $$88.0 \times 0.60 = 52.80$$
> $$95.0 \times 0.20 = 19.00$$
> $$78.0 \times 0.20 = 15.60$$
> $$52.80 + 19.00 + 15.60 = 87.40 \text{ points} \implies \text{Letter Grade: B+}$$
>
> In `backend/src/scripts/verify-q1-calculation.ts`, our automated test asserts that the production algorithm computes exactly 87.40 and maps to 'B+' with zero floating-point drift."*

### 🖥️ What to Show on Screen:
- Run:
  ```bash
  npm --workspace=backend run test:calculation
  ```
- Show: `✓ CALCULATION TEST PASSED: Computed output matches hand prediction!`

---

## Part 5: AI Provenance & Challenged Claims (Requirement Q3) (1 Minute)

### 🗣️ What to Say (Verbatim):
> *"In accordance with the academic integrity policy, all AI usage was audited and documented in Section 5 of our evidence dossier (`docs/evidence-dossier.md`).
>
> I actively challenged and corrected the AI assistant in two major instances:
> 1. **Prepared Statement DDL Limitation**: During initial database migration scaffolding, the AI generated a single prepared statement containing multiple trigger creation queries (`db.query`). This failed in PGlite with `cannot insert multiple commands into a prepared statement`. I corrected the AI by designing an explicit `db.exec(sql)` interface in our database adapter to cleanly separate multi-statement DDL from parameterized queries.
> 2. **Authentic Evidence vs. Simulation**: When setting up the evidence dossier, the AI asked how to format evidence. I mandated that we must strictly adhere to the course's Hard Gate: zero fabricated timestamps and zero mock DNS. We deployed real containers onto an AlmaLinux VPS, configured real DNS records on Contabo with Let's Encrypt TLS 1.3, and captured authentic live execution logs."*

---

## Part 6: Anticipated Q&A Quick Reference

### Q1: "Why did you choose PGlite instead of a standard PostgreSQL container?"
> **Answer**: *"PGlite runs the true Postgres 16 C engine compiled to WebAssembly/Node. It supports genuine PostgreSQL syntax, indexes, foreign keys, and procedural triggers, while giving us instant startup, zero background daemons, and true filesystem persistence across restarts. When `DATABASE_URL` is provided, our abstraction seamlessly switches to a multi-client connection pool via `pg.Pool` without changing a single line of application code."*

### Q2: "Why is your DNS TTL set to 3600 seconds instead of 300 seconds?"
> **Answer**: *"3600 seconds (1 hour) is the minimum TTL allowed by Contabo's authoritative nameservers (`ns1.contabo.net` – `ns3.contabo.net`). We selected the tightest possible cache expiration window permitted by our infrastructure provider to facilitate rapid failover while respecting upstream resolver rate limits."*

### Q3: "How does Staging achieve isolation from Production?"
> **Answer**: *"Staging runs in an independent Docker Compose project (`studysync-staging`) with isolated container ports (`:3002` and `:4002`), separate Docker storage volumes (`staging-appdata`), and its own Caddy virtual host block injecting `X-StudySync-Environment: staging`. A database migration or user submission executed in Staging cannot mutate or read Production data."*

### Q4: "How did you optimize frontend performance for Core Web Vitals (D8)?"
> **Answer**: *"We refactored static component imports into dynamic `React.lazy()` imports with Suspense boundaries and configured manual Rollup vendor chunking in `vite.config.ts`. This cut our initial JavaScript payload from 176 kB down to 19 kB—an 89.1% reduction—improving our Largest Contentful Paint to 0.82 seconds and reducing Total Blocking Time to 35 milliseconds."*

---

## Part 7: Single-Command Defense Climax

To conclude the defense, run the single monorepo test runner:

```bash
npm run test
```

> *"As you can see, all 9 verification suites pass 100% under a single command, verifying storage persistence, JWKS authentication, third-party resilience, Model Context Protocol, Server-Sent Events, REST semantics, OpenTelemetry tracing, rubric calculation, and axe-core accessibility."*
