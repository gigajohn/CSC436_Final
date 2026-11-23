import { Router, Request, Response, NextFunction } from 'express';
import { codeAnalysisClient } from '../integrations/codeAnalysisClient.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';

export const analysisRouter = Router();

// Rate limiter for third-party-backed endpoints (Requirement S1: 10 reqs per 10s)
const thirdPartyRateLimiter = createRateLimiter({
  windowMs: 10000,
  maxRequests: 10,
  keyPrefix: 'thirdparty',
});

analysisRouter.use(thirdPartyRateLimiter);

// Endpoint: GET /api/v1/analysis/:commitSha
analysisRouter.get('/:commitSha', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const commitSha = req.params.commitSha;
    const repositoryUrl =
      typeof req.query.repositoryUrl === 'string'
        ? req.query.repositoryUrl
        : 'https://github.com/synthetic-student/csc436-impl';

    if (!commitSha || commitSha.length < 4) {
      res.status(400).json({
        error: {
          code: 'INVALID_COMMIT_SHA',
          message: 'A valid commit SHA parameter is required.',
        },
      });
      return;
    }

    const result = await codeAnalysisClient.analyzeCommit(repositoryUrl, commitSha);

    // Set telemetry and caching headers
    res.setHeader('X-Cache', result._cached ? 'HIT' : 'MISS');
    if (result._degraded) {
      res.setHeader('X-StudySync-Degraded', 'true');
    }

    res.status(200).json({
      status: result._degraded ? 'degraded' : 'success',
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

// Cache clear endpoint for testing: POST /api/v1/analysis/cache/clear
analysisRouter.post('/cache/clear', (_req: Request, res: Response) => {
  codeAnalysisClient.clearCache();
  res.status(200).json({ message: 'Analysis cache cleared' });
});

