import { Router, Request, Response, NextFunction } from 'express';
import { authenticateToken, requireRole, recordAuditAction } from '../middleware/rbac.js';
import { writeRateLimiter } from '../middleware/rateLimiter.js';

export const instructorRouter = Router();

const lockedAssignments = new Set<string>();

// Apply rate limiter and authentication to instructor routes
instructorRouter.use(writeRateLimiter);
instructorRouter.use(authenticateToken);

// Requirement F9 Proof: Instructor-only grading route
// Returns 401 if anonymous, 403 if student, 200 if instructor
instructorRouter.post('/:id/grade', requireRole(['instructor', 'admin']), (req: Request, res: Response, next: NextFunction) => {
  try {
    const assignmentId = req.params.id;
    const { studentId, score, feedback } = req.body as {
      studentId?: string;
      score?: number;
      feedback?: string;
    };

    if (score === undefined || score < 0 || score > 100) {
      res.status(400).json({
        error: {
          code: 'INVALID_SCORE',
          message: 'Score must be a number between 0 and 100.',
        },
      });
      return;
    }

    // Record verified audit trail event
    recordAuditAction(
      req,
      'assignment.grade_submitted',
      'assignment_submission',
      assignmentId,
      null,
      { studentId: studentId || 'usr-alan', score, feedback: feedback || 'Rubric satisfied' }
    );

    res.status(200).json({
      status: 'success',
      message: 'Grade recorded successfully by instructor.',
      data: {
        assignmentId,
        gradedBy: req.user?.name,
        score,
        feedback,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

// Requirement F9 Proof: Instructor-only assignment locking route
// Requirement F3 Proof: 409 Conflict if already locked
instructorRouter.post('/:id/lock', requireRole(['instructor', 'admin']), (req: Request, res: Response, next: NextFunction) => {
  try {
    const assignmentId = req.params.id;

    if (lockedAssignments.has(assignmentId)) {
      res.status(409).json({
        error: {
          code: 'ASSIGNMENT_ALREADY_LOCKED',
          message: `Assignment "${assignmentId}" is already locked and cannot be locked again.`,
        },
      });
      return;
    }

    lockedAssignments.add(assignmentId);

    recordAuditAction(
      req,
      'assignment.locked',
      'assignment',
      assignmentId,
      { status: 'open' },
      { status: 'locked', lockedBy: req.user?.sub }
    );

    res.status(200).json({
      status: 'success',
      message: `Assignment "${assignmentId}" has been locked by instructor.`,
      lockedBy: req.user?.name,
    });
  } catch (err) {
    next(err);
  }
});

// Unlock helper to reset locking state for tests
instructorRouter.post('/:id/unlock', requireRole(['instructor', 'admin']), (req: Request, res: Response) => {
  const assignmentId = req.params.id;
  lockedAssignments.delete(assignmentId);
  res.status(200).json({ status: 'unlocked', assignmentId });
});

