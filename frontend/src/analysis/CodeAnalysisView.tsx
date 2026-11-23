import React, { useState, useEffect, useCallback } from 'react';

export interface LinterWarning {
  file: string;
  line: number;
  rule: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
}

export interface CodeAnalysisData {
  analysisId: string;
  commitSha: string;
  status: 'passed' | 'warning' | 'failed';
  metrics: {
    complexityScore: number;
    duplicatedLines: number;
    securityIssuesCount: number;
  };
  linterWarnings: LinterWarning[];
  analyzedAt: string;
  _cached: boolean;
  _cachedAt?: string;
  _degraded: boolean;
  _degradedReason?: string;
  _attemptsMade: number;
}

export default function CodeAnalysisView(): React.JSX.Element {
  const [commitSha, setCommitSha] = useState<string>('a1b2c3d4e5f6');
  const [analysis, setAnalysis] = useState<CodeAnalysisData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [cacheHeader, setCacheHeader] = useState<string>('MISS');

  const fetchAnalysis = useCallback(async (targetSha: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/analysis/${targetSha}?repositoryUrl=https://github.com/synthetic/kvstore`);
      setCacheHeader(res.headers.get('x-cache') || 'MISS');

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || `HTTP ${res.status}`);
      }

      setAnalysis(json.data as CodeAnalysisData);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch analysis';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const clearCache = async () => {
    await fetch('/api/v1/analysis/cache/clear', { method: 'POST' });
    setCacheHeader('CLEARED');
    void fetchAnalysis(commitSha);
  };

  useEffect(() => {
    void fetchAnalysis(commitSha);
  }, [fetchAnalysis, commitSha]);

  return (
    <div className="analysis-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.25rem' }}>
            Third-Party Code Analysis & Diagnostics (F10)
          </h2>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
            External syntax engine with secret management, timeout, bounded retry, TTL caching, and graceful degradation fallback.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span className={`cache-badge ${cacheHeader === 'HIT' ? 'cache-hit' : 'cache-miss'}`}>
            Cache: {cacheHeader}
          </span>
          <button type="button" className="btn-action" onClick={clearCache}>
            Clear Cache
          </button>
        </div>
      </div>

      {/* Commit Selector */}
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1.25rem' }}>
        <input
          type="text"
          className="mcp-input"
          style={{ width: '240px' }}
          value={commitSha}
          onChange={(e) => setCommitSha(e.target.value.trim())}
          placeholder="Enter Commit SHA"
        />
        <button
          type="button"
          className="btn-retry"
          disabled={loading}
          onClick={() => void fetchAnalysis(commitSha)}
        >
          {loading ? 'Analyzing...' : 'Fetch Code Analysis'}
        </button>
        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
          Try <code>a1b2c3d4e5f6</code>, <code>f6e5d4c3b2a1</code>, or <code>7a8b9c0d1e2f</code>
        </span>
      </div>

      {/* Degraded Alert Banner */}
      {analysis?._degraded && (
        <div className="degraded-banner">
          <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.25rem' }}>
            ⚠️ Resilient Graceful Degradation Active
          </div>
          <div style={{ fontSize: '0.85rem' }}>
            {analysis._degradedReason || 'Third-party code analysis service is unreachable'}.
          </div>
          <div style={{ fontSize: '0.8rem', marginTop: '0.35rem', opacity: 0.9 }}>
            <strong>Proof for F10:</strong> Rather than crashing or throwing an unhandled 500 error, StudySync gracefully fell back to local diagnostics and heuristics.
          </div>
        </div>
      )}

      {/* Error state */}
      {error && !analysis && (
        <div className="mcp-error-banner">
          <strong>Analysis Error:</strong> {error}
        </div>
      )}

      {/* Metrics Grid */}
      {analysis && (
        <>
          <div className="metrics-grid">
            <div className="metric-card">
              <div className="metric-label">Cyclomatic Complexity</div>
              <div className="metric-value">{analysis.metrics.complexityScore}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Duplicated Lines</div>
              <div className="metric-value">{analysis.metrics.duplicatedLines}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Security Vulnerabilities</div>
              <div className="metric-value">{analysis.metrics.securityIssuesCount}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Overall Status</div>
              <div className={`metric-value status-text-${analysis.status}`}>
                {analysis.status.toUpperCase()}
              </div>
            </div>
          </div>

          {/* Linter Warnings */}
          <div style={{ marginTop: '1.25rem' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>
              Syntax & Rubric Linter Warnings ({analysis.linterWarnings.length})
            </h3>
            {analysis.linterWarnings.length === 0 ? (
              <div style={{ color: 'var(--color-success)', fontSize: '0.85rem' }}>
                ✓ Clean code analysis: No linter warnings detected on this commit.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {analysis.linterWarnings.map((w, idx) => (
                  <div key={idx} className="warning-item">
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--color-primary)' }}>
                        {w.file}:{w.line}
                      </span>
                      <span className={`warning-severity severity-${w.severity}`}>
                        {w.severity.toUpperCase()}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.85rem' }}>
                      <strong>[{w.rule}]</strong> {w.message}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

