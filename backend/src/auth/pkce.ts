import crypto from 'node:crypto';

/**
 * Generates a cryptographically random PKCE code verifier (RFC 7636).
 * Uses 32 random bytes encoded to base64url (43-128 characters).
 */
export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Computes the S256 code challenge from a code verifier:
 * code_challenge = BASE64URL(SHA256(code_verifier))
 */
export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Generates a cryptographically secure random state parameter to protect against CSRF.
 */
export function generateState(): string {
  return crypto.randomBytes(16).toString('base64url');
}

/**
 * Generates a cryptographically secure random nonce parameter to prevent token replay attacks.
 */
export function generateNonce(): string {
  return crypto.randomBytes(16).toString('base64url');
}

