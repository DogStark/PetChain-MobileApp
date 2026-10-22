/**
 * Audit log model — captures important actions for compliance and traceability.
 */

export type AuditAction =
  | 'user.login'
  | 'user.logout'
  | 'user.created'
  | 'user.updated'
  | 'user.deleted'
  | 'pet.created'
  | 'pet.updated'
  | 'pet.deleted'
  | 'medical_record.created'
  | 'medical_record.updated'
  | 'medical_record.deleted'
  | 'medical_record.accessed'
  | 'appointment.created'
  | 'appointment.updated'
  | 'appointment.deleted'
  | 'medication.created'
  | 'medication.updated'
  | 'medication.deleted'
  // Access grant lifecycle
  | 'access_grant.created'
  | 'access_grant.revoked'
  | 'access_grant.renewed'
  | 'access_grant.expired'
  | 'access_grant.used'
  // RBAC permission decisions
  | 'rbac.access_denied'
  | 'rbac.access_granted'
  | 'rbac.token_invalid'
  | 'rbac.token_expired'
  | 'rbac.token_revoked'
  | (string & {});

export type AuditResourceType =
  | 'user'
  | 'pet'
  | 'medical_record'
  | 'appointment'
  | 'medication'
  | 'access_grant'
  | (string & {});

export type AuditOutcome = 'success' | 'denied' | 'error';

export interface AuditLog {
  id: string;
  actorId: string;
  actorEmail?: string;
  role?: string;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId?: string;
  meta?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  outcome: AuditOutcome;
  createdAt: string;
}

export interface AuditLogQuery {
  actorId?: string;
  action?: AuditAction;
  resourceType?: AuditResourceType;
  resourceId?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
  role?: string;
  outcome?: string;
}
