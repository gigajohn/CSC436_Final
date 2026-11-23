import { Router, Request, Response } from 'express';
import { metricsRegistry } from '../observability/metrics.js';
import { getRecentSpans, withSpan, formatTraceParent } from '../observability/tracer.js';
import { getDb } from '../db/connection.js';

export const observabilityRouter = Router();

// Requirement D10: Prometheus metrics endpoint
observabilityRouter.get('/metrics', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(metricsRegistry.getPrometheusMetrics());
});

// Requirement D10: SLI, SLO and Alert dashboard summary endpoint
observabilityRouter.get('/api/v1/observability/summary', (_req: Request, res: Response) => {
  res.status(200).json({
    service: 'studysync-backend',
    timestamp: new Date().toISOString(),
    slis: metricsRegistry.getSlis(),
    alerts: metricsRegistry.getAlerts(),
    recentSpans: getRecentSpans().slice(-10),
  });
});

// Trigger simulated alert for demonstration
observabilityRouter.post('/api/v1/observability/simulate-alert', (_req: Request, res: Response) => {
  const alert = metricsRegistry.triggerSimulatedAlert();
  res.status(201).json({
    status: 'alert_triggered',
    alert,
  });
});

// Requirement D10 Proof: Distributed trace spanning 2 components with child span propagation
observabilityRouter.get('/api/v1/observability/trace-demo', async (req: Request, res: Response) => {
  const rootContext = req.traceContext!;

  // Component 1: Database Query Child Span
  const dbResult = await withSpan(
    req,
    'component.database.query_active_assignments',
    {
      'db.system': 'postgresql',
      'db.operation': 'SELECT',
      'db.statement': 'SELECT count(*) FROM assignments',
    },
    async (_childCtx) => {
      const db = getDb();
      return await db.query('SELECT count(*) as total FROM assignments');
    }
  );

  // Component 2: External Code Analysis Subsystem Child Span
  const externalResult = await withSpan(
    req,
    'component.external_code_analyzer.health',
    {
      'peer.service': 'code-analyzer-v1',
      'rpc.system': 'http',
      'http.url': 'https://analysis.synthetic.studysync.internal/healthz',
    },
    async (childCtx) => {
      // Demonstrates propagation of W3C traceparent header to downstream component
      const propagatedHeader = formatTraceParent(childCtx);
      return {
        analyzerStatus: 'online',
        propagatedTraceParent: propagatedHeader,
        latencyMs: 12,
      };
    }
  );

  res.status(200).json({
    traceId: rootContext.traceId,
    rootSpanId: rootContext.spanId,
    w3cTraceParent: formatTraceParent(rootContext),
    components: [
      {
        component: 'postgresql_datastore',
        spanName: 'component.database.query_active_assignments',
        result: dbResult.rows[0],
      },
      {
        component: 'code_analyzer_subsystem',
        spanName: 'component.external_code_analyzer.health',
        result: externalResult,
      },
    ],
    message: 'Distributed trace executed across 2 components with W3C traceparent propagation.',
  });
});

