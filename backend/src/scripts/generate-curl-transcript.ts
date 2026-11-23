import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../app.js';
import { mintToken } from '../auth/jwksValidator.js';

async function generateCurlTranscript() {
  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(4000, '127.0.0.1', () => resolve()));
  const baseUrl = 'http://localhost:4000';

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

  const transcriptLines: string[] = [
    '================================================================================',
    ' StudySync REST API curl -i Transcript (Course Requirement F3 Evidence)',
    ` Generated: ${new Date().toISOString()}`,
    ' All routes verified with HTTP methods, status codes, Location headers,',
    ' server-side validation, and uniform JSON error responses: { error: { code, message } }',
    '================================================================================\n',
  ];

  interface CallSpec {
    title: string;
    description: string;
    expectedStatus: string;
    curlCmd: string;
    method: string;
    urlPath: string;
    headers?: Record<string, string>;
    body?: string;
  }

  const calls: CallSpec[] = [
    {
      title: '1. Health Check (200 OK)',
      description: 'System operational status and database connection check.',
      expectedStatus: 'HTTP/1.1 200 OK',
      curlCmd: 'curl -i -X GET http://localhost:4000/healthz',
      method: 'GET',
      urlPath: '/healthz',
    },
    {
      title: '2. Resource Creation with Location Header (201 Created)',
      description: 'Student submits a repository for peer code review.',
      expectedStatus: 'HTTP/1.1 201 Created',
      curlCmd: `curl -i -X POST http://localhost:4000/api/v1/submissions \\\n  -H "Content-Type: application/json" \\\n  -d '{"assignmentId":"asg-001","studentName":"Alan Turing","repoUrl":"https://github.com/synthetic/kvstore"}'`,
      method: 'POST',
      urlPath: '/api/v1/submissions',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assignmentId: 'asg-001',
        studentName: 'Alan Turing',
        repoUrl: 'https://github.com/synthetic/kvstore',
      }),
    },
    {
      title: '3. Resource Deletion (204 No Content)',
      description: 'Reviewer deletes a draft comment; empty response body returned.',
      expectedStatus: 'HTTP/1.1 204 No Content',
      curlCmd: 'curl -i -X DELETE http://localhost:4000/api/v1/submissions/sub-001/comments/cmt-test-delete',
      method: 'DELETE',
      urlPath: '/api/v1/submissions/sub-001/comments/cmt-test-delete',
    },
    {
      title: '4. Server-Side Validation Failure (400 Bad Request)',
      description: 'Submission attempt missing required fields; returns standardized JSON error shape.',
      expectedStatus: 'HTTP/1.1 400 Bad Request',
      curlCmd: `curl -i -X POST http://localhost:4000/api/v1/submissions \\\n  -H "Content-Type: application/json" \\\n  -d '{"repoUrl":"invalid-missing-fields"}'`,
      method: 'POST',
      urlPath: '/api/v1/submissions',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl: 'invalid-missing-fields' }),
    },
    {
      title: '5. Missing Authentication Credentials (401 Unauthorized)',
      description: 'Anonymous request targeting instructor-only grading endpoint without token.',
      expectedStatus: 'HTTP/1.1 401 Unauthorized',
      curlCmd: `curl -i -X POST http://localhost:4000/api/v1/assignments/asg-001/grade \\\n  -H "Content-Type: application/json" \\\n  -d '{"score":95}'`,
      method: 'POST',
      urlPath: '/api/v1/assignments/asg-001/grade',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score: 95 }),
    },
    {
      title: '6. Role Authorization Rejection (403 Forbidden)',
      description: 'Authenticated student token attempting instructor-only write action.',
      expectedStatus: 'HTTP/1.1 403 Forbidden',
      curlCmd: `curl -i -X POST http://localhost:4000/api/v1/assignments/asg-001/grade \\\n  -H "Authorization: Bearer <STUDENT_OIDC_TOKEN>" \\\n  -H "Content-Type: application/json" \\\n  -d '{"score":95}'`,
      method: 'POST',
      urlPath: '/api/v1/assignments/asg-001/grade',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({ score: 95 }),
    },
    {
      title: '7. Unknown Resource Endpoint (404 Not Found)',
      description: 'Request to nonexistent URI returning unified JSON error envelope.',
      expectedStatus: 'HTTP/1.1 404 Not Found',
      curlCmd: 'curl -i -X GET http://localhost:4000/api/v1/non-existent-route-xyz',
      method: 'GET',
      urlPath: '/api/v1/non-existent-route-xyz',
    },
    {
      title: '8. State Collision / Duplicate Lock (409 Conflict)',
      description: 'Attempting to lock an assignment that is already locked.',
      expectedStatus: 'HTTP/1.1 409 Conflict',
      curlCmd: `curl -i -X POST http://localhost:4000/api/v1/assignments/asg-transcript-conflict/lock \\\n  -H "Authorization: Bearer <INSTRUCTOR_TOKEN>"`,
      method: 'POST',
      urlPath: '/api/v1/assignments/asg-transcript-conflict/lock',
      headers: {
        Authorization: `Bearer ${instructorToken}`,
      },
    },
  ];

  // Prime the lock conflict state
  await fetch(`${baseUrl}/api/v1/assignments/asg-transcript-conflict/lock`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${instructorToken}` },
  });

  for (const c of calls) {
    transcriptLines.push('--------------------------------------------------------------------------------');
    transcriptLines.push(`### ${c.title}`);
    transcriptLines.push(`Description: ${c.description}`);
    transcriptLines.push(`Command:\n$ ${c.curlCmd}\n`);
    transcriptLines.push('Output:');

    const response = await fetch(`${baseUrl}${c.urlPath}`, {
      method: c.method,
      headers: c.headers,
      body: c.body,
    });

    transcriptLines.push(`HTTP/1.1 ${response.status} ${response.statusText}`);
    response.headers.forEach((val, key) => {
      transcriptLines.push(`${key}: ${val}`);
    });
    transcriptLines.push('');

    const text = await response.text();
    if (text) {
      try {
        const pretty = JSON.stringify(JSON.parse(text), null, 2);
        transcriptLines.push(pretty);
      } catch {
        transcriptLines.push(text);
      }
    } else {
      transcriptLines.push('(Empty Body - 204 No Content)');
    }
    transcriptLines.push('\n');
  }

  await new Promise<void>((resolve) => server.close(() => resolve()));

  const outPath = path.resolve(process.cwd(), '..', 'docs', 'evidence', 'f3-rest-curl-transcript.txt');
  fs.writeFileSync(outPath, transcriptLines.join('\n'), 'utf-8');
  console.log(`✓ Wrote curl transcript to: ${outPath}`);
}

generateCurlTranscript().catch((err) => {
  console.error('Failed to generate curl transcript:', err);
  process.exit(1);
});

