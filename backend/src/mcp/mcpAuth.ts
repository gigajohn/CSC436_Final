export interface AuthContext {
  userId: string;
  email: string;
  name: string;
  role: 'student' | 'reviewer' | 'instructor' | 'admin';
  scopes: string[];
}

export interface DemoPersona {
  id: string;
  name: string;
  email: string;
  role: 'student' | 'reviewer' | 'instructor';
  token: string;
  scopes: string[];
  description: string;
}

export const DEMO_PERSONAS: Record<string, DemoPersona> = {
  instructor: {
    id: 'usr-ada',
    name: 'Ada Lovelace',
    email: 'ada.lovelace@synthetic.studysync.edu',
    role: 'instructor',
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c3ItYWRhIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsImVtYWlsIjoiYWRhLmxvdmVsYWNlQHN5bnRoZXRpYy5zdHVkeXN5bmMuZWR1Iiwicm9sZSI6Imluc3RydWN0b3IiLCJzY29wZXMiOlsibWNwOnN1Ym1pc3Npb25zLnJlYWQiLCJtY3A6cmV2aWV3cy5yZWFkIiwibWNwOnJldmlld3Mud3JpdGUiXX0.sig',
    scopes: ['mcp:submissions.read', 'mcp:reviews.read', 'mcp:reviews.write'],
    description: 'Instructor with full administrative read and write scopes',
  },
  reviewer: {
    id: 'usr-grace',
    name: 'Grace Hopper',
    email: 'grace.hopper@synthetic.studysync.edu',
    role: 'reviewer',
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c3ItZ3JhY2UiLCJuYW1lIjoiR3JhY2UgSG9wcGVyIiwiZW1haWwiOiJncmFjZS5ob3BwZXJAc3ludGhldGljLnN0dWR5c3luYy5lZHUiLCJyb2xlIjoicmV2aWV3ZXIiLCJzY29wZXMiOlsibWNwOnN1Ym1pc3Npb25zLnJlYWQiLCJtY3A6cmV2aWV3cy5yZWFkIiwibWNwOnJldmlld3Mud3JpdGUiXX0.sig',
    scopes: ['mcp:submissions.read', 'mcp:reviews.read', 'mcp:reviews.write'],
    description: 'Peer reviewer authorized to inspect submissions and post review comments',
  },
  student: {
    id: 'usr-alan',
    name: 'Alan Turing',
    email: 'alan.turing@synthetic.studysync.edu',
    role: 'student',
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c3ItYWxhbiIsIm5hbWUiOiJBbGFuIFR1cmluZyIsImVtYWlsIjoiYWxhbi50dXJpbmdAc3ludGhldGljLnN0dWR5c3luYy5lZHUiLCJyb2xlIjoic3R1ZGVudCIsInN2b3BlcyI6WyJtY3A6c3VibWlzc2lvbnMucmVhZCIsIm1jcDpyZXZpZXdzLnJlYWQiXX0.sig',
    scopes: ['mcp:submissions.read', 'mcp:reviews.read'],
    description: 'Student / Viewer with read-only scopes (Write actions are strictly forbidden)',
  },
};

/**
 * Validates a Bearer token and returns the authenticated context claims.
 * Throws an error with code UNAUTHORIZED if invalid or absent.
 */
export function validateBearerToken(authHeader?: string): AuthContext {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new McpAuthError(401, 'UNAUTHORIZED', 'Authorization header with Bearer token is required.');
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    throw new McpAuthError(401, 'UNAUTHORIZED', 'Bearer token cannot be empty.');
  }

  // 1. Check known persona tokens
  for (const persona of Object.values(DEMO_PERSONAS)) {
    if (token === persona.token || token === `token-${persona.role}`) {
      return {
        userId: persona.id,
        name: persona.name,
        email: persona.email,
        role: persona.role,
        scopes: persona.scopes,
      };
    }
  }

  // 2. Decode standard base64 JWT payload if provided
  try {
    const parts = token.split('.');
    if (parts.length === 3) {
      const payloadJson = Buffer.from(parts[1], 'base64').toString('utf-8');
      const payload = JSON.parse(payloadJson) as {
        sub?: string;
        name?: string;
        email?: string;
        role?: 'student' | 'reviewer' | 'instructor' | 'admin';
        scopes?: string[];
      };

      if (payload.sub && payload.role && Array.isArray(payload.scopes)) {
        return {
          userId: payload.sub,
          name: payload.name || 'Anonymous User',
          email: payload.email || `${payload.sub}@synthetic.studysync.edu`,
          role: payload.role,
          scopes: payload.scopes,
        };
      }
    }
  } catch {
    // Falls through to invalid token error
  }

  throw new McpAuthError(401, 'UNAUTHORIZED', 'Invalid or expired Bearer token.');
}

/**
 * Enforces that the authenticated user possesses the required OAuth scope.
 * Throws 403 Forbidden if the scope is missing.
 */
export function assertRequiredScope(auth: AuthContext, requiredScope: string): void {
  if (!auth.scopes.includes(requiredScope)) {
    throw new McpAuthError(
      403,
      'FORBIDDEN',
      `Insufficient permissions: token lacks required scope "${requiredScope}". Granted scopes: [${auth.scopes.join(', ')}].`
    );
  }
}

/**
 * Enforces role authorization (e.g. only reviewers and instructors can mutate review state).
 */
export function assertAuthorizedRole(auth: AuthContext, allowedRoles: Array<AuthContext['role']>): void {
  if (!allowedRoles.includes(auth.role)) {
    throw new McpAuthError(
      403,
      'FORBIDDEN',
      `Forbidden: role "${auth.role}" is not authorized for this operation. Required role: [${allowedRoles.join(', ')}].`
    );
  }
}

export class McpAuthError extends Error {
  public statusCode: number;
  public code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'McpAuthError';
    this.statusCode = statusCode;
    this.code = code;
    Object.setPrototypeOf(this, McpAuthError.prototype);
  }
}

