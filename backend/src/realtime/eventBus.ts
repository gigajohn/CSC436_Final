import { EventEmitter } from 'node:events';

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

export type EventListener = (event: AppEvent) => void;

export class EventBus {
  private currentId = 0;
  private readonly bufferCapacity: number;
  private readonly replayBuffer: AppEvent[] = [];
  private readonly emitter = new EventEmitter();

  constructor(bufferCapacity = 500) {
    this.bufferCapacity = bufferCapacity;
    this.emitter.setMaxListeners(100);
  }

  /**
   * Publishes an event to all connected subscribers and appends it to the circular replay buffer.
   */
  public publish<T extends Record<string, unknown>>(
    type: EventType,
    resourceId: string,
    data: T
  ): AppEvent<T> {
    this.currentId += 1;
    const event: AppEvent<T> = {
      id: this.currentId,
      type,
      resourceId,
      timestamp: new Date().toISOString(),
      data,
    };

    // Append to replay buffer
    this.replayBuffer.push(event as AppEvent);
    if (this.replayBuffer.length > this.bufferCapacity) {
      this.replayBuffer.shift();
    }

    // Broadcast in-memory (and can be hooked into Redis pub/sub if active)
    this.emitter.emit('event', event);

    return event;
  }

  /**
   * Returns all buffered events strictly newer than lastEventId, ordered by ID ascending.
   */
  public getEventsSince(lastEventId: number): AppEvent[] {
    if (Number.isNaN(lastEventId) || lastEventId < 0) {
      return [];
    }
    return this.replayBuffer.filter((event) => event.id > lastEventId);
  }

  /**
   * Subscribes to live published events.
   * @returns Unsubscribe function.
   */
  public subscribe(listener: EventListener): () => void {
    this.emitter.on('event', listener);
    return () => {
      this.emitter.off('event', listener);
    };
  }

  /**
   * Returns the current highest event sequence ID.
   */
  public getLatestEventId(): number {
    return this.currentId;
  }

  /**
   * Returns the number of events currently in the replay buffer.
   */
  public getBufferSize(): number {
    return this.replayBuffer.length;
  }

  /**
   * Resets sequence and buffer (primarily for isolated test fixtures).
   */
  public resetForTesting(): void {
    this.currentId = 0;
    this.replayBuffer.length = 0;
    this.emitter.removeAllListeners();
  }
}

// Singleton application event bus instance
export const globalEventBus = new EventBus();

