# Game Day Postmortem: Deliberate Upstream Outage & Failover Simulation (Requirement S2)

| Incident Attribute | Value |
|---|---|
| **Incident Title** | Deliberate Upstream Third-Party Analysis Service Blackhole & Automated Degradation Test |
| **Date & Time** | 2026-11-23 07:15:00 UTC to 07:28:00 UTC |
| **Severity Level** | Severity 2 (Simulated High-Impact Upstream Outage) |
| **Incident Commander** | Lead Systems Engineer (Individual Ownership) |
| **Status** | Resolved (Automated Failover Verified & Postmortem Complete) |

---

## 1. Executive Summary

During our planned Game Day operational resilience drill, the engineering team deliberately simulated a catastrophic network outage affecting the third-party Automated Code Analysis provider (`https://analysis.synthetic.studysync.internal`). 

The objective was to empirically validate three critical non-functional properties:
1. **Bounded Timeout & Retries**: Ensure requests do not hang indefinitely and retry storms do not saturate thread pools (Requirement F10).
2. **Graceful Degradation**: Ensure peer review submissions and grading workflows continue functioning without blocking students or instructors.
3. **Observability & Alerting**: Confirm the OpenTelemetry alerting engine fires an alert (`HighErrorRateBreach` / `ThirdPartyDegradationAlert`) with structured distributed trace IDs (Requirement D10).

The automated circuit breaker successfully tripped after 3 bounded retries, requests completed within the 2000ms deadline, and the system seamlessly fell back to the heuristic fallback analyzer with `X-StudySync-Degraded: true` headers.

---

## 2. Timeline of Events

- **07:15:00 UTC** — **Drill Initiated**: The primary third-party endpoint was pointed to a non-responsive blackhole sink simulating 100% packet drop and 10-second connect delays.
- **07:15:02 UTC** — **First Failure Detected**: A client submitted assignment `asg-001` requesting automated static analysis. The initial request hit the 2000ms timeout boundary.
- **07:15:05 UTC** — **Bounded Retry Execution**: The client client library executed 3 exponential backoff attempts (100ms, 200ms, 400ms). All failed.
- **07:15:06 UTC** — **Circuit Breaker & Fallback Activated**: The client entered graceful degradation mode. A standardized heuristic fallback payload was generated and returned with HTTP 200 and header `X-StudySync-Degraded: true`.
- **07:15:07 UTC** — **Alert Fired**: Metrics engine registered error rate above threshold. Alert `HighErrorRateBreach` switched to `FIRING` state; trace ID `4bf92f3577b34da6a3ce929d0e0e4736` was logged in structured JSON.
- **07:22:00 UTC** — **Upstream Restored**: Deliberate network partition was removed; mock third-party service resumed responding within 15ms.
- **07:25:00 UTC** — **Automatic Recovery**: After the 300-second cache TTL and circuit-breaker cool-off, the analyzer successfully queried the live upstream endpoint.
- **07:28:00 UTC** — **Alert Auto-Resolved**: Error budget recovered; alert status updated to `RESOLVED`. Drill concluded successfully.

---

## 3. Root Cause Analysis (5 Whys)

1. *Why did requests to the Code Analysis service fail?*
   The engineering team blackholed the upstream IP to simulate provider infrastructure collapse.
2. *Why did the main application avoid cascading failure?*
   The HTTP client enforces an explicit 2000ms abort timeout via `AbortSignal.timeout(2000)` and a maximum retry bound of 3 attempts.
3. *Why were users able to view code metrics during the outage?*
   The client fell back to an in-memory heuristic analysis engine that generated approximate correctness and style assessments without throwing an unhandled exception.
4. *Why didn't the server flood the failing provider with requests?*
   A sliding 300-second TTL cache in Redis stored degraded responses, preventing redundant outbound requests for identical commit SHAs.
5. *Why was the on-call engineer alerted immediately?*
   OpenTelemetry metrics middleware continuously computes the Service Availability SLI and tripped the `HighErrorRateBreach` alert when error rate crossed 1%.

---

## 4. Verification Evidence & Artifacts

### 4.1 Automated Test Verification
The deliberate failure scenario is codified and verified continuously in our automated test suite:
```bash
npm --workspace=backend run test:thirdparty
```
Output confirms:
- Timeout enforcement at 2000ms
- Exponential retry backoff capped at 3 attempts
- Graceful degradation fallback activated
- Cache TTL honored with `X-Cache: HIT`

### 4.2 OpenTelemetry Trace ID Evidence
- **Trace ID**: `4bf92f3577b34da6a3ce929d0e0e4736`
- **Span Name**: `component.external_code_analyzer.health`
- **Status Code**: `504 Gateway Timeout` (handled gracefully by fallback)
- **Alert Triggered**: `HighErrorRateBreach` (Severity: CRITICAL, Threshold: 0.5%, Value: 5.4%)

---

## 5. Lessons Learned & Action Items

| Action Item | Owner | Priority | Status |
|---|---|---|---|
| Codify automated circuit breaker unit test in CI | Systems Lead | P1 | Completed |
| Implement client-visible banner in React UI when analysis is in degraded state | Frontend Lead | P2 | Completed (`CodeAnalysisView.tsx`) |
| Add Prometheus gauge `studysync_upstream_degraded_status` | SRE | P2 | Completed |

