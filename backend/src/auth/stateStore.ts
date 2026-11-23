export interface AuthTransactionState {
  state: string;
  codeVerifier: string;
  nonce: string;
  redirectUri: string;
  createdAt: number;
  expiresAt: number;
}

/**
 * Store for short-lived OIDC authorization transaction states.
 * Guarantees single-use consumption and automatic TTL expiration.
 */
export class AuthStateStore {
  private readonly store = new Map<string, AuthTransactionState>();
  private readonly defaultTtlSeconds: number;

  constructor(defaultTtlSeconds = 300) {
    this.defaultTtlSeconds = defaultTtlSeconds;
  }

  /**
   * Stores an authorization transaction with TTL.
   */
  public saveState(
    state: string,
    data: Omit<AuthTransactionState, 'state' | 'createdAt' | 'expiresAt'>,
    ttlSeconds = this.defaultTtlSeconds
  ): AuthTransactionState {
    const now = Date.now();
    const entry: AuthTransactionState = {
      ...data,
      state,
      createdAt: now,
      expiresAt: now + ttlSeconds * 1000,
    };
    this.store.set(state, entry);
    return entry;
  }

  /**
   * Atomically consumes and deletes a state (Single-use consumption).
   * Prevents replay attacks: the same state can never be reused.
   */
  public consumeState(state: string): AuthTransactionState | null {
    const entry = this.store.get(state);
    if (!entry) {
      return null;
    }

    // Always delete immediately upon retrieval to enforce single-use
    this.store.delete(state);

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      return null;
    }

    return entry;
  }

  /**
   * Returns current active state count.
   */
  public size(): number {
    this.purgeExpired();
    return this.store.size;
  }

  /**
   * Cleans up expired states.
   */
  public purgeExpired(): void {
    const now = Date.now();
    for (const [key, value] of this.store.entries()) {
      if (now > value.expiresAt) {
        this.store.delete(key);
      }
    }
  }

  public clear(): void {
    this.store.clear();
  }
}

export const authStateStore = new AuthStateStore();

