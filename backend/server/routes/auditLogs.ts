/**
 * Audit log routes — admin-only query interface.
 */

import express from 'express';

import { authenticateJWT, authorizeRoles, type AuthenticatedRequest } from '../../middleware/auth';
import type { AuditAction, AuditResourceType } from '../../models/AuditLog';
import { UserRole } from '../../models/UserRole';
import auditLogService from '../../services/auditLogService';
import { ok } from '../response';

const router = express.Router();

router.use(authenticateJWT, authorizeRoles(UserRole.ADMIN));

// GET /api/audit-logs — query audit logs with filters
router.get('/', async (_req: AuthenticatedRequest, res) => {
  const req = _req as AuthenticatedRequest & { query: Record<string, string> };
  const { actorId, action, resourceType, resourceId, startDate, endDate } = req.query;

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));

  const result = await auditLogService.query({
    actorId,
    action: action as AuditAction | undefined,
    resourceType: resourceType as AuditResourceType | undefined,
    resourceId,
    startDate,
    endDate,
    page,
    limit,
  });

  return res.json({
    ...ok(result.data),
    pagination: {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: result.totalPages,
      hasNext: result.page < result.totalPages,
      hasPrev: result.page > 1,
    },
  });
});

export default router;
