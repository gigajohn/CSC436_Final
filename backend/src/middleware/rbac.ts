import { Request, Response, NextFunction } from 'express';
import { verifyTokenWithJwks, VerifiedTokenUser, JwksValidationError } from '../auth/jwksValidator.js';
import { mcpStore } from '../mcp/mcpStore.js';

// Extend Express Request to include authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: VerifiedTokenUser;
    }
  }
}

/**
 * Express middleware to authenticate incoming Bearer tokens using server-side JWKS validation (F8).
 */
export async function authenticateToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required: missing or malformed Bearer token.',
      },
    });
    return;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required: Bearer token cannot be empty.',
      },
    });
    return;
  }

  try {
    const { user } = await verifyTokenWithJwks(token);
    req.user = user;
    next();
  } catch (err: unknown) {
    if (err instanceof JwksValidationError) {
      res.status(err.statusCode).json({
        error: {
          code: err.code,
          message: err.message,
        },
      });
      return;
    }

    const message = err instanceof Error ? err.message : 'Invalid token';
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message,
      },
    });
  }
}

/**
 * Role-Based Access Control (RBAC) middleware enforcing verified claims (F9).
 * Returns 403 Forbidden when an authenticated role is not authorized for the route.
 */
export function requireRole(allowedRoles: Array<VerifiedTokenUser['role']>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required before role check.',
        },
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: `Access denied: role "${req.user.role}" is not authorized for this resource. Required role(s): [${allowedRoles.join(', ')}].`,
        },
      });
      return;
    }

    next();
  };
}

/**
 * Logs a mutating action into the append-only audit trail using the verified actor identity.
 */
export function recordAuditAction(
  req: Request,
  action: string,
  resourceType: string,
  resourceId: string,
  beforeState: Record<string, unknown> | null,
  afterState: Record<string, unknown> | null
): void {
  const actorId = req.user?.sub || 'anonymous';
  const actorLabel = req.user ? `${req.user.name} (${req.user.role})` : 'Anonymous';

  mcpStore.logAudit({
    actor_id: actorId,
    actor_label: actorLabel,
    action,
    resource_type: resourceType,
    resource_id: resourceId,
    before_state: beforeState,
    after_state: afterState,
  });
}

