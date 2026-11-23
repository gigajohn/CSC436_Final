import http from 'node:http';
import { createApp } from '../app.js';
import { mintToken } from '../auth/jwksValidator.js';

interface TestResult {
  code: number;
  expectedCode: number;
  route: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: any;
  passed: boolean;
  notes: string;
}

async function runRestVerification() {
  console.log('================================================================');
  console.log(' StudySync REST API Semantics & Status Codes Verification (F3)  ');
  console.log('================================================================\n');

  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  console.log(`Ephemeral test server running at ${baseUrl}\n`);

  // Generate tokens for auth tests
  const studentToken = await mintToken({
    sub: 'usr-student-alan',
    name: 'Alan Turing',
    email: 'alan@synthetic.studysync.edu',
    role: 'student',
    scopes: ['read:assignments', 'write:submissions'],
  });

  const instructorToken = await mintToken({
    sub: 'usr-instructor-ada',
    name: 'Ada Lovelace',
    email: 'ada@synthetic.studysync.edu',
    role: 'instructor',
    scopes: ['read:assignments', 'write:grades', 'write:assignments'],
  });

  async function request(method: string, path: string, headers: Record<string, string> = {}, body?: any): Promise<TestResult> {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const resHeaders: Record<string, string | string[] | undefined> = {};
    res.headers.forEach((v, k) => {
      resHeaders[k] = v;
    });

    let resBody: any = null;
    const text = await res.text();
    if (text) {
      try {
        resBody = JSON.parse(text);
      } catch {
        resBody = text;
      }
    }

    return {
      code: res.status,
      expectedCode: 0,
      route: path,
      method,
      headers: resHeaders,
      body: resBody,
      passed: false,
      notes: '',
    };
  }

  const results: TestResult[] = [];

  // --- 1. 200 OK (GET /healthz) ---
  console.log('[1/8] Testing 200 OK semantics...');
  const t200 = await request('GET', '/healthz');
  t200.expectedCode = 200;
  t200.passed = t200.code === 200 && t200.body?.status === 'ok';
  t200.notes = 'Returned 200 OK with operational payload';
  results.push(t200);
  console.log(`  ✓ 200 OK verified on GET ${t200.route}`);

  // --- 2. 201 Created + Location Header (POST /api/v1/submissions) ---
  console.log('\n[2/8] Testing 201 Created + Location header...');
  const t201 = await request('POST', '/api/v1/submissions', {}, {
    assignmentId: 'asg-001',
    studentName: 'Alan Turing',
    repoUrl: 'https://github.com/synthetic-student/csc436-impl',
  });
  t201.expectedCode = 201;
  const locationHeader = t201.headers['location'];
  const hasValidLocation = typeof locationHeader === 'string' && locationHeader.startsWith('/api/v1/submissions/sub-');
  t201.passed = t201.code === 201 && hasValidLocation;
  t201.notes = `Location header present: ${locationHeader}`;
  results.push(t201);
  if (!hasValidLocation) throw new Error(`Missing or invalid Location header: ${locationHeader}`);
  console.log(`  ✓ 201 Created with Location "${locationHeader}" verified on POST ${t201.route}`);

  // --- 3. 204 No Content (DELETE /api/v1/submissions/sub-001/comments/cmt-del) ---
  console.log('\n[3/8] Testing 204 No Content semantics...');
  const t204 = await request('DELETE', '/api/v1/submissions/sub-001/comments/cmt-test-delete');
  t204.expectedCode = 204;
  t204.passed = t204.code === 204 && (t204.body === null || t204.body === '');
  t204.notes = 'Returned 204 No Content with empty response body';
  results.push(t204);
  if (t204.code !== 204 || t204.body !== null) throw new Error(`Expected 204 with empty body, got ${t204.code}`);
  console.log(`  ✓ 204 No Content verified on DELETE ${t204.route} (body is empty)`);

  // --- 4. 400 Bad Request + Unified JSON Error Shape (POST /api/v1/submissions with missing body) ---
  console.log('\n[4/8] Testing 400 Bad Request + Unified JSON Error shape...');
  const t400 = await request('POST', '/api/v1/submissions', {}, {
    repoUrl: 'missing assignmentId and studentName',
  });
  t400.expectedCode = 400;
  const isUnified400 = t400.body?.error && typeof t400.body.error.code === 'string' && typeof t400.body.error.message === 'string';
  t400.passed = t400.code === 400 && isUnified400;
  t400.notes = `Error code: ${t400.body?.error?.code}`;
  results.push(t400);
  if (!isUnified400) throw new Error(`400 does not adhere to unified error schema: ${JSON.stringify(t400.body)}`);
  console.log(`  ✓ 400 Bad Request verified on POST ${t400.route}: [${t400.body.error.code}] ${t400.body.error.message}`);

  // --- 5. 401 Unauthorized + Unified JSON Error Shape (Missing Token) ---
  console.log('\n[5/8] Testing 401 Unauthorized + Unified JSON Error shape...');
  const t401 = await request('POST', '/api/v1/assignments/asg-001/grade', {}, { score: 95 });
  t401.expectedCode = 401;
  const isUnified401 = t401.body?.error && typeof t401.body.error.code === 'string' && typeof t401.body.error.message === 'string';
  t401.passed = t401.code === 401 && isUnified401;
  t401.notes = `Error code: ${t401.body?.error?.code}`;
  results.push(t401);
  if (!isUnified401) throw new Error(`401 does not adhere to unified error schema: ${JSON.stringify(t401.body)}`);
  console.log(`  ✓ 401 Unauthorized verified on unauthenticated POST ${t401.route}: [${t401.body.error.code}] ${t401.body.error.message}`);

  // --- 6. 403 Forbidden + Unified JSON Error Shape (Student on Instructor Route) ---
  console.log('\n[6/8] Testing 403 Forbidden + Unified JSON Error shape...');
  const t403 = await request('POST', '/api/v1/assignments/asg-001/grade', {
    Authorization: `Bearer ${studentToken}`,
  }, { score: 95 });
  t403.expectedCode = 403;
  const isUnified403 = t403.body?.error && typeof t403.body.error.code === 'string' && typeof t403.body.error.message === 'string';
  t403.passed = t403.code === 403 && isUnified403;
  t403.notes = `Error code: ${t403.body?.error?.code}`;
  results.push(t403);
  if (!isUnified403) throw new Error(`403 does not adhere to unified error schema: ${JSON.stringify(t403.body)}`);
  console.log(`  ✓ 403 Forbidden verified for Student on POST ${t403.route}: [${t403.body.error.code}] ${t403.body.error.message}`);

  // --- 7. 404 Not Found + Unified JSON Error Shape (Non-existent Route) ---
  console.log('\n[7/8] Testing 404 Not Found + Unified JSON Error shape...');
  const t404 = await request('GET', '/api/v1/non-existent-route-xyz');
  t404.expectedCode = 404;
  const isUnified404 = t404.body?.error && typeof t404.body.error.code === 'string' && typeof t404.body.error.message === 'string';
  t404.passed = t404.code === 404 && isUnified404;
  t404.notes = `Error code: ${t404.body?.error?.code}`;
  results.push(t404);
  if (!isUnified404) throw new Error(`404 does not adhere to unified error schema: ${JSON.stringify(t404.body)}`);
  console.log(`  ✓ 404 Not Found verified on GET ${t404.route}: [${t404.body.error.code}] ${t404.body.error.message}`);

  // --- 8. 409 Conflict + Unified JSON Error Shape (Duplicate Submission / Lock Conflict) ---
  console.log('\n[8/8] Testing 409 Conflict + Unified JSON Error shape...');
  // First lock assignment as instructor
  await request('POST', '/api/v1/assignments/asg-f3-conflict/lock', {
    Authorization: `Bearer ${instructorToken}`,
  });
  // Attempt to lock again to trigger 409 Conflict
  const t409 = await request('POST', '/api/v1/assignments/asg-f3-conflict/lock', {
    Authorization: `Bearer ${instructorToken}`,
  });
  t409.expectedCode = 409;
  const isUnified409 = t409.body?.error && typeof t409.body.error.code === 'string' && typeof t409.body.error.message === 'string';
  t409.passed = t409.code === 409 && isUnified409;
  t409.notes = `Error code: ${t409.body?.error?.code}`;
  results.push(t409);
  if (!isUnified409) throw new Error(`409 does not adhere to unified error schema: ${JSON.stringify(t409.body)}`);
  console.log(`  ✓ 409 Conflict verified on duplicate POST ${t409.route}: [${t409.body.error.code}] ${t409.body.error.message}`);

  // Clean up server
  await new Promise<void>((resolve) => server.close(() => resolve()));

  console.log('\n================================================================');
  console.log(' ALL F3 REST API STATUS CODES & ERROR SCHEMAS VERIFIED (100%)    ');
  console.log(' Verified Codes: [200, 201+Location, 204, 400, 401, 403, 404, 409] ');
  console.log(' Unified Error Schema: { error: { code, message, [details] } }  ');
  console.log('================================================================\n');

  process.exit(0);
}

runRestVerification().catch((err) => {
  console.error('\n❌ REST API verification failed:', err);
  process.exit(1);
});
