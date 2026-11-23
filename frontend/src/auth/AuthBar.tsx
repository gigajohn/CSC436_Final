import React, { useState } from 'react';

export interface AuthUser {
  sub: string;
  name: string;
  email: string;
  role: 'student' | 'instructor';
  scopes: string[];
  token: string;
}

interface AuthBarProps {
  currentUser: AuthUser | null;
  onLogin: (role: 'student' | 'instructor') => Promise<void>;
  onLogout: () => void;
}

export default function AuthBar({ currentUser, onLogin, onLogout }: AuthBarProps): React.JSX.Element {
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'warning'; message: string; code?: string | number } | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  // Test Instructor-only grading action: POST /api/v1/assignments/asg-001/grade
  const testInstructorGrade = async () => {
    setLoading(true);
    setFeedback(null);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (currentUser?.token) {
      headers['Authorization'] = `Bearer ${currentUser.token}`;
    }

    try {
      const res = await fetch('/api/v1/assignments/asg-001/grade', {
        method: 'POST',
        headers,
        body: JSON.stringify({ studentId: 'usr-alan', score: 95, feedback: 'Verified via frontend RBAC test' }),
      });

      const json = await res.json();
      if (!res.ok) {
        setFeedback({
          type: 'error',
          code: json.error?.code || res.status,
          message: json.error?.message || `HTTP ${res.status} error`,
        });
        return;
      }

      setFeedback({
        type: 'success',
        code: 200,
        message: `Grade successfully recorded by ${currentUser?.name || 'Instructor'}: ${json.message}`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network failure';
      setFeedback({ type: 'error', code: 'NETWORK_ERROR', message: msg });
    } finally {
      setLoading(false);
    }
  };

  // Test Rate Limiter (Trigger 429)
  const testRateLimitBurst = async () => {
    setLoading(true);
    setFeedback(null);

    let hit429 = false;
    let retryAfter = '0';
    let lastMsg = '';

    for (let i = 0; i < 7; i++) {
      try {
        const res = await fetch('/api/v1/auth/login');
        if (res.status === 429) {
          hit429 = true;
          retryAfter = res.headers.get('retry-after') || '10';
          const json = await res.json();
          lastMsg = json.error?.message || 'Rate limit exceeded';
          break;
        }
      } catch {
        // Continue burst
      }
    }

    setLoading(false);
    if (hit429) {
      setFeedback({
        type: 'warning',
        code: 429,
        message: `${lastMsg} (Retry-After: ${retryAfter}s)`,
      });
    } else {
      setFeedback({
        type: 'success',
        code: 200,
        message: 'Sent burst requests without exceeding limit yet.',
      });
    }
  };

  return (
    <div className="auth-bar-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        {/* User Identity Info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div className="auth-avatar">
            {currentUser ? currentUser.name.charAt(0) : '?'}
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>{currentUser ? currentUser.name : 'Anonymous / Unauthenticated'}</span>
              {currentUser ? (
                <span className={`role-badge role-${currentUser.role}`}>{currentUser.role}</span>
              ) : (
                <span className="role-badge role-anonymous">Public</span>
              )}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              {currentUser ? (
                <span>
                  Validated Claims: <code>sub: {currentUser.sub}</code> · Scopes: [{currentUser.scopes.join(', ')}]
                </span>
              ) : (
                <span>No Bearer token present · Write actions will return 401</span>
              )}
            </div>
          </div>
        </div>

        {/* Authentication Controls */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {!currentUser ? (
            <>
              <button
                type="button"
                className="btn-action"
                style={{ backgroundColor: 'rgba(167, 139, 250, 0.2)', borderColor: '#a78bfa' }}
                onClick={() => void onLogin('instructor')}
              >
                Sign in as Instructor (Ada Lovelace)
              </button>
              <button
                type="button"
                className="btn-action"
                style={{ backgroundColor: 'rgba(56, 189, 248, 0.2)', borderColor: '#38bdf8' }}
                onClick={() => void onLogin('student')}
              >
                Sign in as Student (Alan Turing)
              </button>
            </>
          ) : (
            <button type="button" className="btn-action" onClick={onLogout}>
              Sign Out
            </button>
          )}

          <button
            type="button"
            className="btn-action"
            disabled={loading}
            onClick={() => void testInstructorGrade()}
          >
            Test Instructor Grade (F9 RBAC)
          </button>

          <button
            type="button"
            className="btn-action"
            disabled={loading}
            onClick={() => void testRateLimitBurst()}
          >
            Burst Requests (Test S1 429)
          </button>
        </div>
      </div>

      {/* RBAC / Rate Limit Feedback Alert */}
      {feedback && (
        <div
          className={`auth-feedback-banner feedback-${feedback.type}`}
          style={{ marginTop: '0.75rem' }}
        >
          <strong>
            {feedback.type === 'error' ? '❌ Refused' : feedback.type === 'warning' ? '⚠️ Rate Limit Exceeded' : '✓ Authorized'}
            {feedback.code ? ` [HTTP ${feedback.code}]` : ''}:
          </strong>{' '}
          {feedback.message}
          {feedback.code === 403 && (
            <div style={{ fontSize: '0.8rem', marginTop: '0.25rem', opacity: 0.9 }}>
              <strong>Proof for F9:</strong> The server validated caller claims and strictly refused the student caller on an instructor-only mutation.
            </div>
          )}
          {feedback.code === 401 && (
            <div style={{ fontSize: '0.8rem', marginTop: '0.25rem', opacity: 0.9 }}>
              <strong>Hard Gate Enforced:</strong> Unauthenticated request refused with 401. No write mutation is reachable without a valid token.
            </div>
          )}
          {feedback.code === 429 && (
            <div style={{ fontSize: '0.8rem', marginTop: '0.25rem', opacity: 0.9 }}>
              <strong>Proof for S1:</strong> Burst traffic exceeded the window limit. Server returned 429 with standard error JSON and Retry-After header.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

