export interface SubmissionRecord {
  id: string;
  assignmentId: string;
  studentId: string;
  studentName: string;
  repositoryUrl: string;
  commitSha: string;
  status: 'submitted' | 'under_review' | 'reviewed';
  lineCount: number;
  submittedAt: string;
  rubricCategoryScores?: Record<string, number>;
}

export interface ReviewCommentRecord {
  id: string;
  submissionId: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  filePath: string;
  lineNumber: number;
  commentText: string;
  severity: 'suggestion' | 'issue' | 'blocker' | 'praise';
  createdAt: string;
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

class McpDataStore {
  private auditSequence = 0;
  private readonly submissions: Map<string, SubmissionRecord> = new Map();
  private readonly comments: ReviewCommentRecord[] = [];
  private readonly auditTrail: AuditRecord[] = [];

  constructor() {
    this.seedInitialData();
  }

  private seedInitialData(): void {
    const syntheticSubmissions: SubmissionRecord[] = [
      {
        id: 'sub-001',
        assignmentId: 'asg-001',
        studentId: 'usr-alan',
        studentName: 'Alan Turing',
        repositoryUrl: 'https://github.com/synthetic-student/csc436-kvstore',
        commitSha: 'a1b2c3d4e5f6',
        status: 'under_review',
        lineCount: 420,
        submittedAt: '2026-11-20T14:30:00Z',
        rubricCategoryScores: { correctness: 88, concurrency: 92, testCoverage: 95 },
      },
      {
        id: 'sub-002',
        assignmentId: 'asg-001',
        studentId: 'usr-margaret',
        studentName: 'Margaret Hamilton',
        repositoryUrl: 'https://github.com/synthetic-student/csc436-kvstore-fast',
        commitSha: 'f6e5d4c3b2a1',
        status: 'reviewed',
        lineCount: 380,
        submittedAt: '2026-11-19T10:15:00Z',
        rubricCategoryScores: { correctness: 100, concurrency: 100, testCoverage: 98 },
      },
      {
        id: 'sub-003',
        assignmentId: 'asg-002',
        studentId: 'usr-john',
        studentName: 'John von Neumann',
        repositoryUrl: 'https://github.com/synthetic-student/csc436-raft',
        commitSha: '7a8b9c0d1e2f',
        status: 'submitted',
        lineCount: 650,
        submittedAt: '2026-11-21T08:00:00Z',
        rubricCategoryScores: { correctness: 90, concurrency: 85, testCoverage: 80 },
      },
    ];

    for (const sub of syntheticSubmissions) {
      this.submissions.set(sub.id, sub);
    }

    this.comments.push(
      {
        id: 'cmt-init-01',
        submissionId: 'sub-001',
        authorId: 'usr-ada',
        authorName: 'Ada Lovelace',
        authorRole: 'instructor',
        filePath: 'src/storage/engine.go',
        lineNumber: 54,
        commentText: 'Good use of sync.RWMutex here for lock-free read concurrency.',
        severity: 'praise',
        createdAt: '2026-11-20T16:00:00Z',
      },
      {
        id: 'cmt-init-02',
        submissionId: 'sub-001',
        authorId: 'usr-grace',
        authorName: 'Grace Hopper',
        authorRole: 'reviewer',
        filePath: 'src/storage/wal.go',
        lineNumber: 112,
        commentText: 'Fsync should be bounded by buffer timeout to prevent thread starvation under heavy load.',
        severity: 'issue',
        createdAt: '2026-11-20T17:30:00Z',
      }
    );
  }

  // --- Submissions ---
  public listSubmissions(filter?: { assignmentId?: string; status?: string; search?: string }): SubmissionRecord[] {
    let result = Array.from(this.submissions.values());
    if (filter?.assignmentId) {
      result = result.filter((s) => s.assignmentId === filter.assignmentId);
    }
    if (filter?.status && filter.status !== 'all') {
      result = result.filter((s) => s.status === filter.status);
    }
    if (filter?.search) {
      const q = filter.search.toLowerCase();
      result = result.filter(
        (s) => s.studentName.toLowerCase().includes(q) || s.id.toLowerCase().includes(q) || s.commitSha.includes(q)
      );
    }
    return result;
  }

  public getSubmission(id: string): SubmissionRecord | undefined {
    return this.submissions.get(id);
  }

  // --- Comments ---
  public listComments(submissionId: string, filePath?: string): ReviewCommentRecord[] {
    let list = this.comments.filter((c) => c.submissionId === submissionId);
    if (filePath) {
      list = list.filter((c) => c.filePath === filePath);
    }
    return list;
  }

  public addComment(comment: Omit<ReviewCommentRecord, 'id' | 'createdAt'>): ReviewCommentRecord {
    const newComment: ReviewCommentRecord = {
      ...comment,
      id: `cmt-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      createdAt: new Date().toISOString(),
    };
    this.comments.push(newComment);
    return newComment;
  }

  // --- Append-Only Audit Trail (Requirement F6 & F12) ---
  public logAudit(record: Omit<AuditRecord, 'id' | 'created_at'>): AuditRecord {
    this.auditSequence += 1;
    const auditEntry: AuditRecord = {
      ...record,
      id: this.auditSequence,
      created_at: new Date().toISOString(),
    };
    this.auditTrail.push(auditEntry);
    return auditEntry;
  }

  public getAuditTrail(limit = 100): AuditRecord[] {
    return [...this.auditTrail].reverse().slice(0, limit);
  }

  /**
   * Enforces immutability: UPDATE and DELETE are strictly disallowed on the audit trail.
   */
  public purgeAuditRecord(): never {
    throw new Error('Audit trail records are immutable: UPDATE and DELETE operations are strictly prohibited.');
  }

  public resetForTesting(): void {
    this.auditSequence = 0;
    this.submissions.clear();
    this.comments.length = 0;
    this.auditTrail.length = 0;
    this.seedInitialData();
  }
}

export const mcpStore = new McpDataStore();

