/**
 * Audit trail model interfaces and types.
 *
 * Note: the backend uses `pg` with SQL migrations; this file is intentionally
 * type-only so it can be shared across services/routes without ORM coupling.
 */

export type AuditTrailAction = 'CREATE' | 'UPDATE' | 'DELETE';
export type AuditTrailEntityType = 'pet' | 'medication' | 'appointment';

export interface AuditTrailRow {
  id: string;
  entityType: AuditTrailEntityType | string;
  entityId: string;
  action: AuditTrailAction;
  /**
   * Diff-shaped JSON: only changed keys for UPDATE; null for CREATE/DELETE when not applicable.
   */
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
  changedBy: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AuditTrailQuery {
  entityType?: string;
  entityId?: string;
  action?: AuditTrailAction;
  changedBy?: string;
  startDate?: string; // ISO
  endDate?: string; // ISO
  page?: number;
  limit?: number;
}
