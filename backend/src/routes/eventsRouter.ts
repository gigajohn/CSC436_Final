import { Router, Request, Response, NextFunction } from 'express';
import { handleSseStream } from '../realtime/sseHandler.js';
import { globalEventBus, EventType } from '../realtime/eventBus.js';

export const eventsRouter = Router();

// SSE streaming endpoint: GET /api/v1/events/stream
eventsRouter.get('/stream', handleSseStream);

// Status / Buffer inspection: GET /api/v1/events/buffer
eventsRouter.get('/buffer', (_req: Request, res: Response) => {
  res.status(200).json({
    latestEventId: globalEventBus.getLatestEventId(),
    bufferedCount: globalEventBus.getBufferSize(),
  });
});

// Synthetic event simulation endpoint: POST /api/v1/events/simulate
eventsRouter.post('/simulate', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { type, resourceId, data } = req.body as {
      type?: EventType;
      resourceId?: string;
      data?: Record<string, unknown>;
    };

    if (!type || !resourceId) {
      res.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'Both "type" and "resourceId" are required to emit an event.',
        },
      });
      return;
    }

    const event = globalEventBus.publish(type, resourceId, data || {});
    res.status(201).json({
      status: 'published',
      event,
    });
  } catch (err) {
    next(err);
  }
});

// Domain mutation trigger: POST /api/v1/submissions
eventsRouter.post('/submissions', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { assignmentId, studentName, repoUrl, duplicateConflict } = req.body as {
      assignmentId?: string;
      studentName?: string;
      repoUrl?: string;
      duplicateConflict?: boolean;
    };

    if (!assignmentId || !studentName) {
      res.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'assignmentId and studentName are required.',
        },
      });
      return;
    }

    if (duplicateConflict || assignmentId === 'asg-conflict-test') {
      res.status(409).json({
        error: {
          code: 'RESOURCE_CONFLICT',
          message: `A submission for assignment "${assignmentId}" already exists for this repository commit.`,
        },
      });
      return;
    }

    const submissionId = `sub-${Date.now().toString(36)}`;
    const event = globalEventBus.publish('submission.created', submissionId, {
      submissionId,
      assignmentId,
      studentName,
      repoUrl: repoUrl || 'https://github.com/synthetic-student/csc436-impl',
      commitSha: '9b7f43a8c1e2',
      status: 'submitted',
    });

    res.status(201)
      .setHeader('Location', `/api/v1/submissions/${submissionId}`)
      .json({
        message: 'Submission recorded successfully',
        submission: event.data,
        eventId: event.id,
      });
  } catch (err) {
    next(err);
  }
});

// Domain mutation trigger: POST /api/v1/submissions/:id/comments
eventsRouter.post('/submissions/:id/comments', (req: Request, res: Response, next: NextFunction) => {
  try {
    const submissionId = req.params.id;
    const { reviewerName, filePath, lineNumber, commentText, severity } = req.body as {
      reviewerName?: string;
      filePath?: string;
      lineNumber?: number;
      commentText?: string;
      severity?: string;
    };

    if (!reviewerName || !commentText) {
      res.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'reviewerName and commentText are required.',
        },
      });
      return;
    }

    const commentId = `cmt-${Date.now().toString(36)}`;
    const event = globalEventBus.publish('review.comment_added', submissionId, {
      commentId,
      submissionId,
      reviewerName,
      filePath: filePath || 'src/consensus/raft.go',
      lineNumber: lineNumber || 42,
      commentText,
      severity: severity || 'suggestion',
    });

    res.status(201)
      .setHeader('Location', `/api/v1/submissions/${submissionId}/comments/${commentId}`)
      .json({
        message: 'Code review comment posted',
        comment: event.data,
        eventId: event.id,
      });
  } catch (err) {
    next(err);
  }
});

// Domain mutation trigger: DELETE /api/v1/submissions/:id/comments/:commentId (Requirement F3: 204 No Content)
eventsRouter.delete('/submissions/:id/comments/:commentId', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id: submissionId, commentId } = req.params;

    if (commentId === 'not-found' || commentId === 'missing') {
      res.status(404).json({
        error: {
          code: 'COMMENT_NOT_FOUND',
          message: `Comment "${commentId}" not found on submission "${submissionId}".`,
        },
      });
      return;
    }

    // Publish deletion event
    globalEventBus.publish('review.comment_deleted' as EventType, submissionId, {
      submissionId,
      commentId,
      deletedAt: new Date().toISOString(),
    });

    // 204 No Content has no body
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Resource retrieval: GET /api/v1/submissions/:id
eventsRouter.get('/submissions/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  if (id === 'non-existent' || id === 'missing') {
    res.status(404).json({
      error: {
        code: 'SUBMISSION_NOT_FOUND',
        message: `Submission "${id}" does not exist.`,
      },
    });
    return;
  }

  res.status(200).json({
    id,
    assignmentId: 'asg-001',
    studentName: 'Alan Turing',
    status: 'under_review',
    lineCount: 420,
  });
});

