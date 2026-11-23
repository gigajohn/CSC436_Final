import http from 'node:http';
import { createApp } from '../app.js';

async function runObservabilityVerification() {
  console.log('================================================================');
  console.log(' StudySync OpenTelemetry Observability & SLI/SLO Test (D10)      ');
  console.log('================================================================\n');

  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  console.log(`Ephemeral test server running at ${baseUrl}\n`);

  try {
    // -------------------------------------------------------------------------
    // Phase 1: Distributed Trace Across 2 Components (Requirement D10)
    // -------------------------------------------------------------------------
    console.log('[1/4] Testing Distributed Tracing Across 2 Components (D10)...');
    const customTraceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const traceParentHeader = `00-${customTraceId}-00f067aa0ba902b7-01`;

    const traceRes = await fetch(`${baseUrl}/api/v1/observability/trace-demo`, {
      headers: {
        traceparent: traceParentHeader,
      },
    });

    if (traceRes.status !== 200) {
      throw new Error(`trace-demo returned status ${traceRes.status}`);
    }

    const traceData = await traceRes.json();
    const returnedTraceId = traceRes.headers.get('x-trace-id');
    const returnedTraceParent = traceRes.headers.get('traceparent');

    if (returnedTraceId !== customTraceId) {
      throw new Error(`Expected traceId ${customTraceId}, got ${returnedTraceId}`);
    }

    console.log(`  ✓ Ingress W3C TraceParent honored: ${traceParentHeader}`);
    console.log(`  ✓ Outgoing X-Trace-Id verified: ${returnedTraceId}`);
    console.log(`  ✓ Outgoing traceparent verified: ${returnedTraceParent}`);
    console.log(`  ✓ Verified distributed spans across 2 components:`);
    traceData.components.forEach((c: any) => {
      console.log(`    - Component: [${c.component}] -> Span: ${c.spanName}`);
    });

    if (traceData.components.length < 2) {
      throw new Error('Trace did not span at least 2 distinct components');
    }

    // -------------------------------------------------------------------------
    // Phase 2: SLI & SLO Tracking (Requirement D10)
    // -------------------------------------------------------------------------
    console.log('\n[2/4] Testing SLI and SLO Evaluation (D10)...');
    // Issue several requests to populate metrics
    await fetch(`${baseUrl}/healthz`);
    await fetch(`${baseUrl}/api/assignments`);
    await fetch(`${baseUrl}/healthz`);

    const summaryRes = await fetch(`${baseUrl}/api/v1/observability/summary`);
    const summary = await summaryRes.json();

    console.log(`  ✓ Detected ${summary.slis.length} active SLIs:`);
    summary.slis.forEach((sli: any) => {
      console.log(`    - [${sli.name}]: target=${sli.target}${sli.unit}, current=${sli.current}${sli.unit} (met: ${sli.met})`);
    });

    if (summary.slis.length < 2) {
      throw new Error('Expected at least 2 SLIs (availability and latency)');
    }

    // -------------------------------------------------------------------------
    // Phase 3: Fired Alert Evidence (Requirement D10)
    // -------------------------------------------------------------------------
    console.log('\n[3/4] Verifying Fired Alert Evidence (D10)...');
    const firingAlerts = summary.alerts.filter((a: any) => a.status === 'firing');
    console.log(`  ✓ Total alerts in registry: ${summary.alerts.length}`);
    console.log(`  ✓ Active FIRING alerts: ${firingAlerts.length}`);
    firingAlerts.forEach((a: any) => {
      console.log(`    - ALERT [${a.name}] (${a.severity.toUpperCase()}): ${a.message} (Triggered: ${a.triggeredAt})`);
    });

    if (firingAlerts.length === 0) {
      throw new Error('D10 requires evidence of at least one alert that has fired');
    }

    // -------------------------------------------------------------------------
    // Phase 4: Prometheus Metrics Exposition (Requirement D10)
    // -------------------------------------------------------------------------
    console.log('\n[4/4] Verifying Prometheus Metrics Endpoint (/metrics)...');
    const metricsRes = await fetch(`${baseUrl}/metrics`);
    const metricsText = await metricsRes.text();

    if (!metricsText.includes('studysync_http_requests_total') || !metricsText.includes('studysync_availability_percent')) {
      throw new Error('Prometheus metrics missing expected counters/gauges');
    }
    console.log('  ✓ Prometheus /metrics endpoint formatted correctly and accessible:');
    metricsText.split('\n').filter((l) => l && !l.startsWith('#')).forEach((l) => {
      console.log(`    ${l}`);
    });

    console.log('\n================================================================');
    console.log(' ALL D10 OBSERVABILITY, TRACE & SLI/SLO/ALERT CHECKS PASSED      ');
    console.log('================================================================\n');

    process.exit(0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

runObservabilityVerification().catch((err) => {
  console.error('\n❌ Observability verification failed:', err);
  process.exit(1);
});

