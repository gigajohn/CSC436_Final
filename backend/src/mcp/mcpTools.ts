import { AuthContext, assertRequiredScope, assertAuthorizedRole } from './mcpAuth.js';
import { mcpStore, SubmissionRecord, ReviewCommentRecord } from './mcpStore.js';
import { globalEventBus } from '../realtime/eventBus.js';

export interface McpToolDeclaration {
  name: string;
  description: string;
  requiredScope: string;
  requiresConfirmation: boolean;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
}

export const MCP_TOOLS: McpToolDeclaration[] = [
  {
    name: 'list_submissions',
    description: 'Searches and lists student code submissions with non-sensitive metadata, submission status, and line counts.',
    requiredScope: 'mcp:submissions.read',
    requiresConfirmation: false,
    inputSchema: {
      type: 'object',
      properties: {
        assignmentId: { type: 'string', description: 'Filter by assignment identifier (e.g. asg-001)' },
        status: { type: 'string', description: 'Filter by submission status', enum: ['all', 'submitted', 'under_review', 'reviewed'] },
        search: { type: 'string', description: 'Keyword search for student name or commit SHA' },
      },
    },
  },
  {
    name: 'get_submission_details',
    description: 'Retrieves complete metadata, rubric category scores, and review metrics for a specific student submission.',
    requiredScope: 'mcp:submissions.read',
    requiresConfirmation: false,
    inputSchema: {
      type: 'object',
      properties: {
        submissionId: { type: 'string', description: 'Unique identifier of the code submission (e.g. sub-001)' },
      },
      required: ['submissionId'],
    },
  },
  {
    name: 'list_review_comments',
    description: 'Returns line-by-line peer and instructor review comments for a given submission.',
    requiredScope: 'mcp:reviews.read',
    requiresConfirmation: false,
    inputSchema: {
      type: 'object',
      properties: {
        submissionId: { type: 'string', description: 'Target submission identifier' },
        filePath: { type: 'string', description: 'Optional source file path filter' },
      },
      required: ['submissionId'],
    },
  },
  {
    name: 'post_review_comment',
    description: 'Posts a formal rubric review comment on a student code submission. Requires explicit two-step confirmation (confirmed: true) and reviewer/instructor write authorization.',
    requiredScope: 'mcp:reviews.write',
    requiresConfirmation: true,
    inputSchema: {
      type: 'object',
      properties: {
        submissionId: { type: 'string', description: 'Target code submission ID' },
        filePath: { type: 'string', description: 'Relative source code path (e.g. src/engine.go)' },
        lineNumber: { type: 'number', description: 'Source code line number (positive integer)' },
        commentText: { type: 'string', description: 'Substantive feedback or rubric evaluation' },
        severity: { type: 'string', description: 'Comment severity level', enum: ['suggestion', 'issue', 'blocker', 'praise'] },
        confirmed: { type: 'boolean', description: 'Mandatory confirmation flag. If false or omitted, the action preview is returned without state mutation.' },
      },
      required: ['submissionId', 'filePath', 'lineNumber', 'commentText'],
    },
  },
];

export interface McpToolCallResult {
  tool: string;
  status: 'success' | 'pending_confirmation' | 'error';
  confirmationRequired?: boolean;
  message?: string;
  data?: unknown;
  pendingAction?: Record<string, unknown>;
}

