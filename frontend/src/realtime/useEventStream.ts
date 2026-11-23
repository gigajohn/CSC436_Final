import { useState, useEffect, useRef, useCallback } from 'react';

export type EventType =
  | 'submission.created'
  | 'submission.updated'
  | 'review.comment_added'
  | 'assignment.status_changed'
  | 'system.notification';

export interface AppEvent<T = Record<string, unknown>> {
  id: number;
  type: EventType;
  resourceId: string;
  timestamp: string;
  data: T;
}

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

export interface UseEventStreamResult {
  status: ConnectionStatus;
  events: AppEvent[];
  lastEventId: number;
  duplicatesSuppressed: number;
  reconnect: () => void;
  disconnect: () => void;
  clearEvents: () => void;
  simulateSubmission: (studentName: string, assignmentId: string) => Promise<void>;
  simulateComment: (submissionId: string, reviewerName: string, commentText: string) => Promise<void>;
}

export function useEventStream(streamUrl = '/api/v1/events/stream'): UseEventStreamResult {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [lastEventId, setLastEventId] = useState<number>(0);
  const [duplicatesSuppressed, setDuplicatesSuppressed] = useState<number>(0);

  const seenIdsRef = useRef<Set<number>>(new Set());
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastEventIdRef = useRef<number>(0);

  // Synchronize ref
  lastEventIdRef.current = lastEventId;

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    setStatus('connecting');

    // Build URL with query parameter fallback for Last-Event-ID
    const url = new URL(streamUrl, window.location.origin);
    if (lastEventIdRef.current > 0) {
      url.searchParams.set('lastEventId', lastEventIdRef.current.toString());
    }

    const es = new EventSource(url.toString());
    eventSourceRef.current = es;

    es.onopen = () => {
      setStatus('connected');
    };

    es.onerror = () => {
      setStatus('disconnected');
      es.close();
      // Auto-reconnect after 3 seconds
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, 3000);
    };

    // Generic message listener
    const handleIncomingMessage = (ev: MessageEvent) => {
      try {
        const payload = JSON.parse(ev.data) as AppEvent;
        if (!payload || typeof payload.id !== 'number') return;

        // Requirement F11: Deduplication logic
        if (seenIdsRef.current.has(payload.id)) {
          setDuplicatesSuppressed((prev) => prev + 1);
          console.warn(`[SSE Client] Deduplicated incoming event ID: ${payload.id}`);
          return;
        }

        // Add to bounded deduplication set (capacity: 1000)
        seenIdsRef.current.add(payload.id);
        if (seenIdsRef.current.size > 1000) {
          const oldest = seenIdsRef.current.values().next().value;
          if (oldest !== undefined) seenIdsRef.current.delete(oldest);
        }

        // Update high-water mark ID
        setLastEventId((prev) => Math.max(prev, payload.id));
        setEvents((prev) => [payload, ...prev].slice(0, 50));
      } catch {
        // Non-JSON comment/heartbeat lines
      }
    };

    es.addEventListener('submission.created', handleIncomingMessage);
    es.addEventListener('submission.updated', handleIncomingMessage);
    es.addEventListener('review.comment_added', handleIncomingMessage);
    es.addEventListener('assignment.status_changed', handleIncomingMessage);
    es.addEventListener('message', handleIncomingMessage);
  }, [streamUrl]);

  useEffect(() => {
    connect();
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect]);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    setStatus('disconnected');
  }, []);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  const simulateSubmission = useCallback(async (studentName: string, assignmentId: string) => {
    await fetch('/api/v1/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentName, assignmentId }),
    });
  }, []);

  const simulateComment = useCallback(async (submissionId: string, reviewerName: string, commentText: string) => {
    await fetch(`/api/v1/submissions/${submissionId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewerName,
        commentText,
        filePath: 'src/consensus/raft.go',
        lineNumber: 88,
        severity: 'issue',
      }),
    });
  }, []);

  return {
    status,
    events,
    lastEventId,
    duplicatesSuppressed,
    reconnect: connect,
    disconnect,
    clearEvents,
    simulateSubmission,
    simulateComment,
  };
}

