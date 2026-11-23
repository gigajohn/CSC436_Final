import { Request, Response } from 'express';
import { globalEventBus, AppEvent } from './eventBus.js';

/**
 * Handles incoming Server-Sent Events (SSE) connections.
 * Supports Last-Event-ID replay and periodic keep-alive heartbeats.
 */
export function handleSseStream(req: Request, res: Response): void {
  // Set SSE response headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable buffering in reverse proxies (e.g. Nginx)
  res.flushHeaders?.();

  // Helper to serialize and write an AppEvent in SSE format
  const writeEvent = (event: AppEvent) => {
    res.write(`id: ${event.id}\n`);
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // 1. Inspect Last-Event-ID for missed event replay
  const lastEventIdHeader = req.headers['last-event-id'];
  const lastEventIdQuery = req.query.lastEventId;
  const rawLastId = typeof lastEventIdHeader === 'string'
    ? lastEventIdHeader
    : typeof lastEventIdQuery === 'string'
    ? lastEventIdQuery
    : null;

  if (rawLastId !== null) {
    const lastId = parseInt(rawLastId, 10);
    if (!Number.isNaN(lastId) && lastId >= 0) {
      const missedEvents = globalEventBus.getEventsSince(lastId);
      for (const event of missedEvents) {
        writeEvent(event);
      }
    }
  }

  // Send an initial connected handshake comment
  res.write(`: connected (serverTime: ${new Date().toISOString()})\n\n`);

  // 2. Subscribe to live published events
  const unsubscribe = globalEventBus.subscribe((event: AppEvent) => {
    writeEvent(event);
  });

  // 3. Periodic keep-alive heartbeat (every 15 seconds)
  const heartbeatTimer = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 15000);

  // 4. Clean up subscriptions and timers on client disconnect
  req.on('close', () => {
    clearInterval(heartbeatTimer);
    unsubscribe();
  });
}

