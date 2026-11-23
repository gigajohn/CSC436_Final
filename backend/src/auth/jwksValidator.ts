import {
  jwtVerify,
  SignJWT,
  generateKeyPair,
  exportJWK,
  JWTVerifyGetKey,
  createLocalJWKSet,
  JSONWebKeySet,
  JWTPayload,
} from 'jose';

export type KeyType = Awaited<ReturnType<typeof generateKeyPair>>['publicKey'];

export interface VerifiedTokenUser {
  sub: string;
  name: string;
  email: string;
  role: 'student' | 'reviewer' | 'instructor' | 'admin';
  scopes: string[];
}

export class JwksValidationError extends Error {
  public code:
    | 'ERR_JWKS_SIGNATURE_INVALID'
    | 'ERR_JWKS_ISSUER_MISMATCH'
    | 'ERR_JWKS_AUDIENCE_MISMATCH'
    | 'ERR_JWKS_TOKEN_EXPIRED'
    | 'ERR_JWKS_SCOPE_INSUFFICIENT'
    | 'ERR_JWKS_MALFORMED';
  public statusCode: number;

  constructor(
    code:
      | 'ERR_JWKS_SIGNATURE_INVALID'
      | 'ERR_JWKS_ISSUER_MISMATCH'
      | 'ERR_JWKS_AUDIENCE_MISMATCH'
      | 'ERR_JWKS_TOKEN_EXPIRED'
      | 'ERR_JWKS_SCOPE_INSUFFICIENT'
      | 'ERR_JWKS_MALFORMED',
    message: string,
    statusCode = 401
  ) {
    super(message);
    this.name = 'JwksValidationError';
    this.code = code;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, JwksValidationError.prototype);
  }
}

export interface ValidationOptions {
  expectedIssuer?: string;
  expectedAudience?: string;
  requiredScope?: string;
  clockTolerance?: number; // seconds
}

export const DEFAULT_ISSUER = 'https://auth.studysync.synthetic.edu';
export const DEFAULT_AUDIENCE = 'studysync-api';

// Keystore singleton for local server JWKS signing and verification
class ServerKeyStore {
  private keyPair: { publicKey: KeyType; privateKey: KeyType } | null = null;
  private jwks: JSONWebKeySet | null = null;

  public async initialize(): Promise<void> {
    if (this.keyPair) return;
    const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
    this.keyPair = { publicKey, privateKey };
    const jwk = await exportJWK(publicKey);
    jwk.kid = 'studysync-key-2026-v1';
    jwk.alg = 'RS256';
    jwk.use = 'sig';
    this.jwks = { keys: [jwk] };
  }

  public getPublicKey(): KeyType {
    if (!this.keyPair) throw new Error('KeyStore not initialized');
    return this.keyPair.publicKey;
  }

  public getPrivateKey(): KeyType {
    if (!this.keyPair) throw new Error('KeyStore not initialized');
    return this.keyPair.privateKey;
  }

  public getJwks(): JSONWebKeySet {
    if (!this.jwks) throw new Error('KeyStore not initialized');
    return this.jwks;
  }
}

export const serverKeyStore = new ServerKeyStore();

// Pre-initialize keys at module load
await serverKeyStore.initialize();

/**
 * Creates a signed JWT for testing or verified token exchange.
 */
