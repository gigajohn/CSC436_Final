import { Request, Response, NextFunction } from 'express';

interface RateLimitConfig {
  windowMs: number; // e.g. 10000ms = 10s
  maxRequests: number; // e.g. 5 requests
  keyPrefix?: string;
}

interface WindowRecord {
  count: number;
  resetAt: number;
}

/**
 * Rate Limiter backed by memory/Redis sliding window (Requirement S1).
 * Returns standard 429 JSON response shape with Retry-After header.
 */
export function createRateLimiter(config: RateLimitConfig) {
  const store = new Map<string, WindowRecord>();
  const { windowMs, maxRequests, keyPrefix = 'rl' } = config;

  return (req: Request, res: Response, next: NextFunction): void => {
    // Key by authenticated actor ID or IP address
    const clientIdentifier =
      req.user?.sub ||
      (typeof req.headers['x-forwarded-for'] === 'string'
        ? req.headers['x-forwarded-for'].split(',')[0].trim()
        : req.socket.remoteAddress || '127.0.0.1');

    const key = `${keyPrefix}:${clientIdentifier}`;
    const now = Date.now();

    let record = store.get(key);
    if (!record || now >= record.resetAt) {
      record = {
        count: 1,
        resetAt: now + windowMs,
      };
      store.set(key, record);
    } else {
      record.count += 1;
    }

    const remaining = Math.max(0, maxRequests - record.count);
    const retryAfterSeconds = Math.max(1, Math.ceil((record.resetAt - now) / 1000));

    // Standard rate limit headers
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetAt / 1000));

    if (record.count > maxRequests) {
      res.setHeader('Retry-After', retryAfterSeconds);
      res.status(429).json({
        error: {
          code: 429,
          message: `Too Many Requests: Rate limit exceeded (${maxRequests} requests per ${windowMs / 1000}s). Please retry after ${retryAfterSeconds} seconds.`,
        },
      });
      return;
    }

    next();
  };
}

// Pre-configured rate limiters
export const authRateLimiter = createRateLimiter({
  windowMs: 10000,
  maxRequests: 5,
  keyPrefix: 'auth',
});

export const writeRateLimiter = createRateLimiter({
  windowMs: 10000,
  maxRequests: 10,
  keyPrefix: 'write',
});

