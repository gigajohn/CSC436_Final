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
    const { assignmentId, studentName, repoUrl } = req.body as {
      assignmentId?: string;
      studentName?: string;
      repoUrl?: string;
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

    const submissionId = `sub-${Date.now().toString(36)}`;
    const event = globalEventBus.publish('submission.created', submissionId, {
      submissionId,
      assignmentId,
      studentName,
      repoUrl: repoUrl || 'https://github.com/synthetic-student/csc436-impl',
      commitSha: '9b7f43a8c1e2',
      status: 'submitted',
    });

    res.status(201).json({
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

    res.status(201).json({
      message: 'Code review comment posted',
      comment: event.data,
      eventId: event.id,
    });
  } catch (err) {
    next(err);
  }
});