export async function mintToken(
  payload: {
    sub: string;
    name: string;
    email: string;
    role: 'student' | 'reviewer' | 'instructor' | 'admin';
    scopes: string[];
    [key: string]: unknown;
  },
  options: {
    issuer?: string;
    audience?: string;
    expiresIn?: string | number; // e.g. '1h' or 3600
    customPrivateKey?: KeyType;
  } = {}
): Promise<string> {
  const privateKey = options.customPrivateKey || serverKeyStore.getPrivateKey();
  const issuer = options.issuer ?? DEFAULT_ISSUER;
  const audience = options.audience ?? DEFAULT_AUDIENCE;

  let builder = new SignJWT({
    ...payload,
    scope: payload.scopes.join(' '),
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'studysync-key-2026-v1' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(payload.sub)
    .setIssuedAt();

  if (options.expiresIn !== undefined) {
    builder = builder.setExpirationTime(options.expiresIn);
  } else {
    builder = builder.setExpirationTime('1h');
  }

  return builder.sign(privateKey);
}

/**
 * Server-Side JWKS Token Verification (Requirement F8).
 * Explicitly structures and evaluates:
 *  1. Cryptographic Signature (against JWKS)
 *  2. Issuer ('iss')
 *  3. Audience ('aud')
 *  4. Expiration ('exp')
 *  5. Scope Claim
 */
export async function verifyTokenWithJwks(
  token: string,
  options: ValidationOptions = {},
  customJwksGetter?: JWTVerifyGetKey
): Promise<{ payload: JWTPayload; user: VerifiedTokenUser }> {
  const expectedIssuer = options.expectedIssuer ?? DEFAULT_ISSUER;
  const expectedAudience = options.expectedAudience ?? DEFAULT_AUDIENCE;
  const jwks = customJwksGetter || createLocalJWKSet(serverKeyStore.getJwks());

  // Check 1: Cryptographic Signature & Expiration using jose jwtVerify
  let verifiedPayload: JWTPayload;
  try {
    const result = await jwtVerify(token, jwks, {
      algorithms: ['RS256'],
      clockTolerance: options.clockTolerance ?? 0,
    });
    verifiedPayload = result.payload;
  } catch (err: any) {
    if (err.code === 'ERR_JWT_EXPIRED') {
      throw new JwksValidationError('ERR_JWKS_TOKEN_EXPIRED', `Token has expired: ${err.message}`);
    }
    if (err.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' || err.code === 'ERR_JWS_INVALID') {
      throw new JwksValidationError(
        'ERR_JWKS_SIGNATURE_INVALID',
        'Cryptographic signature is invalid or does not match provider JWKS public keys.'
      );
    }
    throw new JwksValidationError('ERR_JWKS_MALFORMED', `Failed to verify token: ${err.message}`);
  }

  // Check 2: Issuer (iss) Check
  if (verifiedPayload.iss !== expectedIssuer) {
    throw new JwksValidationError(
      'ERR_JWKS_ISSUER_MISMATCH',
      `Token issuer mismatch: expected "${expectedIssuer}", got "${verifiedPayload.iss}".`
    );
  }

  // Check 3: Audience (aud) Check
  const audArray = Array.isArray(verifiedPayload.aud)
    ? verifiedPayload.aud
    : verifiedPayload.aud
    ? [verifiedPayload.aud]
    : [];
  if (!audArray.includes(expectedAudience)) {
    throw new JwksValidationError(
      'ERR_JWKS_AUDIENCE_MISMATCH',
      `Token audience mismatch: expected "${expectedAudience}", got "${JSON.stringify(verifiedPayload.aud)}".`
    );
  }

  // Check 4: Expiration (exp) Explicit Check
  const nowInSeconds = Math.floor(Date.now() / 1000);
  if (verifiedPayload.exp && verifiedPayload.exp < nowInSeconds) {
    throw new JwksValidationError('ERR_JWKS_TOKEN_EXPIRED', 'Token expiration timestamp (exp) is in the past.');
  }

  // Check 5: Scope Claim Check
  const scopeClaim = verifiedPayload.scope;
  let scopes: string[] = [];
  if (typeof scopeClaim === 'string') {
    scopes = scopeClaim.split(' ').filter(Boolean);
  } else if (Array.isArray(verifiedPayload.scopes)) {
    scopes = verifiedPayload.scopes.map(String);
  }

  if (options.requiredScope) {
    if (!scopes.includes(options.requiredScope)) {
      throw new JwksValidationError(
        'ERR_JWKS_SCOPE_INSUFFICIENT',
        `Insufficient scope: token lacks required scope "${options.requiredScope}". Granted: [${scopes.join(', ')}].`,
        403 // Forbidden when authenticated but missing specific operational scope
      );
    }
  }

  // Map validated claims to typed user identity
  const user: VerifiedTokenUser = {
    sub: String(verifiedPayload.sub || ''),
    name: String(verifiedPayload.name || verifiedPayload.sub || 'User'),
    email: String(verifiedPayload.email || `${verifiedPayload.sub}@synthetic.studysync.edu`),
    role: (verifiedPayload.role as VerifiedTokenUser['role']) || 'student',
    scopes,
  };

  return { payload: verifiedPayload, user };
}
