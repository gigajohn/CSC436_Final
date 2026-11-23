import http from 'node:http';
import { createApp } from '../app.js';
import { DEMO_PERSONAS } from '../mcp/mcpAuth.js';
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

async function mcpCall(
  baseUrl: string,
  method: string,
  params?: Record<string, unknown>,
  token?: string | null
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${baseUrl}/api/v1/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  });

  const body = await res.json();
  return { status: res.status, body };
}

async function runMcpVerification() {
  console.log('====================================================');
  console.log(' StudySync OAuth MCP Server Verification (F12, F13) ');
  console.log('====================================================\n');

  mcpStore.resetForTesting();
  const { server, baseUrl } = await startServer();

  try {
    const studentToken = DEMO_PERSONAS.student.token;
    const instructorToken = DEMO_PERSONAS.instructor.token;

    // -------------------------------------------------------------------------
    // Test 1: Hard Gate — Unauthenticated request is rejected with 401
    // -------------------------------------------------------------------------
    console.log('[1/5] Testing unauthenticated call to POST /api/v1/mcp...');
    const unauthRes = await mcpCall(baseUrl, 'tools/list', undefined, null);
    if (unauthRes.status !== 401) {
      throw new Error(`Expected HTTP 401 for unauthenticated call, got: ${unauthRes.status}`);
    }
    if (unauthRes.body?.error?.code !== 'UNAUTHORIZED') {
      throw new Error(`Expected error code UNAUTHORIZED, got: ${JSON.stringify(unauthRes.body)}`);
    }
    console.log('  ✓ 401 Unauthorized correctly returned when Bearer token is missing.');

    // -------------------------------------------------------------------------
    // Test 2: Read Tools — Authenticated call with Read Token
    // -------------------------------------------------------------------------
    console.log('\n[2/5] Testing 3 Read Tools with Student Read-Only token...');

    // Tool 1: list_submissions
    const listRes = await mcpCall(
      baseUrl,
      'tools/call',
      { name: 'list_submissions', arguments: { status: 'all' } },
      studentToken
    );
    if (listRes.status !== 200 || !listRes.body.result?.data?.submissions) {
      throw new Error(`list_submissions failed: ${JSON.stringify(listRes.body)}`);
    }
    const totalSubs = listRes.body.result.data.submissions.length;
    console.log(`  ✓ Read Tool 1 (list_submissions): Returned ${totalSubs} submissions.`);

    // Tool 2: get_submission_details
    const detailsRes = await mcpCall(
      baseUrl,
      'tools/call',
      { name: 'get_submission_details', arguments: { submissionId: 'sub-001' } },
      studentToken
    );
    if (detailsRes.status !== 200 || detailsRes.body.result?.data?.id !== 'sub-001') {
      throw new Error(`get_submission_details failed: ${JSON.stringify(detailsRes.body)}`);
    }
    console.log(`  ✓ Read Tool 2 (get_submission_details): Successfully retrieved details for sub-001.`);

    // Tool 3: list_review_comments
    const commentsRes = await mcpCall(
      baseUrl,
      'tools/call',
      { name: 'list_review_comments', arguments: { submissionId: 'sub-001' } },
      studentToken
    );
    if (commentsRes.status !== 200 || !Array.isArray(commentsRes.body.result?.data?.comments)) {
      throw new Error(`list_review_comments failed: ${JSON.stringify(commentsRes.body)}`);
    }
    const commentsCount = commentsRes.body.result.data.comments.length;
    console.log(`  ✓ Read Tool 3 (list_review_comments): Retrieved ${commentsCount} comments for sub-001.`);

    // -------------------------------------------------------------------------
    // Test 3: Write Tool Refusal (403 Forbidden) with Read-Only Token (F12 Proof)
    // -------------------------------------------------------------------------
    console.log('\n[3/5] Testing Write Tool refusal with Read-Only Token (F12 Proof)...');
    const writeAttemptRes = await mcpCall(
      baseUrl,
      'tools/call',
      {
        name: 'post_review_comment',
        arguments: {
          submissionId: 'sub-001',
          filePath: 'src/storage/engine.go',
          lineNumber: 42,
          commentText: 'Unauthorized mutation attempt by read-only token',
          severity: 'issue',
          confirmed: true,
        },
      },
      studentToken // Has only mcp:submissions.read and mcp:reviews.read
    );

    if (writeAttemptRes.status !== 403) {
      throw new Error(`Expected HTTP 403 Forbidden on write tool with read-only token, got: ${writeAttemptRes.status}`);
    }
    if (writeAttemptRes.body?.error?.code !== 'FORBIDDEN') {
      throw new Error(`Expected error code FORBIDDEN, got: ${JSON.stringify(writeAttemptRes.body)}`);
    }
    console.log('  ✓ HTTP 403 FORBIDDEN refused write action for read-only caller.');
    console.log(`    Message: "${writeAttemptRes.body.error.message}"`);

    // -------------------------------------------------------------------------
    // Test 4: Two-Step Confirmation Gating on Write Tool
    // -------------------------------------------------------------------------
    console.log('\n[4/5] Testing Two-Step Confirmation Gating with Instructor Token...');

    // Step 4a: Call with confirmed: false (Preview mode)
    const initialCommentsCount = mcpStore.listComments('sub-001').length;
    const unconfirmedRes = await mcpCall(
      baseUrl,
      'tools/call',
      {
        name: 'post_review_comment',
        arguments: {
          submissionId: 'sub-001',
          filePath: 'src/storage/engine.go',
          lineNumber: 60,
          commentText: 'Atomic pointer swap reduces contention on cache line.',
          severity: 'suggestion',
          confirmed: false, // Explicitly unconfirmed
        },
      },
      instructorToken
    );

    if (unconfirmedRes.status !== 200) {
      throw new Error(`Unexpected status for unconfirmed preview: ${unconfirmedRes.status}`);
    }
    if (unconfirmedRes.body.result?.status !== 'pending_confirmation') {
      throw new Error(`Expected status pending_confirmation, got: ${unconfirmedRes.body.result?.status}`);
    }
    if (unconfirmedRes.body.result?.confirmationRequired !== true) {
      throw new Error('Expected confirmationRequired: true on unconfirmed write call');
    }

    // Verify datastore was NOT mutated
    const postUnconfirmedCount = mcpStore.listComments('sub-001').length;
    if (postUnconfirmedCount !== initialCommentsCount) {
      throw new Error('CRITICAL: State mutated despite unconfirmed call!');
    }
    console.log('  ✓ Step 1: Unconfirmed call returned confirmationRequired: true without mutating state.');

    // Step 4b: Call with confirmed: true (Commit mutation)
    const confirmedRes = await mcpCall(
      baseUrl,
      'tools/call',
      {
        name: 'post_review_comment',
        arguments: {
          submissionId: 'sub-001',
          filePath: 'src/storage/engine.go',
          lineNumber: 60,
          commentText: 'Atomic pointer swap reduces contention on cache line.',
          severity: 'suggestion',
          confirmed: true, // Confirmed execution
        },
      },
      instructorToken
    );

    if (confirmedRes.status !== 200 || confirmedRes.body.result?.status !== 'success') {
      throw new Error(`Confirmed call failed: ${JSON.stringify(confirmedRes.body)}`);
    }
    const finalCommentsCount = mcpStore.listComments('sub-001').length;
    if (finalCommentsCount !== initialCommentsCount + 1) {
      throw new Error('Confirmed call did not commit comment to datastore.');
    }
    const newCommentId = confirmedRes.body.result.data.id;
    console.log(`  ✓ Step 2: Confirmed call committed comment (ID: ${newCommentId}).`);

    // -------------------------------------------------------------------------
    // Test 5: Append-Only Audit Trail Inspection & Immutability
    // -------------------------------------------------------------------------
    console.log('\n[5/5] Verifying Append-Only Audit Trail entries...');
    const auditRes = await fetch(`${baseUrl}/api/v1/mcp/audit`, {
      headers: { Authorization: `Bearer ${instructorToken}` },
    });
    if (!auditRes.ok) {
      throw new Error(`Failed to query audit trail: ${auditRes.status}`);
    }
    const auditData = (await auditRes.json()) as { auditTrail: any[] };
    const logs = auditData.auditTrail;

    if (logs.length < 5) {
      throw new Error(`Expected at least 5 audit entries, found ${logs.length}`);
    }

    // Check recent log entries
    const latestLog = logs[0];
    console.log(`  ✓ Latest audit log: action=${latestLog.action}, actor=${latestLog.actor_label}`);

    // Verify actor is from validated token
    const hasInstructorActor = logs.some((l) => l.actor_id === 'usr-ada');
    const hasStudentActor = logs.some((l) => l.actor_id === 'usr-alan');
    if (!hasInstructorActor || !hasStudentActor) {
      throw new Error('Audit trail missing verified token actors');
    }
    console.log('  ✓ Token actors verified in audit records (usr-ada, usr-alan).');

    // Verify audit trail immutability
    let immutabilityTriggered = false;
    try {
      mcpStore.purgeAuditRecord();
    } catch (err: any) {
      if (err.message.includes('immutable')) {
        immutabilityTriggered = true;
      }
    }
    if (!immutabilityTriggered) {
      throw new Error('Audit trail immutability protection failed');
    }
    console.log('  ✓ Audit trail immutability verified (UPDATE/DELETE strictly prohibited).');

    console.log('\n====================================================');
    console.log(' ALL MCP OAUTH, SCOPES & AUDIT CHECKS PASSED (100%) ');
    console.log('====================================================\n');
    process.exit(0);
  } finally {
    server.close();
  }
}

runMcpVerification().catch((err) => {
  console.error('\n❌ MCP Verification failed with error:', err);
  process.exit(1);
});

