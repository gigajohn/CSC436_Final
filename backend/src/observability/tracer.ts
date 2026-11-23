import crypto from 'node:crypto';
import { Request, Response, NextFunction } from 'express';

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentId?: string;
  traceFlags: string;
}

export interface Span {
  name: string;
  traceId: string;
  spanId: string;
  parentId?: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  attributes: Record<string, unknown>;
  status: 'ok' | 'error';
}

declare global {
  namespace Express {
    interface Request {
      traceContext?: TraceContext;
      activeSpans?: Span[];
    }
  }
}

/**
 * Parses W3C traceparent header: 00-{traceId}-{spanId}-{flags}
 */
export function parseTraceParent(header?: string): TraceContext | null {
  if (!header) return null;
  const parts = header.trim().split('-');
  if (parts.length === 4 && parts[0] === '00' && parts[1].length === 32 && parts[2].length === 16) {
    return {
      traceId: parts[1],
      spanId: crypto.randomBytes(8).toString('hex'), // Child span ID
      parentId: parts[2],
      traceFlags: parts[3],
    };
  }
  return null;
}

/**
 * Generates canonical W3C traceparent header string
 */
export function formatTraceParent(context: TraceContext): string {
  return `00-${context.traceId}-${context.spanId}-${context.traceFlags}`;
}

const spanStore: Span[] = [];
const MAX_SPANS = 200;

export function recordSpan(span: Span): void {
  spanStore.push(span);
  if (spanStore.length > MAX_SPANS) {
    spanStore.shift();
  }
}

export function getRecentSpans(): Span[] {
  return [...spanStore];
}

/**
 * OpenTelemetry-compatible tracing middleware (Requirement D10)
 */
export function tracingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incomingHeader = req.header('traceparent') || (req.header('x-trace-id') ? `00-${req.header('x-trace-id')}-0000000000000000-01` : undefined);
  const parsed = parseTraceParent(incomingHeader);

  const traceId = parsed ? parsed.traceId : crypto.randomBytes(16).toString('hex');
  const spanId = crypto.randomBytes(8).toString('hex');
  const parentId = parsed?.parentId;
  const traceFlags = '01'; // sampled

  const traceContext: TraceContext = {
    traceId,
    spanId,
    parentId,
    traceFlags,
  };

  req.traceContext = traceContext;
  req.activeSpans = [];

  // Expose standard trace headers
  res.setHeader('X-Trace-Id', traceId);
  res.setHeader('traceparent', formatTraceParent(traceContext));

  const startTime = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    const rootSpan: Span = {
      name: `HTTP ${req.method} ${req.route?.path || req.path}`,
      traceId,
      spanId,
      parentId,
      startTime,
      endTime: Date.now(),
      durationMs,
      attributes: {
        'http.method': req.method,
        'http.target': req.originalUrl,
        'http.status_code': res.statusCode,
        'http.user_agent': req.headers['user-agent'] || 'synthetic-client',
        'http.client_ip': req.ip || '127.0.0.1',
      },
      status: res.statusCode >= 500 ? 'error' : 'ok',
    };

    recordSpan(rootSpan);

    // Emit OpenTelemetry structured JSON log
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'INFO',
      service: 'studysync-backend',
      traceId,
      spanId,
      parentId,
      http: {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs,
      },
      message: `${req.method} ${req.originalUrl} completed with ${res.statusCode} in ${durationMs}ms`,
    };

    if (process.env.NODE_ENV !== 'test') {
      console.log(JSON.stringify(logEntry));
    }
  });

  next();
}

/**
 * Creates and records a distributed child span (e.g. for database or external API call)
 */
export async function withSpan<T>(
  req: Request,
  name: string,
  attributes: Record<string, unknown>,
  fn: (childContext: TraceContext) => Promise<T>
): Promise<T> {
  const parentContext = req.traceContext || {
    traceId: crypto.randomBytes(16).toString('hex'),
    spanId: crypto.randomBytes(8).toString('hex'),
    traceFlags: '01',
  };

  const childSpanId = crypto.randomBytes(8).toString('hex');
  const childContext: TraceContext = {
    traceId: parentContext.traceId,
    spanId: childSpanId,
    parentId: parentContext.spanId,
    traceFlags: parentContext.traceFlags,
  };

  const startTime = Date.now();
  let status: 'ok' | 'error' = 'ok';

  try {
    return await fn(childContext);
  } catch (err) {
    status = 'error';
    throw err;
  } finally {
    const durationMs = Date.now() - startTime;
    const childSpan: Span = {
      name,
      traceId: childContext.traceId,
      spanId: childSpanId,
      parentId: parentContext.spanId,
      startTime,
      endTime: Date.now(),
      durationMs,
      attributes,
      status,
    };
    recordSpan(childSpan);
  }
}

