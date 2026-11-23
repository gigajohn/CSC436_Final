import http from 'node:http';
import { generateKeyPair } from 'jose';
import { createApp } from '../app.js';
import {
  mintToken,
  verifyTokenWithJwks,
  JwksValidationError,
  DEFAULT_ISSUER,
  DEFAULT_AUDIENCE,
} from '../auth/jwksValidator.js';
import { mcpStore } from '../mcp/mcpStore.js';

interface TestContext {
  server: http.Server;
  baseUrl: string;
}

async function startServer(): Promise<TestContext> {
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('Failed to bind server');
  return {
    server,
    baseUrl: `http://127.0.0.1:${addr.port}`,
  };
}

async function runAuthRbacVerification() {
  console.log('================================================================');
  console.log(' StudySync Auth, JWKS, RBAC & Rate Limiting Verification (F7-S1) ');
  console.log('================================================================\n');

  mcpStore.resetForTesting();
  const { server, baseUrl } = await startServer();

  try {
    // =========================================================================
    // SECTION 1: Independent JWKS Validation Checks (F8)
    // =========================================================================
    console.log('[1/4] Testing Server-Side JWKS Token Validation Checks (F8)...');

    // 1a. Cryptographic Signature Failure (Tampered token)
    console.log('  Testing 1a: Signature check with tampered token...');
    const genuineToken = await mintToken({
      sub: 'usr-student',
      name: 'Alan Turing',
      email: 'alan@synthetic.studysync.edu',
      role: 'student',
      scopes: ['openid'],
    });

    // Tamper with the payload (middle segment)
    const tokenParts = genuineToken.split('.');
    const tamperedPayload = Buffer.from(
      JSON.stringify({ sub: 'usr-hacker', role: 'admin', scopes: ['*'] })
    ).toString('base64url');
    const tamperedToken = `${tokenParts[0]}.${tamperedPayload}.${tokenParts[2]}`;

    let sigFailed = false;
    try {
      await verifyTokenWithJwks(tamperedToken);
    } catch (err) {
      if (err instanceof JwksValidationError && err.code === 'ERR_JWKS_SIGNATURE_INVALID') {
        sigFailed = true;
      }
    }
    if (!sigFailed) throw new Error('Failed: Tampered signature was not rejected with ERR_JWKS_SIGNATURE_INVALID');
    console.log('    ✓ Rejected tampered token: ERR_JWKS_SIGNATURE_INVALID');

    // Also test signing with an untrusted external private key not in JWKS
    const foreignKeys = await generateKeyPair('RS256', { extractable: true });
    const foreignSignedToken = await mintToken(
      { sub: 'usr-foreign', name: 'Untrusted User', email: 'user@foreign.com', role: 'student', scopes: ['openid'] },
      { customPrivateKey: foreignKeys.privateKey }
    );
    let foreignSigFailed = false;
    try {
      await verifyTokenWithJwks(foreignSignedToken);
    } catch (err) {
      if (err instanceof JwksValidationError && err.code === 'ERR_JWKS_SIGNATURE_INVALID') {
        foreignSigFailed = true;
      }
    }
    if (!foreignSigFailed) throw new Error('Failed: Foreign-signed token was not rejected');
    console.log('    ✓ Rejected foreign key signature against local JWKS');

    // 1b. Issuer ('iss') Mismatch Check
    console.log('  Testing 1b: Issuer mismatch check...');
    const wrongIssuerToken = await mintToken(
      { sub: 'usr-1', name: 'Test', email: 't@test.com', role: 'student', scopes: ['openid'] },
      { issuer: 'https://malicious-issuer.com' }
    );
    let issFailed = false;
    try {
      await verifyTokenWithJwks(wrongIssuerToken, { expectedIssuer: DEFAULT_ISSUER });
    } catch (err) {
      if (err instanceof JwksValidationError && err.code === 'ERR_JWKS_ISSUER_MISMATCH') {
        issFailed = true;
      }
    }
    if (!issFailed) throw new Error('Failed: Issuer mismatch was not rejected with ERR_JWKS_ISSUER_MISMATCH');
    console.log('    ✓ Rejected invalid issuer: ERR_JWKS_ISSUER_MISMATCH');

    // 1c. Audience ('aud') Mismatch Check
    console.log('  Testing 1c: Audience mismatch check...');
    const wrongAudienceToken = await mintToken(
      { sub: 'usr-1', name: 'Test', email: 't@test.com', role: 'student', scopes: ['openid'] },
      { audience: 'wrong-audience' }
    );
    let audFailed = false;
    try {
      await verifyTokenWithJwks(wrongAudienceToken, { expectedAudience: DEFAULT_AUDIENCE });
    } catch (err) {
      if (err instanceof JwksValidationError && err.code === 'ERR_JWKS_AUDIENCE_MISMATCH') {
        audFailed = true;
      }
    }
    if (!audFailed) throw new Error('Failed: Audience mismatch was not rejected with ERR_JWKS_AUDIENCE_MISMATCH');
    console.log('    ✓ Rejected invalid audience: ERR_JWKS_AUDIENCE_MISMATCH');

    // 1d. Expiration ('exp') Check
    console.log('  Testing 1d: Token expiration check...');
    const expiredToken = await mintToken(
      { sub: 'usr-1', name: 'Test', email: 't@test.com', role: 'student', scopes: ['openid'] },
      { expiresIn: -10 } // Expired 10 seconds ago
    );
    let expFailed = false;
    try {
      await verifyTokenWithJwks(expiredToken);
    } catch (err) {
      if (err instanceof JwksValidationError && err.code === 'ERR_JWKS_TOKEN_EXPIRED') {
        expFailed = true;
      }
    }
    if (!expFailed) throw new Error('Failed: Expired token was not rejected with ERR_JWKS_TOKEN_EXPIRED');
    console.log('    ✓ Rejected expired token: ERR_JWKS_TOKEN_EXPIRED');

    // 1e. Required Scope Check
    console.log('  Testing 1e: Scope check...');
    const readOnlyToken = await mintToken({
      sub: 'usr-1',
      name: 'Test',
      email: 't@test.com',
      role: 'student',
      scopes: ['openid', 'assignments:read'],
    });
    let scopeFailed = false;
    try {
      await verifyTokenWithJwks(readOnlyToken, { requiredScope: 'grading:write' });
    } catch (err) {
      if (err instanceof JwksValidationError && err.code === 'ERR_JWKS_SCOPE_INSUFFICIENT' && err.statusCode === 403) {
        scopeFailed = true;
      }
    }
    if (!scopeFailed) throw new Error('Failed: Missing scope was not rejected with ERR_JWKS_SCOPE_INSUFFICIENT');
    console.log('    ✓ Rejected missing scope: ERR_JWKS_SCOPE_INSUFFICIENT (HTTP 403)');

    // 1f. Valid Token Check
    console.log('  Testing 1f: Valid token verification...');
    const validToken = await mintToken({
      sub: 'usr-ada',
      name: 'Ada Lovelace',
      email: 'ada@synthetic.studysync.edu',
      role: 'instructor',
      scopes: ['openid', 'assignments:read', 'grading:write'],
    });
    const verified = await verifyTokenWithJwks(validToken, { requiredScope: 'grading:write' });
    if (verified.user.sub !== 'usr-ada' || verified.user.role !== 'instructor') {
      throw new Error('Valid token claims mapping failed');
    }
    console.log('    ✓ Verified valid token and mapped claims successfully.');

    // =========================================================================
    // SECTION 2: Student vs. Instructor RBAC Proof (F9)
    // =========================================================================
    console.log('\n[2/4] Testing Student vs. Instructor RBAC (F9 Proof)...');
    const gradeEndpoint = `${baseUrl}/api/v1/assignments/asg-001/grade`;

    // 2a. Anonymous -> 401 Unauthorized
    console.log('  2a: Calling instructor grade route anonymously (No token)...');
    const anonRes = await fetch(gradeEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score: 95 }),
    });
    if (anonRes.status !== 401) {
      throw new Error(`Expected HTTP 401 for anonymous call, got: ${anonRes.status}`);
    }
    const anonBody = await anonRes.json();
    console.log(`    ✓ Anonymous caller received HTTP 401: "${anonBody.error?.message}"`);

    // 2b. Student Token -> 403 Forbidden
    console.log('  2b: Calling instructor grade route with Student token...');
    const studentToken = await mintToken({
      sub: 'usr-alan',
      name: 'Alan Turing',
      email: 'alan@synthetic.studysync.edu',
      role: 'student',
      scopes: ['openid', 'assignments:read'],
    });
    const studentRes = await fetch(gradeEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({ score: 95 }),
    });
    if (studentRes.status !== 403) {
      throw new Error(`Expected HTTP 403 for student caller on instructor route, got: ${studentRes.status}`);
    }
    const studentBody = await studentRes.json();
    console.log(`    ✓ Student caller received HTTP 403: "${studentBody.error?.message}"`);

    // 2c. Instructor Token -> 200 OK
    console.log('  2c: Calling instructor grade route with Instructor token...');
    const instructorToken = await mintToken({
      sub: 'usr-ada',
      name: 'Ada Lovelace',
      email: 'ada@synthetic.studysync.edu',
      role: 'instructor',
      scopes: ['openid', 'assignments:read', 'assignments:write', 'grading:write'],
    });
    const instructorRes = await fetch(gradeEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${instructorToken}`,
      },
      body: JSON.stringify({ score: 98, feedback: 'Rigorous raft implementation.' }),
    });
    if (instructorRes.status !== 200) {
      throw new Error(`Expected HTTP 200 for instructor caller, got: ${instructorRes.status}`);
    }
    const instructorBody = await instructorRes.json();
    console.log(`    ✓ Instructor caller received HTTP 200: "${instructorBody.message}"`);

    // 2d. Audit Trail Verification for Instructor Mutation
    const auditRecords = mcpStore.getAuditTrail(5);
    const gradeAudit = auditRecords.find((l) => l.action === 'assignment.grade_submitted');
    if (!gradeAudit || gradeAudit.actor_id !== 'usr-ada') {
      throw new Error('Audit trail did not capture verified instructor actor identity');
    }
    console.log(`    ✓ Verified actor logged in audit_trail: [${gradeAudit.actor_label}, ID=${gradeAudit.actor_id}]`);

    // =========================================================================
    // SECTION 3: OIDC PKCE S256 & Single-Use State (F7)
    // =========================================================================
    console.log('\n[3/4] Testing OIDC PKCE S256 & Single-Use State (F7)...');
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`);
    if (!loginRes.ok) throw new Error(`Login init failed: ${loginRes.status}`);
    const loginData = await loginRes.json();

    const state = loginData.transaction.state;
    const challengeMethod = loginData.transaction.codeChallengeMethod;
    if (challengeMethod !== 'S256') {
      throw new Error(`Expected code_challenge_method S256, got: ${challengeMethod}`);
    }
    console.log(`  ✓ Initiated OIDC login with PKCE S256 challenge and nonce.`);

    // First Callback -> Consumes state
    const callbackRes1 = await fetch(`${baseUrl}/api/v1/auth/callback?state=${state}&code=test-auth-code`);
    if (!callbackRes1.ok) throw new Error(`Callback failed: ${callbackRes1.status}`);
    const callbackData1 = await callbackRes1.json();
    console.log(`  ✓ State consumed successfully on first callback (Role: ${callbackData1.role}).`);

    // Replay Callback with identical state -> Must fail (Single-use enforcement)
    const callbackRes2 = await fetch(`${baseUrl}/api/v1/auth/callback?state=${state}&code=test-auth-code`);
    if (callbackRes2.status !== 400) {
      throw new Error(`Expected HTTP 400 on state replay, got: ${callbackRes2.status}`);
    }
    const replayBody = await callbackRes2.json();
    if (replayBody.error?.code !== 'INVALID_STATE') {
      throw new Error(`Expected error code INVALID_STATE on replay, got: ${JSON.stringify(replayBody)}`);
    }
    console.log(`  ✓ State replay prevented (Single-use consumption enforced): "${replayBody.error?.message}"`);

    // =========================================================================
    // SECTION 4: Rate Limiting with HTTP 429 (S1)
    // =========================================================================
    console.log('\n[4/4] Testing Rate Limiting (S1 Requirement)...');
    // Limit is 5 requests per 10s on auth endpoints
    let hit429 = false;
    let retryAfterHeader: string | null = null;
    let rateLimitErrorBody: any = null;

    for (let i = 0; i < 7; i++) {
      const res = await fetch(`${baseUrl}/api/v1/auth/login`);
      if (res.status === 429) {
        hit429 = true;
        retryAfterHeader = res.headers.get('retry-after');
        rateLimitErrorBody = await res.json();
        break;
      }
    }

    if (!hit429) {
      throw new Error('Rate limiter failed: Did not receive HTTP 429 after bursting requests');
    }
    if (!retryAfterHeader) {
      throw new Error('Rate limiter missing Retry-After header');
    }
    if (rateLimitErrorBody?.error?.code !== 429) {
      throw new Error(`Expected error.code 429 in JSON body, got: ${JSON.stringify(rateLimitErrorBody)}`);
    }
    console.log(`  ✓ Received HTTP 429 Too Many Requests`);
    console.log(`  ✓ Response shape: ${JSON.stringify(rateLimitErrorBody)}`);
    console.log(`  ✓ Header Retry-After: ${retryAfterHeader}s`);

    console.log('\n================================================================');
    console.log(' ALL AUTH, JWKS, RBAC & RATE LIMITING CHECKS PASSED (100%)      ');
    console.log('================================================================\n');
    process.exit(0);
  } finally {
    server.close();
  }
}

runAuthRbacVerification().catch((err) => {
  console.error('\n❌ Verification failed with error:', err);
  process.exit(1);
});