export function executeMcpTool(
  toolName: string,
  args: Record<string, unknown>,
  auth: AuthContext
): McpToolCallResult {
  const toolDecl = MCP_TOOLS.find((t) => t.name === toolName);
  if (!toolDecl) {
    throw new Error(`MCP tool "${toolName}" is not registered on this server.`);
  }

  // 1. Enforce OAuth Scopes (Requirement F12 Gate)
  assertRequiredScope(auth, toolDecl.requiredScope);

  // 2. Dispatch Tool Handlers
  switch (toolName) {
    case 'list_submissions': {
      const submissions = mcpStore.listSubmissions({
        assignmentId: typeof args.assignmentId === 'string' ? args.assignmentId : undefined,
        status: typeof args.status === 'string' ? args.status : undefined,
        search: typeof args.search === 'string' ? args.search : undefined,
      });

      // Append-only audit logging
      mcpStore.logAudit({
        actor_id: auth.userId,
        actor_label: `${auth.name} (${auth.role})`,
        action: 'mcp:tool_call:list_submissions',
        resource_type: 'submission_list',
        resource_id: args.assignmentId ? String(args.assignmentId) : 'all',
        before_state: null,
        after_state: { resultsCount: submissions.length, filter: args },
      });

      return {
        tool: toolName,
        status: 'success',
        data: {
          total: submissions.length,
          submissions: submissions.map((s: SubmissionRecord) => ({
            id: s.id,
            assignmentId: s.assignmentId,
            studentName: s.studentName,
            status: s.status,
            commitSha: s.commitSha,
            lineCount: s.lineCount,
            submittedAt: s.submittedAt,
          })),
        },
      };
    }

    case 'get_submission_details': {
      const submissionId = String(args.submissionId || '');
      if (!submissionId) {
        throw new Error('Argument "submissionId" is required.');
      }
      const sub = mcpStore.getSubmission(submissionId);
      if (!sub) {
        throw new Error(`Submission "${submissionId}" was not found.`);
      }

      mcpStore.logAudit({
        actor_id: auth.userId,
        actor_label: `${auth.name} (${auth.role})`,
        action: 'mcp:tool_call:get_submission_details',
        resource_type: 'submission',
        resource_id: submissionId,
        before_state: null,
        after_state: { submissionId, status: sub.status },
      });

      return {
        tool: toolName,
        status: 'success',
        data: sub,
      };
    }

    case 'list_review_comments': {
      const submissionId = String(args.submissionId || '');
      if (!submissionId) {
        throw new Error('Argument "submissionId" is required.');
      }
      const filePath = typeof args.filePath === 'string' ? args.filePath : undefined;
      const comments = mcpStore.listComments(submissionId, filePath);

      mcpStore.logAudit({
        actor_id: auth.userId,
        actor_label: `${auth.name} (${auth.role})`,
        action: 'mcp:tool_call:list_review_comments',
        resource_type: 'submission_comments',
        resource_id: submissionId,
        before_state: null,
        after_state: { count: comments.length, filePath },
      });

      return {
        tool: toolName,
        status: 'success',
        data: {
          submissionId,
          count: comments.length,
          comments,
        },
      };
    }

    case 'post_review_comment': {
      // Role enforcement: only reviewer or instructor can post
      assertAuthorizedRole(auth, ['reviewer', 'instructor', 'admin']);

      const submissionId = String(args.submissionId || '');
      const filePath = String(args.filePath || '');
      const lineNumber = Number(args.lineNumber || 0);
      const commentText = String(args.commentText || '');
      const severity = (args.severity as ReviewCommentRecord['severity']) || 'suggestion';
      const isConfirmed = args.confirmed === true;

      if (!submissionId || !filePath || lineNumber <= 0 || !commentText) {
        throw new Error('submissionId, filePath, positive lineNumber, and commentText are required.');
      }

      const targetSub = mcpStore.getSubmission(submissionId);
      if (!targetSub) {
        throw new Error(`Target submission "${submissionId}" not found.`);
      }

      // Requirement F12: Two-Step Confirmation Gating
      // If not confirmed, return pending confirmation challenge without mutating database
      if (!isConfirmed) {
        mcpStore.logAudit({
          actor_id: auth.userId,
          actor_label: `${auth.name} (${auth.role})`,
          action: 'mcp:tool_call:post_review_comment:confirmation_requested',
          resource_type: 'submission',
          resource_id: submissionId,
          before_state: null,
          after_state: {
            confirmed: false,
            intendedComment: { submissionId, filePath, lineNumber, severity },
          },
        });

        return {
          tool: toolName,
          status: 'pending_confirmation',
          confirmationRequired: true,
          message:
            'Confirmation required: this mutating tool requires explicit two-step authorization. Re-invoke with confirmed: true to commit review comment.',
          pendingAction: {
            tool: toolName,
            submissionId,
            studentName: targetSub.studentName,
            filePath,
            lineNumber,
            severity,
            commentText,
          },
        };
      }

      // Execute confirmed mutation
      const newComment = mcpStore.addComment({
        submissionId,
        authorId: auth.userId,
        authorName: auth.name,
        authorRole: auth.role,
        filePath,
        lineNumber,
        commentText,
        severity,
      });

      // Emit real-time SSE update
      globalEventBus.publish('review.comment_added', submissionId, {
        commentId: newComment.id,
        submissionId,
        reviewerName: auth.name,
        filePath,
        lineNumber,
        commentText,
        severity,
      });

      // Append-only audit record (F6 & F12)
      mcpStore.logAudit({
        actor_id: auth.userId,
        actor_label: `${auth.name} (${auth.role})`,
        action: 'mcp:tool_call:post_review_comment:committed',
        resource_type: 'line_comment',
        resource_id: newComment.id,
        before_state: null,
        after_state: {
          confirmed: true,
          commentId: newComment.id,
          submissionId,
          filePath,
          lineNumber,
          severity,
        },
      });

      return {
        tool: toolName,
        status: 'success',
        message: 'Review comment posted successfully and audited.',
        data: newComment,
      };
    }

    default:
      throw new Error(`Handler for MCP tool "${toolName}" is not implemented.`);
  }
}

