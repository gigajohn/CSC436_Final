import http from 'node:http';
import { CodeAnalysisClient } from '../integrations/codeAnalysisClient.js';

interface MockServerContext {
  server: http.Server;
  port: number;
  baseUrl: string;
  receivedHeaders: http.IncomingHttpHeaders[];
  requestCount: number;
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;
}

function createMockProvider(): Promise<MockServerContext> {
  const ctx: MockServerContext = {
    server: null as any,
    port: 0,
    baseUrl: '',
    receivedHeaders: [],
    requestCount: 0,
    handler: (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    },
  };

  ctx.server = http.createServer((req, res) => {
    ctx.requestCount++;
    ctx.receivedHeaders.push(req.headers);
    ctx.handler(req, res);
  });

  return new Promise((resolve) => {
    ctx.server.listen(0, '127.0.0.1', () => {
      const addr = ctx.server.address();
      if (!addr || typeof addr === 'string') throw new Error('Failed to bind mock server');
      ctx.port = addr.port;
      ctx.baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve(ctx);
    });
  });
}

async function runF10Verification() {
  console.log('================================================================');
  console.log(' StudySync Third-Party Integration Verification (F10)           ');
  console.log('================================================================\n');

  const mockProvider = await createMockProvider();
  const testSecretKey = 'sk_live_synthetic_provider_secret_99812';

  // Instantiate client pointing to mock provider with short timeouts for fast deterministic tests
  const client = new CodeAnalysisClient({
    baseUrl: mockProvider.baseUrl,
    apiKey: testSecretKey,
    timeoutMs: 400,
    maxRetries: 3,
    retryBaseDelayMs: 50,
    cacheTtlSeconds: 300,
  });

  try {
    // -------------------------------------------------------------------------
    // Test 1: Happy Path, Secret in Header & Zod Runtime Schema Validation
    // -------------------------------------------------------------------------
    console.log('[1/5] Testing Happy Path, Secret Transmission & Zod Validation...');
    mockProvider.handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          analysisId: 'ca-test-101',
          commitSha: 'a1b2c3d4e5f6',
          status: 'passed',
          metrics: {
            complexityScore: 12,
            duplicatedLines: 0,
            securityIssuesCount: 0,
          },
          linterWarnings: [
            {
              file: 'src/storage/engine.go',
              line: 42,
              rule: 'errcheck',
              message: 'Check returned error from sync.Close',
              severity: 'warning',
            },
          ],
          analyzedAt: new Date().toISOString(),
        })
      );
    };

    const res1 = await client.analyzeCommit('https://github.com/synthetic/repo', 'a1b2c3d4e5f6');

    // Verify secret passed in headers
    const lastHeader = mockProvider.receivedHeaders[mockProvider.receivedHeaders.length - 1];
    if (lastHeader['x-api-key'] !== testSecretKey) {
      throw new Error(`Secret key mismatch in request header: ${lastHeader['x-api-key']}`);
    }
    console.log(`  ✓ Secret key successfully verified in request header: X-Api-Key`);

    // Verify Zod validated parsed result
    if (res1.analysisId !== 'ca-test-101' || res1.metrics.complexityScore !== 12) {
      throw new Error(`Unexpected payload returned: ${JSON.stringify(res1)}`);
    }
    if (res1._degraded) throw new Error('Expected non-degraded response on happy path');
    console.log(`  ✓ Runtime response validated via Zod schema (analysisId: ${res1.analysisId})`);

    // -------------------------------------------------------------------------
    // Test 2: Cache Layer Respecting Provider Rate Limits
    // -------------------------------------------------------------------------
    console.log('\n[2/5] Testing Cache Layer (Respects Provider Limits)...');
    const requestsBefore = mockProvider.requestCount;

    // Second call with same repo & commit
    const res2 = await client.analyzeCommit('https://github.com/synthetic/repo', 'a1b2c3d4e5f6');
    const requestsAfter = mockProvider.requestCount;

    if (!res2._cached) {
      throw new Error('Expected cache hit on second call');
    }
    if (requestsAfter !== requestsBefore) {
      throw new Error(`Cache failed: Provider received additional request (${requestsAfter} vs ${requestsBefore})`);
    }
    console.log(`  ✓ Cache HIT verified: zero outbound requests sent to provider on identical commit.`);

    // -------------------------------------------------------------------------
    // Test 3: Bounded Retry with Exponential Backoff
    // -------------------------------------------------------------------------
    console.log('\n[3/5] Testing Bounded Retries on Transient 5xx Errors...');
    client.clearCache();

    let retryAttempts = 0;
    mockProvider.handler = (_req, res) => {
      retryAttempts++;
      if (retryAttempts < 3) {
        // Fail first 2 attempts with 503
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Service temporarily unavailable' }));
      } else {
        // Succeed on 3rd attempt
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            analysisId: 'ca-retry-success',
            commitSha: 'b2c3d4e5f6a1',
            status: 'passed',
            metrics: { complexityScore: 8, duplicatedLines: 0, securityIssuesCount: 0 },
            linterWarnings: [],
            analyzedAt: new Date().toISOString(),
          })
        );
      }
    };

    const res3 = await client.analyzeCommit('https://github.com/synthetic/repo', 'b2c3d4e5f6a1');
    if (res3._attemptsMade !== 3 || res3._degraded) {
      throw new Error(`Bounded retry failed: attemptsMade=${res3._attemptsMade}, degraded=${res3._degraded}`);
    }
    console.log(`  ✓ Bounded retry recovered after 2 transient 503 failures (Succeeded on attempt #${res3._attemptsMade}).`);

    // -------------------------------------------------------------------------
    // Test 4: Provider Stubbed Down — Graceful Degradation (Core F10 Proof)
    // -------------------------------------------------------------------------
    console.log('\n[4/5] Testing Graceful Degradation with Provider STUBBED DOWN (F10 Core Proof)...');
    client.clearCache();

    // Shut down mock provider completely to simulate total external outage
    await new Promise<void>((resolve) => mockProvider.server.close(() => resolve()));
    console.log('  [Mock Provider is now completely OFFLINE]');

    // Execute call while provider is dead
    const degradedRes = await client.analyzeCommit('https://github.com/synthetic/repo', 'c3d4e5f6a1b2');

    // Asserts client did NOT crash or throw
    if (degradedRes._degraded !== true) {
      throw new Error('Expected _degraded: true when provider is stubbed down');
    }
    if (degradedRes.status !== 'warning') {
      throw new Error(`Expected degraded status "warning", got: ${degradedRes.status}`);
    }
    if (!degradedRes._degradedReason) {
      throw new Error('Missing _degradedReason in fallback payload');
    }
    console.log(`  ✓ Graceful degradation confirmed: Server returned resilient fallback without crashing.`);
    console.log(`    Degraded Reason: "${degradedRes._degradedReason}"`);
    console.log(`    Fallback Diagnostics: "${degradedRes.linterWarnings[0].message}"`);

    // -------------------------------------------------------------------------
    // Test 5: Zod Runtime Schema Mismatch Handling
    // -------------------------------------------------------------------------
    console.log('\n[5/5] Testing Runtime Schema Violation Handling...');
    // Re-bind a new mock server that returns corrupted/unexpected shape
    const corruptedProvider = await createMockProvider();
    const corruptedClient = new CodeAnalysisClient({
      baseUrl: corruptedProvider.baseUrl,
      apiKey: testSecretKey,
      timeoutMs: 400,
      maxRetries: 1,
    });

    corruptedProvider.handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // Return completely malformed object missing required metrics & types
      res.end(JSON.stringify({ garbage: 1234, invalid: true }));
    };

    const schemaFailRes = await corruptedClient.analyzeCommit('https://github.com/synthetic/repo', 'd4e5f6a1b2c3');
    if (schemaFailRes._degraded !== true) {
      throw new Error('Expected corrupted response to trigger graceful degradation');
    }
    console.log(`  ✓ Corrupted provider response rejected by Zod schema and safely degraded.`);
    await new Promise<void>((resolve) => corruptedProvider.server.close(() => resolve()));

    console.log('\n================================================================');
    console.log(' ALL F10 THIRD-PARTY RESILIENCE CHECKS PASSED (100%)            ');
    console.log('================================================================\n');
    process.exit(0);
  } finally {
    try {
      mockProvider.server.close();
    } catch {}
  }
}

runF10Verification().catch((err) => {
  console.error('\n❌ F10 Verification failed with error:', err);
  process.exit(1);
});

