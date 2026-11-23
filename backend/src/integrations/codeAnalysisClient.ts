import { z } from 'zod';

// Runtime Zod Schema for Third-Party Analysis Response (Requirement F10)
export const LinterWarningSchema = z.object({
  file: z.string(),
  line: z.number().int().nonnegative(),
  rule: z.string(),
  message: z.string(),
  severity: z.enum(['info', 'warning', 'error']),
});

export const CodeMetricsSchema = z.object({
  complexityScore: z.number().nonnegative(),
  duplicatedLines: z.number().int().nonnegative(),
  securityIssuesCount: z.number().int().nonnegative(),
});

export const CodeAnalysisResponseSchema = z.object({
  analysisId: z.string(),
  commitSha: z.string(),
  status: z.enum(['passed', 'warning', 'failed']),
  metrics: CodeMetricsSchema,
  linterWarnings: z.array(LinterWarningSchema),
  analyzedAt: z.string(),
});

export type CodeAnalysisResponse = z.infer<typeof CodeAnalysisResponseSchema>;

export interface AnalysisClientResult extends CodeAnalysisResponse {
  _cached: boolean;
  _cachedAt?: string;
  _degraded: boolean;
  _degradedReason?: string;
  _attemptsMade: number;
}

interface CacheEntry {
  data: CodeAnalysisResponse;
  expiresAt: number;
  cachedAt: string;
}

export interface ClientConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  cacheTtlSeconds: number;
}

export class CodeAnalysisClient {
  private readonly config: ClientConfig;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(customConfig: Partial<ClientConfig> = {}) {
    this.config = {
      baseUrl: customConfig.baseUrl || process.env.CODE_ANALYSIS_API_URL || 'https://api.codepulse.synthetic.io/v1',
      apiKey: customConfig.apiKey || process.env.CODE_ANALYSIS_API_KEY || 'sk_synthetic_code_analysis_secret_key_v1',
      timeoutMs: customConfig.timeoutMs ?? 2000,
      maxRetries: customConfig.maxRetries ?? 3,
      retryBaseDelayMs: customConfig.retryBaseDelayMs ?? 100,
      cacheTtlSeconds: customConfig.cacheTtlSeconds ?? 300,
    };
  }

  /**
   * Fetches code analysis with timeout, exponential retry, caching, Zod validation, and graceful degradation.
   */
  public async analyzeCommit(repositoryUrl: string, commitSha: string): Promise<AnalysisClientResult> {
    const cacheKey = `${repositoryUrl}:${commitSha}`;
    const now = Date.now();

    // 1. Check Cache (Respects provider rate limits)
    const cached = this.cache.get(cacheKey);
    if (cached && now < cached.expiresAt) {
      return {
        ...cached.data,
        _cached: true,
        _cachedAt: cached.cachedAt,
        _degraded: false,
        _attemptsMade: 0,
      };
    }

    // 2. Outbound Request with Timeout and Bounded Retries
    let lastError: Error | null = null;
    let attemptsMade = 0;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      attemptsMade = attempt;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

      try {
        const response = await fetch(`${this.config.baseUrl}/analyze`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': this.config.apiKey, // Secret from config/store
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            repositoryUrl,
            commitSha,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Don't retry permanent client errors (4xx except 429)
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          const errText = await response.text();
          throw new Error(`Provider returned permanent error HTTP ${response.status}: ${errText}`);
        }

        // Retry on 5xx or 429
        if (!response.ok) {
          throw new Error(`Provider returned transient status HTTP ${response.status}`);
        }

        const rawJson: unknown = await response.json();

        // 3. Runtime Validation using Zod
        const validated = CodeAnalysisResponseSchema.parse(rawJson);

        // 4. Save to Cache
        this.cache.set(cacheKey, {
          data: validated,
          expiresAt: Date.now() + this.config.cacheTtlSeconds * 1000,
          cachedAt: new Date().toISOString(),
        });

        return {
          ...validated,
          _cached: false,
          _degraded: false,
          _attemptsMade: attemptsMade,
        };
      } catch (err: unknown) {
        clearTimeout(timeoutId);

        const isAbort = (err as any)?.name === 'AbortError';
        const errorMessage = isAbort
          ? `Request timed out after ${this.config.timeoutMs}ms`
          : err instanceof Error
          ? err.message
          : 'Unknown network error';

        lastError = new Error(errorMessage);

        // If we haven't exhausted maxRetries, apply exponential backoff delay
        if (attempt < this.config.maxRetries) {
          const delay = Math.min(1000, this.config.retryBaseDelayMs * Math.pow(2, attempt - 1));
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // 5. Graceful Degradation Fallback (Requirement F10 Proof)
    // When the external provider is down, timed out, or returning 5xx after retries:
    // return synthetic baseline heuristics without crashing the server.
    return this.createDegradedFallback(commitSha, lastError?.message || 'Provider unreachable', attemptsMade);
  }

  /**
   * Generates a graceful fallback payload when third-party provider fails.
   */
  public createDegradedFallback(
    commitSha: string,
    reason: string,
    attemptsMade: number
  ): AnalysisClientResult {
    return {
      analysisId: `degraded-${Date.now().toString(36)}`,
      commitSha,
      status: 'warning',
      metrics: {
        complexityScore: 10,
        duplicatedLines: 0,
        securityIssuesCount: 0,
      },
      linterWarnings: [
        {
          file: 'system/diagnostic',
          line: 1,
          rule: 'THIRD_PARTY_DEGRADED',
          message: `External Code Analysis provider is currently degraded: ${reason}. Showing local fallback heuristics.`,
          severity: 'warning',
        },
      ],
      analyzedAt: new Date().toISOString(),
      _cached: false,
      _degraded: true,
      _degradedReason: reason,
      _attemptsMade: attemptsMade,
    };
  }

  public clearCache(): void {
    this.cache.clear();
  }

  public getCacheSize(): number {
    return this.cache.size;
  }
}

export const codeAnalysisClient = new CodeAnalysisClient();

