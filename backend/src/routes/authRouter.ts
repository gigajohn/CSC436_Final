import { Router, Request, Response, NextFunction } from 'express';
import { generateCodeVerifier, generateCodeChallenge, generateState, generateNonce } from '../auth/pkce.js';
import { authStateStore } from '../auth/stateStore.js';
import { serverKeyStore, mintToken, DEFAULT_ISSUER } from '../auth/jwksValidator.js';
import { authenticateToken } from '../middleware/rbac.js';
import { authRateLimiter } from '../middleware/rateLimiter.js';

export const authRouter = Router();

// Public JWKS endpoint exposing server verification keys: GET /api/v1/auth/jwks.json
authRouter.get('/jwks.json', (_req: Request, res: Response) => {
  res.status(200).json(serverKeyStore.getJwks());
});

// OIDC Authorization Code Flow with PKCE S256: GET /api/v1/auth/login
authRouter.get('/login', authRateLimiter, (req: Request, res: Response, next: NextFunction) => {
  try {
    const redirectUri = typeof req.query.redirect_uri === 'string'
      ? req.query.redirect_uri
      : 'http://localhost:5173/auth/callback';

    // Generate PKCE code verifier and S256 challenge
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();
    const nonce = generateNonce();

    // Store in single-use state store with 300s TTL
    authStateStore.saveState(state, {
      codeVerifier,
      nonce,
      redirectUri,
    });

    const authUrl = new URL(`${DEFAULT_ISSUER}/authorize`);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', 'studysync-client');
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', 'openid profile email assignments:read');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('nonce', nonce);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    res.status(200).json({
      authUrl: authUrl.toString(),
      transaction: {
        state,
        codeChallenge,
        codeChallengeMethod: 'S256',
        nonce,
        expiresIn: 300,
      },
    });
  } catch (err) {
    next(err);
  }
});

// OIDC Callback & Token Exchange: GET /api/v1/auth/callback
authRouter.get('/callback', authRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code: _code, state, role } = req.query as { code?: string; state?: string; role?: string };

    if (!state) {
      res.status(400).json({
        error: {
          code: 'MISSING_STATE',
          message: 'State parameter is required.',
        },
      });
      return;
    }

    // Atomic single-use state consumption (Replay prevention)
    const transaction = authStateStore.consumeState(state);
    if (!transaction) {
      res.status(400).json({
        error: {
          code: 'INVALID_STATE',
          message: 'State parameter is invalid, expired, or already consumed (Replay detected).',
        },
      });
      return;
    }

    // Issue verified token signed with JWKS private key
    const assignedRole = role === 'instructor' ? 'instructor' : 'student';
    const scopes = assignedRole === 'instructor'
      ? ['openid', 'assignments:read', 'assignments:write', 'grading:write']
      : ['openid', 'assignments:read'];

    const token = await mintToken({
      sub: assignedRole === 'instructor' ? 'usr-ada' : 'usr-alan',
      name: assignedRole === 'instructor' ? 'Ada Lovelace' : 'Alan Turing',
      email: assignedRole === 'instructor' ? 'ada@synthetic.studysync.edu' : 'alan@synthetic.studysync.edu',
      role: assignedRole,
      scopes,
    });

    res.status(200).json({
      message: 'Authentication successful',
      tokenType: 'Bearer',
      accessToken: token,
      role: assignedRole,
      verifiedNonce: transaction.nonce,
    });
  } catch (err) {
    next(err);
  }
});

// Convenience endpoint to mint verified tokens for tests & frontend demo: POST /api/v1/auth/mint
authRouter.post('/mint', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { role = 'student', name, sub, scopes } = req.body as {
      role?: 'student' | 'instructor';
      name?: string;
      sub?: string;
      scopes?: string[];
    };

    const token = await mintToken({
      sub: sub || (role === 'instructor' ? 'usr-ada' : 'usr-alan'),
      name: name || (role === 'instructor' ? 'Ada Lovelace' : 'Alan Turing'),
      email: `${role}@synthetic.studysync.edu`,
      role,
      scopes: scopes || (role === 'instructor'
        ? ['openid', 'assignments:read', 'assignments:write', 'grading:write']
        : ['openid', 'assignments:read']),
    });

    res.status(200).json({ token, role });
  } catch (err) {
    next(err);
  }
});

// Current user profile: GET /api/v1/auth/me
authRouter.get('/me', authenticateToken, (req: Request, res: Response) => {
  res.status(200).json({
    user: req.user,
  });
});
