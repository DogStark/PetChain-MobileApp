/**
 * Audit log middleware — attaches a helper to AuthenticatedRequest so any
 * route handler can emit an audit event with one line.
 *
 * Usage in a route:
 *   req.audit('pet.created', 'pet', newPet.id, { name: newPet.name });
 */

import type { NextFunction, Response } from 'express';

import type { AuthenticatedRequest } from './auth';
import type { AuditAction, AuditOutcome, AuditResourceType } from '../models/AuditLog';
import auditLogService from '../services/auditLogService';

export interface AuditableRequest extends AuthenticatedRequest {
  audit: (
    action: AuditAction,
    resourceType: AuditResourceType,
    resourceId?: string,
    meta?: Record<string, unknown>,
    outcome?: AuditOutcome,
  ) => void;
}

export function attachAudit(req: AuditableRequest, _res: Response, next: NextFunction): void {
  req.audit = (action, resourceType, resourceId, meta, outcome) => {
    if (!req.user) return;
    auditLogService.log({
      actorId: req.user.id,
      actorEmail: req.user.email,
      role: req.user.role,
      action,
      resourceType,
      resourceId,
      meta,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      outcome: outcome ?? 'success',
    });
  };
  next();
}
