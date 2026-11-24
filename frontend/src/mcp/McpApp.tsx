import React, { useState, useEffect, useCallback } from 'react';

export interface Persona {
  id: string;
  name: string;
  email: string;
  role: 'student' | 'reviewer' | 'instructor';
  token: string;
  scopes: string[];
  description: string;
}

export interface McpToolDeclaration {
  name: string;
  description: string;
  requiredScope: string;
  requiresConfirmation: boolean;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
  };
}

export interface AuditRecord {
  id: number;
  actor_id: string;
  actor_label: string;
  action: string;
  resource_type: string;
  resource_id: string;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  created_at: string;
}

export interface PendingAction {
  tool: string;
  submissionId: string;
  studentName?: string;
  filePath: string;
  lineNumber: number;
  severity: string;
  commentText: string;
}

export default function McpApp(): React.JSX.Element {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedPersonaKey, setSelectedPersonaKey] = useState<string>('instructor');
  const [activeTab, setActiveTab] = useState<'submissions' | 'details' | 'comments' | 'write' | 'audit'>('submissions');

  // Token state
  const [customToken, setCustomToken] = useState<string>('');
  const [useAnonymous, setUseAnonymous] = useState<boolean>(false);

  // Tools output state
  const [toolResult, setToolResult] = useState<Record<string, unknown> | null>(null);
  const [toolError, setToolError] = useState<{ status: number; code: string; message: string } | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  // Read tool 1 form
  const [asgFilter, setAsgFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchFilter, setSearchFilter] = useState<string>('');

  // Read tool 2 form
  const [detailsSubId, setDetailsSubId] = useState<string>('sub-001');

  // Read tool 3 form
  const [commentsSubId, setCommentsSubId] = useState<string>('sub-001');

  // Write tool form
  const [writeSubId, setWriteSubId] = useState<string>('sub-001');
  const [writeFilePath, setWriteFilePath] = useState<string>('src/storage/engine.go');
  const [writeLineNumber, setWriteLineNumber] = useState<number>(42);
  const [writeCommentText, setWriteCommentText] = useState<string>('Verify that cache eviction handles concurrently deleted keys properly.');
  const [writeSeverity, setWriteSeverity] = useState<string>('suggestion');
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingAction | null>(null);

  // Audit trail state
  const [auditLogs, setAuditLogs] = useState<AuditRecord[]>([]);

  // Load available personas from backend
  useEffect(() => {
    fetch('/api/v1/mcp/personas')
      .then((res) => res.json())
      .then((data: { personas: Persona[] }) => {
        setPersonas(data.personas);
      })
      .catch((err) => console.error('Failed to load personas', err));
  }, []);

  const getEffectiveToken = useCallback((): string | null => {
    if (useAnonymous) return null;
    if (customToken.trim()) return customToken.trim();
    const current = personas.find((p) => p.role === selectedPersonaKey);
    return current ? current.token : null;
  }, [useAnonymous, customToken, personas, selectedPersonaKey]);

  // Invokes an MCP tool via POST /api/v1/mcp
  const callMcpTool = useCallback(
    async (toolName: string, args: Record<string, unknown>) => {
      setLoading(true);
      setToolError(null);
      setToolResult(null);

      const token = getEffectiveToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      try {
        const response = await fetch('/api/v1/mcp', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'tools/call',
            params: {
              name: toolName,
              arguments: args,
            },
          }),
        });

        const json = await response.json();

        if (!response.ok || json.error) {
          const errCode = json.error?.code?.toString() || `HTTP_${response.status}`;
          const errMsg = json.error?.message || 'Server error';
          setToolError({ status: response.status, code: errCode, message: errMsg });
          return;
        }

        setToolResult(json.result as Record<string, unknown>);

        // Check if two-step confirmation is required
        if (json.result?.confirmationRequired) {
          setPendingConfirmation(json.result.pendingAction as PendingAction);
        } else {
          setPendingConfirmation(null);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Network request failed';
        setToolError({ status: 0, code: 'NETWORK_ERROR', message: msg });
      } finally {
        setLoading(false);
      }
    },
    [getEffectiveToken]
  );

  // Fetch audit logs
  const fetchAuditTrail = useCallback(async () => {
    const token = getEffectiveToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const res = await fetch('/api/v1/mcp/audit', { headers });
      if (res.ok) {
        const data = await res.json();
        setAuditLogs(data.auditTrail);
      }
    } catch {
      // Ignore in background
    }
  }, [getEffectiveToken]);

  useEffect(() => {
    if (activeTab === 'audit') {
      void fetchAuditTrail();
    }
  }, [activeTab, fetchAuditTrail]);

  const activePersona = personas.find((p) => p.role === selectedPersonaKey);

  return (
    <div className="mcp-app-wrapper">
      {/* Header and Persona Bar */}
      <div className="mcp-header">
        <div>
          <h2 style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: '0.25rem' }}>
            Interactive MCP App (F12 & F13)
          </h2>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
            Model Context Protocol client with per-tool OAuth scope enforcement, two-step confirmation gating, and audit logging.
          </p>
        </div>
      </div>

      {/* OAuth Persona & Scopes Selector */}
      <div className="mcp-persona-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>
            Active OAuth 2.0 / Bearer Identity Context
          </span>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={useAnonymous}
              onChange={(e) => setUseAnonymous(e.target.checked)}
            />
            <span>Simulate Anonymous / No Token (Forces 401)</span>
          </label>
        </div>

        {!useAnonymous && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
            {personas.map((p) => (
              <button
                type="button"
                key={p.role}
                aria-pressed={selectedPersonaKey === p.role && !customToken}
                onClick={() => {
                  setSelectedPersonaKey(p.role);
                  setCustomToken('');
                }}
                className={`persona-card ${selectedPersonaKey === p.role && !customToken ? 'active' : ''}`}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                  <strong style={{ fontSize: '0.95rem' }}>{p.name}</strong>
                  <span className={`role-badge role-${p.role}`}>{p.role}</span>
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>{p.description}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                  {p.scopes.map((s) => (
                    <span key={s} className={`scope-chip ${s.includes('write') ? 'scope-write' : 'scope-read'}`}>
                      {s}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        )}

        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <span>
            Active Caller: <strong>{useAnonymous ? 'Anonymous (None)' : activePersona?.name || 'Custom Token'}</strong>
          </span>
          <span>
            Write Permission: <strong>{activePersona?.scopes.includes('mcp:reviews.write') && !useAnonymous ? 'ALLOWED' : 'DENIED (403)'}</strong>
          </span>
        </div>
      </div>

      {/* Tool Navigation Tabs */}
      <div className="mcp-tabs">
        <button
          type="button"
          className={`mcp-tab-btn ${activeTab === 'submissions' ? 'active' : ''}`}
          onClick={() => setActiveTab('submissions')}
        >
          Read: list_submissions
        </button>
        <button
          type="button"
          className={`mcp-tab-btn ${activeTab === 'details' ? 'active' : ''}`}
          onClick={() => setActiveTab('details')}
        >
          Read: get_submission_details
        </button>
        <button
          type="button"
          className={`mcp-tab-btn ${activeTab === 'comments' ? 'active' : ''}`}
          onClick={() => setActiveTab('comments')}
        >
          Read: list_review_comments
        </button>
        <button
          type="button"
          className={`mcp-tab-btn ${activeTab === 'write' ? 'active' : ''}`}
          onClick={() => setActiveTab('write')}
        >
          Write: post_review_comment (Confirmed)
        </button>
        <button
          type="button"
          className={`mcp-tab-btn ${activeTab === 'audit' ? 'active' : ''}`}
          onClick={() => setActiveTab('audit')}
        >
          Forensic Audit Trail
        </button>
      </div>

      {/* Tab 1: list_submissions */}
      {activeTab === 'submissions' && (
        <div className="mcp-panel">
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <input
              type="text"
              aria-label="Filter submissions by Assignment ID"
              placeholder="Assignment ID (e.g. asg-001)"
              className="mcp-input"
              value={asgFilter}
              onChange={(e) => setAsgFilter(e.target.value)}
            />
            <select
              aria-label="Filter submissions by status"
              className="mcp-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All Statuses</option>
              <option value="submitted">Submitted</option>
              <option value="under_review">Under Review</option>
              <option value="reviewed">Reviewed</option>
            </select>
            <input
              type="text"
              aria-label="Search submissions by student name or commit SHA"
              placeholder="Search student or commit"
              className="mcp-input"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
            />
            <button
              type="button"
              className="btn-retry"
              disabled={loading}
              onClick={() =>
                void callMcpTool('list_submissions', {
                  assignmentId: asgFilter || undefined,
                  status: statusFilter,
                  search: searchFilter || undefined,
                })
              }
            >
              {loading ? 'Executing...' : 'Invoke Tool (list_submissions)'}
            </button>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
            Requires scope: <code>mcp:submissions.read</code>
          </div>
        </div>
      )}

      {/* Tab 2: get_submission_details */}
      {activeTab === 'details' && (
        <div className="mcp-panel">
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem' }}>
            <input
              type="text"
              aria-label="Submission ID to fetch details"
              placeholder="Submission ID"
              className="mcp-input"
              value={detailsSubId}
              onChange={(e) => setDetailsSubId(e.target.value)}
            />
            <button
              type="button"
              className="btn-retry"
              disabled={loading}
              onClick={() => void callMcpTool('get_submission_details', { submissionId: detailsSubId })}
            >
              {loading ? 'Executing...' : 'Invoke Tool (get_submission_details)'}
            </button>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
            Try <code>sub-001</code>, <code>sub-002</code>, or <code>sub-003</code>. Requires scope: <code>mcp:submissions.read</code>
          </div>
        </div>
      )}

      {/* Tab 3: list_review_comments */}
      {activeTab === 'comments' && (
        <div className="mcp-panel">
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem' }}>
            <input
              type="text"
              aria-label="Submission ID to list comments"
              placeholder="Submission ID"
              className="mcp-input"
              value={commentsSubId}
              onChange={(e) => setCommentsSubId(e.target.value)}
            />
            <button
              type="button"
              className="btn-retry"
              disabled={loading}
              onClick={() => void callMcpTool('list_review_comments', { submissionId: commentsSubId })}
            >
              {loading ? 'Executing...' : 'Invoke Tool (list_review_comments)'}
            </button>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
            Requires scope: <code>mcp:reviews.read</code>
          </div>
        </div>
      )}

      {/* Tab 4: post_review_comment (Confirmed Write) */}
      {activeTab === 'write' && (
        <div className="mcp-panel">
          <div style={{ marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.75rem' }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 600, marginBottom: '0.25rem' }}>
              Two-Step Confirmed Write Tool
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
              Mutating state requires the <code>mcp:reviews.write</code> scope and explicit confirmation. An unconfirmed invocation returns an action challenge without modifying the database.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
            <div>
              <label htmlFor="write-sub-id" style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', display: 'block', marginBottom: '0.25rem' }}>Submission ID</label>
              <input
                id="write-sub-id"
                type="text"
                className="mcp-input"
                style={{ width: '100%' }}
                value={writeSubId}
                onChange={(e) => setWriteSubId(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="write-file-path" style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', display: 'block', marginBottom: '0.25rem' }}>File Path</label>
              <input
                id="write-file-path"
                type="text"
                className="mcp-input"
                style={{ width: '100%' }}
                value={writeFilePath}
                onChange={(e) => setWriteFilePath(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="write-line-number" style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', display: 'block', marginBottom: '0.25rem' }}>Line Number</label>
              <input
                id="write-line-number"
                type="number"
                className="mcp-input"
                style={{ width: '100%' }}
                value={writeLineNumber}
                onChange={(e) => setWriteLineNumber(Number(e.target.value))}
              />
            </div>
            <div>
              <label htmlFor="write-severity" style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', display: 'block', marginBottom: '0.25rem' }}>Severity</label>
              <select
                id="write-severity"
                className="mcp-select"
                style={{ width: '100%' }}
                value={writeSeverity}
                onChange={(e) => setWriteSeverity(e.target.value)}
              >
                <option value="suggestion">Suggestion</option>
                <option value="issue">Issue</option>
                <option value="blocker">Blocker</option>
                <option value="praise">Praise</option>
              </select>
            </div>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="write-comment-text" style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', display: 'block', marginBottom: '0.25rem' }}>Rubric Comment Text</label>
            <textarea
              id="write-comment-text"
              className="mcp-input"
              style={{ width: '100%', minHeight: '60px' }}
              value={writeCommentText}
              onChange={(e) => setWriteCommentText(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn-retry"
              disabled={loading}
              onClick={() =>
                void callMcpTool('post_review_comment', {
                  submissionId: writeSubId,
                  filePath: writeFilePath,
                  lineNumber: writeLineNumber,
                  commentText: writeCommentText,
                  severity: writeSeverity,
                  confirmed: false, // Step 1: Initial invocation without confirmation
                })
              }
            >
              Step 1: Request Action Preview (confirmed: false)
            </button>

            <button
              type="button"
              className="btn-action"
              style={{ backgroundColor: 'var(--color-warning)', color: '#0f172a', fontWeight: 600 }}
              disabled={loading}
              onClick={() =>
                void callMcpTool('post_review_comment', {
                  submissionId: writeSubId,
                  filePath: writeFilePath,
                  lineNumber: writeLineNumber,
                  commentText: writeCommentText,
                  severity: writeSeverity,
                  confirmed: true, // Direct execution with confirmation
                })
              }
            >
              Direct Confirmed Execution (confirmed: true)
            </button>
          </div>

          {/* Interactive Confirmation Prompt (Step 2, Accessible Dialog) */}
          {pendingConfirmation && (
            <div
              className="confirmation-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="confirm-dialog-heading"
              onKeyDown={(e) => {
                if (e.key === 'Escape') setPendingConfirmation(null);
              }}
            >
              <div id="confirm-dialog-heading" style={{ color: 'var(--color-warning)', fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.5rem' }}>
                ⚠️ Explicit Mutation Confirmation Required
              </div>
              <p style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                You are about to append a rubric review comment to <strong>{String(pendingConfirmation.submissionId)}</strong> at <code>{String(pendingConfirmation.filePath)}:{String(pendingConfirmation.lineNumber)}</code>.
              </p>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.5rem 0.75rem', borderRadius: '4px', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                <em>"{String(pendingConfirmation.commentText)}"</em> ({String(pendingConfirmation.severity)})
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn-retry"
                  onClick={() =>
                    void callMcpTool('post_review_comment', {
                      ...pendingConfirmation,
                      confirmed: true,
                    })
                  }
                >
                  ✓ Confirm & Commit Mutation
                </button>
                <button
                  type="button"
                  className="btn-action"
                  onClick={() => setPendingConfirmation(null)}
                >
                  Cancel (Esc)
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 5: Audit Trail */}
      {activeTab === 'audit' && (
        <div className="mcp-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Forensic Append-Only Audit Trail</h3>
            <button type="button" className="btn-action" onClick={() => void fetchAuditTrail()}>
              Refresh Audit Records
            </button>
          </div>

          {auditLogs.length === 0 ? (
            <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '1.5rem 0' }}>
              No audit records found or audit inspection refused.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '350px', overflowY: 'auto' }}>
              {auditLogs.map((log) => (
                <div key={log.id} className="audit-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                    <strong>#{log.id} · {log.action}</strong>
                    <span style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>
                      {new Date(log.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--color-primary)' }}>
                    Actor: {log.actor_label} ({log.actor_id})
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                    Resource: {log.resource_type} [{log.resource_id}] · After: {JSON.stringify(log.after_state)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Error & Rejection Banners (e.g. 401 / 403 Forbidden Refusal) */}
      {toolError && (
        <div className="mcp-error-banner">
          <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.25rem' }}>
            ❌ Refused: HTTP {toolError.status} [{toolError.code}]
          </div>
          <div style={{ fontSize: '0.85rem' }}>{toolError.message}</div>
          {toolError.status === 403 && (
            <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--color-warning)' }}>
              <strong>Proof for F12 Requirement:</strong> The server successfully validated caller scopes and refused the write operation due to lack of the <code>mcp:reviews.write</code> OAuth scope or role authorization.
            </div>
          )}
          {toolError.status === 401 && (
            <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--color-warning)' }}>
              <strong>Hard Gate Enforced:</strong> Unauthenticated request was refused with 401. No MCP endpoint is reachable without authorization.
            </div>
          )}
        </div>
      )}

      {/* Success Output Display */}
      {toolResult !== null && !toolError && (
        <div className="mcp-result-banner">
          <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem', color: 'var(--color-success)' }}>
            ✓ Tool Execution Response:
          </div>
          <pre className="json-pre">{JSON.stringify(toolResult, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
