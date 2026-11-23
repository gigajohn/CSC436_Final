import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { eventsRouter } from './routes/eventsRouter.js';
import { mcpRouter } from './routes/mcpRouter.js';
import { authRouter } from './routes/authRouter.js';
import { instructorRouter } from './routes/instructorRouter.js';
import { analysisRouter } from './routes/analysisRouter.js';
import { observabilityRouter } from './routes/observabilityRouter.js';
import { tracingMiddleware } from './observability/tracer.js';
import { metricsMiddleware } from './observability/metrics.js';
import { checkDatabaseHealth } from './db/connection.js';

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export class AppError extends Error {
  public statusCode: number;
  public code: string;
  public details?: Record<string, unknown>;

  constructor(statusCode: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function createApp() {
  const app = express();

  // Observability & Tracing (Requirement D10)
  app.use(tracingMiddleware);
  app.use(metricsMiddleware);

  // Security and parsing middleware
  app.use(helmet());
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
      credentials: true,
    })
  );
  app.use(express.json());

  // Health check endpoint (Requirement baseline, F4, & D4 gate)
  app.get('/healthz', async (_req: Request, res: Response) => {
    const dbHealth = await checkDatabaseHealth();
    const isHealthy = dbHealth.status === 'connected';

    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? 'ok' : 'degraded',
      service: 'studysync-backend',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: {
        status: dbHealth.status,
        latencyMs: dbHealth.latencyMs,
      },
    });
  });

  // Public assignments baseline route for frontend search/filter demonstration
  app.get('/api/assignments', (req: Request, res: Response) => {
    const search = typeof req.query.search === 'string' ? req.query.search.toLowerCase() : '';
    const status = typeof req.query.status === 'string' ? req.query.status : 'all';

    const assignments = [
      {
        id: 'asg-001',
        title: 'Distributed Key-Value Store',
        course: 'CSC436 Distributed Systems',
        dueDate: '2026-12-05T23:59:59Z',
        status: 'open',
        submissionsCount: 14,
        pendingReviewsCount: 5,
      },
      {
        id: 'asg-002',
        title: 'Raft Consensus Protocol Implementation',
        course: 'CSC436 Distributed Systems',
        dueDate: '2026-12-15T23:59:59Z',
        status: 'upcoming',
        submissionsCount: 0,
        pendingReviewsCount: 0,
      },
      {
        id: 'asg-003',
        title: 'Two-Phase Commit Transaction Manager',
        course: 'CSC436 Distributed Systems',
        dueDate: '2026-11-18T23:59:59Z',
        status: 'closed',
        submissionsCount: 28,
        pendingReviewsCount: 0,
      },
    ];

    const filtered = assignments.filter((item) => {
      const matchesSearch =
        !search ||
        item.title.toLowerCase().includes(search) ||
        item.course.toLowerCase().includes(search);
      const matchesStatus = status === 'all' || item.status === status;
      return matchesSearch && matchesStatus;
    });

    res.status(200).json({
      data: filtered,
      meta: {
        total: filtered.length,
      },
    });
  });

  // Mount Real-Time SSE and Mutation Routes (Requirement F11)
  app.use('/api/v1/events', eventsRouter);
  app.use('/api/v1', eventsRouter);

  // Mount OAuth-Protected MCP Server (Requirement F12)
  app.use('/api/v1/mcp', mcpRouter);

  // Mount OIDC Authentication & PKCE Routes (Requirement F7, F8)
  app.use('/api/v1/auth', authRouter);

  // Mount RBAC-Protected Instructor Routes (Requirement F9)
  app.use('/api/v1/assignments', instructorRouter);

  // Mount Third-Party Code Analysis Routes (Requirement F10)
  app.use('/api/v1/analysis', analysisRouter);

  // Mount Observability & Metrics Routes (Requirement D10)
  app.use('/', observabilityRouter);

  // 404 handler for unmatched routes
  app.use((_req: Request, _res: Response, next: NextFunction) => {
    next(new AppError(404, 'NOT_FOUND', 'Requested resource was not found on this server.'));
  });

  // Centralized JSON error handler
  app.use((err: unknown, _req: Request, res: Response<ApiErrorResponse>, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({
        error: {
          code: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
        },
      });
      return;
    }

    const fallbackMessage = err instanceof Error ? err.message : 'Internal Server Error';
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: fallbackMessage,
      },
    });
  });

  return app;
}

export const app = createApp();

