import React, { useState, useEffect, useCallback } from 'react';
import { useEventStream } from './realtime/useEventStream';
import McpApp from './mcp/McpApp';
import AuthBar, { AuthUser } from './auth/AuthBar';
import CodeAnalysisView from './analysis/CodeAnalysisView';

export interface Assignment {
  id: string;
  title: string;
  course: string;
  dueDate: string;
  status: 'open' | 'upcoming' | 'closed';
  submissionsCount: number;
  pendingReviewsCount: number;
}

type SimulationMode = 'live' | 'loading' | 'empty' | 'error';

export default function App(): React.JSX.Element {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [activeMainView, setActiveMainView] = useState<'catalog' | 'mcp' | 'analysis'>('catalog');
  const [simulationMode, setSimulationMode] = useState<SimulationMode>('live');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [healthStatus, setHealthStatus] = useState<string>('checking...');

  // Real-time SSE stream hook (Requirement F11)
  const {
    status: sseStatus,
    events: liveEvents,
    lastEventId,
    duplicatesSuppressed,
    reconnect: sseReconnect,
    disconnect: sseDisconnect,
    clearEvents: sseClearEvents,
    simulateSubmission,
    simulateComment,
  } = useEventStream('/api/v1/events/stream');

  // Fetch real health status
  useEffect(() => {
    fetch('/healthz')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: { status: string }) => {
        setHealthStatus(data.status);
      })
      .catch(() => {
        setHealthStatus('unreachable');
      });
  }, []);

  // Fetch assignments with search and filter
  const fetchAssignments = useCallback(async () => {
    if (simulationMode === 'loading') {
      setLoading(true);
      setError(null);
      return;
    }
    if (simulationMode === 'empty') {
      setLoading(false);
      setAssignments([]);
      setError(null);
      return;
    }
    if (simulationMode === 'error') {
      setLoading(false);
      setError('Simulated upstream failure: Failed to fetch assignments [E_FORCED_ERROR].');
      setAssignments([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (searchTerm.trim()) params.set('search', searchTerm.trim());
      if (statusFilter !== 'all') params.set('status', statusFilter);

      const res = await fetch(`/api/assignments?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Server returned HTTP ${res.status}`);
      }
      const json = (await res.json()) as { data: Assignment[] };
      setAssignments(json.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown network failure';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [simulationMode, searchTerm, statusFilter]);

  useEffect(() => {
    void fetchAssignments();
  }, [fetchAssignments]);

  const handleLogin = useCallback(async (role: 'student' | 'instructor') => {
    try {
      // 1. Initiate OIDC Login with PKCE to obtain state & S256 challenge
      const loginRes = await fetch('/api/v1/auth/login');
      const loginData = await loginRes.json();
      const state = loginData.transaction.state;

      // 2. Complete single-use callback exchange
      const callbackRes = await fetch(`/api/v1/auth/callback?state=${state}&code=auth-code-${Date.now()}&role=${role}`);
      const callbackData = await callbackRes.json();

      if (callbackRes.ok && callbackData.accessToken) {
        setCurrentUser({
          sub: role === 'instructor' ? 'usr-ada' : 'usr-alan',
          name: role === 'instructor' ? 'Ada Lovelace' : 'Alan Turing',
          email: `${role}@synthetic.studysync.edu`,
          role,
          scopes: role === 'instructor'
            ? ['openid', 'assignments:read', 'assignments:write', 'grading:write']
            : ['openid', 'assignments:read'],
          token: callbackData.accessToken,
        });
      }
    } catch (err) {
      console.error('Failed to log in', err);
    }
  }, []);

  const handleLogout = useCallback(() => {
    setCurrentUser(null);
  }, []);

  return (
    <div className="container">
      {/* Header */}
      <header className="header">
        <div className="logo-group">
          <div className="logo-icon">SS</div>
          <div>
            <div className="logo-title">StudySync</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
            Backend API: <strong style={{ color: healthStatus === 'ok' ? 'var(--color-success)' : 'var(--color-danger)' }}>{healthStatus}</strong>
          </span>
          <span className="badge-public">Public Workspace</span>
        </div>
      </header>

      {/* Requirement F7, F8, F9, S1: OIDC Authentication & RBAC Bar */}
      <AuthBar currentUser={currentUser} onLogin={handleLogin} onLogout={handleLogout} />

      {/* Hero */}
      <section className="hero">
        <h1>Peer Code-Review & Assignment Workspace</h1>
        <p>
          Structured academic code reviews, rubric-based feedback, and continuous assignment tracking.
        </p>
      </section>

      {/* Primary Navigation Switcher */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '2rem' }}>
        <button
          type="button"
          className={`mcp-tab-btn ${activeMainView === 'catalog' ? 'active' : ''}`}
          style={{ padding: '0.6rem 1.25rem', fontSize: '0.95rem' }}
          onClick={() => setActiveMainView('catalog')}
        >
          📚 Workspace Catalog & Real-Time SSE (F1, F2, F11)
        </button>
        <button
          type="button"
          className={`mcp-tab-btn ${activeMainView === 'mcp' ? 'active' : ''}`}
          style={{ padding: '0.6rem 1.25rem', fontSize: '0.95rem' }}
          onClick={() => setActiveMainView('mcp')}
        >
          🤖 Interactive MCP App & OAuth Tools (F12, F13)
        </button>
        <button
          type="button"
          className={`mcp-tab-btn ${activeMainView === 'analysis' ? 'active' : ''}`}
          style={{ padding: '0.6rem 1.25rem', fontSize: '0.95rem' }}
          onClick={() => setActiveMainView('analysis')}
        >
          🔍 Third-Party Code Analysis (F10)
        </button>
      </div>

      {activeMainView === 'mcp' ? (
        <McpApp />
      ) : activeMainView === 'analysis' ? (
        <CodeAnalysisView />
      ) : (
        <>
          {/* Requirement F11: Live Real-Time Event Stream Panel */}
      <div className="realtime-panel">
        <div className="realtime-header">
          <div className="realtime-title">
            <span>Live Workspace Activity (SSE Event Bus)</span>
            <span className={`status-indicator status-${sseStatus}`}>
              <span className="status-dot" />
              {sseStatus}
            </span>
          </div>
          <div className="realtime-actions">
            <button
              type="button"
              className="btn-action"
              onClick={() => void simulateSubmission('Grace Hopper', 'asg-001')}
            >
              + Trigger Submission
            </button>
            <button
              type="button"
              className="btn-action"
              onClick={() => void simulateComment('sub-1', 'Ada Lovelace', 'Optimal locking in raft leader loop.')}
            >
              + Add Code Review Comment
            </button>
            {sseStatus === 'connected' ? (
              <button type="button" className="btn-action" onClick={sseDisconnect}>
                Disconnect SSE
              </button>
            ) : (
              <button type="button" className="btn-action" onClick={sseReconnect}>
                Reconnect (Replay Missed)
              </button>
            )}
            <button type="button" className="btn-action" onClick={sseClearEvents}>
              Clear Feed
            </button>
          </div>
        </div>

        <div className="realtime-stats">
          <span>High-Water Event ID: <strong>#{lastEventId}</strong></span>
          <span>Deduplicated Duplicates Suppressed: <strong>{duplicatesSuppressed}</strong></span>
          <span>Buffer Capacity: <strong>500 events</strong></span>
        </div>

        <div className="events-list">
          {liveEvents.length === 0 ? (
            <div className="event-empty-msg">
              Waiting for real-time events. Trigger a submission or comment above to see live updates.
            </div>
          ) : (
            liveEvents.map((ev) => (
              <div key={ev.id} className="event-item">
                <div>
                  <span
                    className={`event-type-badge ${
                      ev.type.includes('submission') ? 'badge-submission' : 'badge-review'
                    }`}
                  >
                    {ev.type}
                  </span>
                  <span>
                    {ev.type === 'submission.created'
                      ? `Student ${(ev.data as { studentName?: string }).studentName || 'Student'} submitted to ${ev.resourceId}`
                      : ev.type === 'review.comment_added'
                      ? `Reviewer ${(ev.data as { reviewerName?: string }).reviewerName || 'Reviewer'} commented: "${(ev.data as { commentText?: string }).commentText || ''}"`
                      : JSON.stringify(ev.data)}
                  </span>
                </div>
                <div style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>
                  ID #{ev.id} · {new Date(ev.timestamp).toLocaleTimeString()}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Requirement F2 Verification Simulator Bar */}
      <div className="simulator-panel">
        <div className="simulator-label">Requirement F2 State Simulator (Verification & Testing)</div>
        <div className="simulator-controls">
          <button
            type="button"
            className={`sim-btn ${simulationMode === 'live' ? 'active' : ''}`}
            onClick={() => setSimulationMode('live')}
          >
            Live Backend Fetch
          </button>
          <button
            type="button"
            className={`sim-btn ${simulationMode === 'loading' ? 'active' : ''}`}
            onClick={() => setSimulationMode('loading')}
          >
            Simulate Loading State
          </button>
          <button
            type="button"
            className={`sim-btn ${simulationMode === 'empty' ? 'active' : ''}`}
            onClick={() => setSimulationMode('empty')}
          >
            Simulate Empty State
          </button>
          <button
            type="button"
            className={`sim-btn ${simulationMode === 'error' ? 'active' : ''}`}
            onClick={() => setSimulationMode('error')}
          >
            Simulate Error State
          </button>
        </div>
      </div>

      {/* Search and Filters (F1 Requirement) */}
      <div className="search-filter-bar">
        <div className="search-input-wrapper">
          <input
            type="search"
            className="search-input"
            placeholder="Search assignments by title or course..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <select
          className="filter-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All Statuses</option>
          <option value="open">Open for Submissions</option>
          <option value="upcoming">Upcoming</option>
          <option value="closed">Closed / Archived</option>
        </select>
      </div>

      {/* State Renderings */}
      {loading && (
        <div className="state-box">
          <div className="spinner" />
          <h2 className="state-title">Loading Assignments</h2>
          <p className="state-desc">Connecting to StudySync backend and fetching assignment records...</p>
        </div>
      )}

      {!loading && error && (
        <div className="state-box error-box">
          <h2 className="state-title">Unable to Load Data</h2>
          <p className="state-desc">{error}</p>
          <button
            type="button"
            className="btn-retry"
            onClick={() => {
              setSimulationMode('live');
              void fetchAssignments();
            }}
          >
            Retry Request
          </button>
        </div>
      )}

      {!loading && !error && assignments.length === 0 && (
        <div className="state-box">
          <h2 className="state-title">No Assignments Found</h2>
          <p className="state-desc">
            No active assignments match your current search criteria or filter selection.
          </p>
          {(searchTerm || statusFilter !== 'all') && (
            <button
              type="button"
              className="btn-retry"
              onClick={() => {
                setSearchTerm('');
                setStatusFilter('all');
              }}
            >
              Clear Filters
            </button>
          )}
        </div>
      )}

      {!loading && !error && assignments.length > 0 && (
        <div className="assignment-grid">
          {assignments.map((item) => (
            <div key={item.id} className="assignment-card">
              <div className="card-course">{item.course}</div>
              <h2 className="card-title">{item.title}</h2>
              <div className="card-meta">
                <span className={`status-tag status-${item.status}`}>{item.status}</span>
                <span>Due: {new Date(item.dueDate).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}
        </>
      )}
    </div>
  );
}
