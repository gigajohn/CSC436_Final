import http from 'node:http';
import { createApp } from '../app.js';
import { globalEventBus, AppEvent } from '../realtime/eventBus.js';

interface TestContext {
  server: http.Server;
  baseUrl: string;
  port: number;
}

async function startTestServer(): Promise<TestContext> {
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to obtain server address');
  }
  const port = address.port;
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    port,
  };
}

async function postJson(url: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${url} returned ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Client-Side Deduplicating Event Cache
 */
class ClientDeduplicator {
  private readonly seenIds = new Set<number>();
  private readonly maxCapacity: number;
  public duplicatesIgnored = 0;

  constructor(maxCapacity = 1000) {
    this.maxCapacity = maxCapacity;
  }

  public processEvent(event: AppEvent): boolean {
    if (this.seenIds.has(event.id)) {
      this.duplicatesIgnored += 1;
      return false; // Duplicate suppressed
    }
    this.seenIds.add(event.id);
    if (this.seenIds.size > this.maxCapacity) {
      const oldest = this.seenIds.values().next().value;
      if (oldest !== undefined) this.seenIds.delete(oldest);
    }
    return true; // Accepted new event
  }
}

async function runSseVerification() {
  console.log('====================================================');
  console.log(' StudySync SSE & Event Bus Verification (F11)      ');
  console.log('====================================================\n');

  // Reset event bus for test isolation
  globalEventBus.resetForTesting();
  const { server, baseUrl } = await startTestServer();

  try {
    const deduplicator = new ClientDeduplicator();

    // -------------------------------------------------------------------------
    // Phase 1: Connect SSE Client #1 and receive live event
    // -------------------------------------------------------------------------
    console.log('[1/4] Establishing active SSE connection...');
    const controller1 = new AbortController();
    const receivedClient1: AppEvent[] = [];

    const streamResponse1 = await fetch(`${baseUrl}/api/v1/events/stream`, {
      headers: { Accept: 'text/event-stream' },
      signal: controller1.signal,
    });

    if (!streamResponse1.ok || !streamResponse1.body) {
      throw new Error(`Failed to open SSE stream: ${streamResponse1.status}`);
    }

    const contentType = streamResponse1.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream')) {
      throw new Error(`Invalid content-type: ${contentType}`);
    }
    console.log(`  ✓ Connected to SSE stream with Content-Type: ${contentType}`);

    const reader1 = streamResponse1.body.getReader();
    const decoder = new TextDecoder();

    // Background reader loop
    const readPromise1 = (async () => {
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader1.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const messages = buffer.split('\n\n');
          buffer = messages.pop() || '';

          for (const msg of messages) {
            const lines = msg.split('\n');
            let dataLine = '';
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                dataLine = line.slice(6);
              }
            }
            if (dataLine) {
              try {
                const parsed = JSON.parse(dataLine) as AppEvent;
                if (deduplicator.processEvent(parsed)) {
                  receivedClient1.push(parsed);
                }
              } catch {
                // Ignore non-json comments
              }
            }
          }
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') throw err;
      }
    })();

    // Publish event #1 via domain mutation endpoint
    console.log('[2/4] Triggering mutation: POST /api/v1/submissions...');
    const subRes = await postJson(`${baseUrl}/api/v1/submissions`, {
      assignmentId: 'asg-001',
      studentName: 'Alan Turing',
      repoUrl: 'https://github.com/synthetic/raft-impl',
    });
    console.log(`  ✓ Mutation accepted, eventId: ${subRes.eventId}`);

    // Wait briefly for SSE message arrival
    await new Promise((r) => setTimeout(r, 200));

    if (receivedClient1.length !== 1 || receivedClient1[0].id !== 1) {
      throw new Error(`Expected event #1 to be received, got: ${JSON.stringify(receivedClient1)}`);
    }
    console.log(`  ✓ Client #1 received live event: [ID=${receivedClient1[0].id}, type=${receivedClient1[0].type}]`);

    // -------------------------------------------------------------------------
    // Phase 2: Simulate client disconnect & publish offline events
    // -------------------------------------------------------------------------
    console.log('\n[3/4] Simulating client disconnect / network drop...');
    controller1.abort();
    await readPromise1;
    console.log('  ✓ Client #1 disconnected.');

    console.log('  Emitting events #2 and #3 while client is offline...');
    const commentRes1 = await postJson(`${baseUrl}/api/v1/submissions/sub-1/comments`, {
      reviewerName: 'Grace Hopper',
      filePath: 'src/raft/leader.go',
      lineNumber: 112,
      commentText: 'Ensure term check precedes heartbeat acknowledgment.',
      severity: 'issue',
    });
    console.log(`  ✓ Emitted Event #2 [eventId=${commentRes1.eventId}]`);

    const commentRes2 = await postJson(`${baseUrl}/api/v1/submissions/sub-1/comments`, {
      reviewerName: 'Ada Lovelace',
      filePath: 'src/raft/state.go',
      lineNumber: 45,
      commentText: 'Clean lock acquisition pattern.',
      severity: 'praise',
    });
    console.log(`  ✓ Emitted Event #3 [eventId=${commentRes2.eventId}]`);

    // -------------------------------------------------------------------------
    // Phase 3: Reconnect with Last-Event-ID header and verify replay
    // -------------------------------------------------------------------------
    console.log('\n[4/4] Reconnecting with "Last-Event-ID: 1" header to test replay...');
    const controller2 = new AbortController();
    const receivedClient2: AppEvent[] = [];

    const streamResponse2 = await fetch(`${baseUrl}/api/v1/events/stream`, {
      headers: {
        Accept: 'text/event-stream',
        'Last-Event-ID': '1', // Sourced from client high-water mark
      },
      signal: controller2.signal,
    });

    if (!streamResponse2.ok || !streamResponse2.body) {
      throw new Error(`Failed to reconnect SSE stream: ${streamResponse2.status}`);
    }

    const reader2 = streamResponse2.body.getReader();
    const readPromise2 = (async () => {
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader2.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const messages = buffer.split('\n\n');
          buffer = messages.pop() || '';

          for (const msg of messages) {
            const lines = msg.split('\n');
            let dataLine = '';
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                dataLine = line.slice(6);
              }
            }
            if (dataLine) {
              try {
                const parsed = JSON.parse(dataLine) as AppEvent;
                if (deduplicator.processEvent(parsed)) {
                  receivedClient2.push(parsed);
                }
              } catch {
                // Ignore non-json comments
              }
            }
          }
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') throw err;
      }
    })();

    // Wait briefly for replay delivery
    await new Promise((r) => setTimeout(r, 250));
    controller2.abort();
    await readPromise2;

    console.log(`  ✓ Replayed events received on reconnect: ${receivedClient2.length}`);
    if (receivedClient2.length !== 2) {
      throw new Error(`Expected 2 replayed events (IDs 2 and 3), received: ${receivedClient2.length}`);
    }
    if (receivedClient2[0].id !== 2 || receivedClient2[1].id !== 3) {
      throw new Error(`Replay order mismatch: expected [2, 3], got [${receivedClient2.map((e) => e.id).join(', ')}]`);
    }
    console.log('  ✓ Replayed events verified in exact sequence: IDs 2 and 3');

    // -------------------------------------------------------------------------
    // Phase 4: Test Duplicate Event Suppression
    // -------------------------------------------------------------------------
    console.log('\nTesting client deduplication suppression...');
    const duplicateEvent: AppEvent = {
      id: 2, // Already processed
      type: 'review.comment_added',
      resourceId: 'sub-1',
      timestamp: new Date().toISOString(),
      data: { note: 'Duplicate transmission simulation' },
    };
    const wasAccepted = deduplicator.processEvent(duplicateEvent);
    if (wasAccepted) {
      throw new Error('Deduplicator failed: duplicate event ID was accepted!');
    }
    console.log(`  ✓ Duplicate event [ID=2] was correctly suppressed. (Suppressed count: ${deduplicator.duplicatesIgnored})`);

    console.log('\n====================================================');
    console.log(' ALL SSE STREAMING & REPLAY CHECKS PASSED (100%)    ');
    console.log('====================================================');
    process.exit(0);
  } finally {
    server.close();
  }
}

runSseVerification().catch((err) => {
  console.error('\n❌ Verification failed with error:', err);
  process.exit(1);
});
