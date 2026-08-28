/**
 * Audit log service — records and queries important system actions.
 * Uses in-memory store (mirrors existing pattern); swap for DB repository when going live.
 */

import { randomUUID } from 'crypto';

import type {
  AuditAction,
  AuditLog,
  AuditLogQuery,
  AuditOutcome,
  AuditResourceType,
} from '../models/AuditLog';
import { query as dbQuery } from '../src/db';

const logs: AuditLog[] = [];

export interface LogParams {
  actorId: string;
  actorEmail?: string;
  role?: string;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId?: string;
  meta?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  outcome?: AuditOutcome;
}

/**
 * Record an audit event. Fire-and-forget — never throws.
 */
function log(params: LogParams): void {
  const entry: AuditLog = {
    id: randomUUID(),
    actorId: params.actorId,
    actorEmail: params.actorEmail,
    role: params.role,
    action: params.action,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    meta: params.meta,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    outcome: params.outcome ?? 'success',
    createdAt: new Date().toISOString(),
  };

  logs.push(entry);

  try {
    void dbQuery(
      `INSERT INTO audit_logs
         (id, user_id, action, resource_type, resource_id, ip_address, user_agent, metadata, actor_email, role, outcome)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        entry.id,
        entry.actorId,
        entry.action,
        entry.resourceType,
        entry.resourceId,
        entry.ipAddress,
        entry.userAgent,
        entry.meta ? JSON.stringify(entry.meta) : null,
        entry.actorEmail || null,
        entry.role || null,
        entry.outcome,
      ],
    );
  } catch {
    // Audit logging must never break the main request flow
  }
}

/**
 * Query audit logs with optional filters and pagination.
 */
async function query(q: AuditLogQuery = {}): Promise<{
  data: AuditLog[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  const page = Math.max(1, q.page ?? 1);
  const limit = Math.min(200, Math.max(1, q.limit ?? 50));

  const conditions: string[] = [];
  const values: unknown[] = [];

  if (q.actorId) {
    values.push(q.actorId);
    conditions.push(`user_id = $${values.length}`);
  }
  if (q.action) {
    values.push(q.action);
    conditions.push(`action = $${values.length}`);
  }
  if (q.resourceType) {
    values.push(q.resourceType);
    conditions.push(`resource_type = $${values.length}`);
  }
  if (q.resourceId) {
    values.push(q.resourceId);
    conditions.push(`resource_id = $${values.length}`);
  }
  if (q.role) {
    values.push(q.role);
    conditions.push(`role = $${values.length}`);
  }
  if (q.outcome) {
    values.push(q.outcome);
    conditions.push(`outcome = $${values.length}`);
  }
  if (q.startDate) {
    values.push(q.startDate);
    conditions.push(`created_at >= $${values.length}`);
  }
  if (q.endDate) {
    values.push(q.endDate);
    conditions.push(`created_at <= $${values.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const totalResult = await dbQuery(
    `SELECT COUNT(*)::int AS count FROM audit_logs ${whereClause}`,
    values,
  );
  const total = totalResult.rows[0]?.count ?? 0;
  const totalPages = Math.ceil(total / limit) || 1;

  const offset = (page - 1) * limit;
  const dataResult = await dbQuery(
    `SELECT id, user_id, actor_email, role, action, resource_type, resource_id, metadata, ip_address, user_agent, outcome, created_at
     FROM audit_logs
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit, offset],
  );

  const data = dataResult.rows.map((row) => ({
    id: row.id,
    actorId: row.user_id,
    actorEmail: row.actor_email ?? undefined,
    role: row.role ?? undefined,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id ?? undefined,
    meta: row.metadata ?? undefined,
    ipAddress: row.ip_address ?? undefined,
    userAgent: row.user_agent ?? undefined,
    outcome: row.outcome,
    createdAt: row.created_at.toISOString(),
  }));

  return { data, total, page, limit, totalPages };
}

export default { log, query };
