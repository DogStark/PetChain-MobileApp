import express from 'express';

import { authenticateJWT, type AuthenticatedRequest } from '../../middleware/auth';
import type { AuditTrailAction } from '../../models/AuditTrail';
import { UserRole } from '../../models/UserRole';
import { query } from '../../src/db';
import { ok, sendError } from '../response';
import { store } from '../store';

const router = express.Router();

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function ownerIdForEntity(entityType: string, entityId: string): Promise<string | null> {
  if (entityType === 'pet') {
    return store.pets.get(entityId)?.ownerId ?? null;
  }
  if (entityType === 'medication') {
    const med = store.medications.get(entityId);
    if (!med) return null;
    return store.pets.get(med.petId)?.ownerId ?? null;
  }
  if (entityType === 'appointment') {
    const appt = store.appointments.get(entityId);
    if (!appt) return null;
    return store.pets.get(appt.petId)?.ownerId ?? null;
  }
  return null;
}

function assertCanView(req: AuthenticatedRequest, ownerId: string | null): string | null {
  if (req.user?.role === UserRole.ADMIN) return null;
  if (!ownerId) return 'NOT_FOUND';
  if (req.user?.role === UserRole.OWNER && req.user.id !== ownerId) return 'FORBIDDEN';
  // Vets and other roles: default deny unless admin (can be expanded later)
  if (req.user?.role !== UserRole.OWNER) return 'FORBIDDEN';
  return null;
}

// GET /api/audit-trail?entityType=pet&entityId=... — owner-scoped history
router.get('/', authenticateJWT, async (req: AuthenticatedRequest, res) => {
  const q = req.query as Record<string, string | undefined>;
  const entityType = q.entityType?.trim();
  const entityId = q.entityId?.trim();

  if (!entityType || !entityId) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'entityType and entityId are required');
  }

  const ownerId = await ownerIdForEntity(entityType, entityId);
  const authErr = assertCanView(req, ownerId);
  if (authErr === 'NOT_FOUND') return sendError(res, 404, 'NOT_FOUND', 'Entity not found');
  if (authErr === 'FORBIDDEN')
    return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to view this audit log');

  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
  const offset = (page - 1) * limit;

  const action = q.action?.trim() as AuditTrailAction | undefined;

  const where: string[] = ['entity_type = $1', 'entity_id = $2'];
  const params: unknown[] = [entityType, entityId];
  if (action) {
    where.push(`action = $${params.length + 1}`);
    params.push(action);
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;

  const totalRes = await query(
    `SELECT COUNT(*)::int AS total FROM audit_trail ${whereSql}`,
    params,
  );
  const total = totalRes.rows[0]?.total ?? 0;
  const totalPages = Math.ceil(total / limit) || 1;

  const rowsRes = await query(
    `
      SELECT
        id,
        entity_type AS "entityType",
        entity_id AS "entityId",
        action,
        before_data AS "beforeData",
        after_data AS "afterData",
        changed_by AS "changedBy",
        ip_address AS "ipAddress",
        user_agent AS "userAgent",
        created_at AS "createdAt"
      FROM audit_trail
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
    `,
    [...params, limit, offset],
  );

  return res.json({
    ...ok(rowsRes.rows),
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  });
});

// GET /api/audit-trail/export?entityType=...&entityId=... — CSV export for compliance
router.get('/export', authenticateJWT, async (req: AuthenticatedRequest, res) => {
  const q = req.query as Record<string, string | undefined>;
  const entityType = q.entityType?.trim();
  const entityId = q.entityId?.trim();

  if (!entityType || !entityId) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'entityType and entityId are required');
  }

  const ownerId = await ownerIdForEntity(entityType, entityId);
  const authErr = assertCanView(req, ownerId);
  if (authErr === 'NOT_FOUND') return sendError(res, 404, 'NOT_FOUND', 'Entity not found');
  if (authErr === 'FORBIDDEN')
    return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to export this audit log');

  const rowsRes = await query(
    `
      SELECT
        created_at AS "createdAt",
        action,
        changed_by AS "changedBy",
        ip_address AS "ipAddress",
        user_agent AS "userAgent",
        before_data AS "beforeData",
        after_data AS "afterData"
      FROM audit_trail
      WHERE entity_type = $1 AND entity_id = $2
      ORDER BY created_at DESC
    `,
    [entityType, entityId],
  );

  const header = [
    'createdAt',
    'action',
    'changedBy',
    'ipAddress',
    'userAgent',
    'beforeData',
    'afterData',
  ];

  const lines = [
    header.join(','),
    ...rowsRes.rows.map((r) =>
      [
        csvEscape(r.createdAt),
        csvEscape(r.action),
        csvEscape(r.changedBy),
        csvEscape(r.ipAddress),
        csvEscape(r.userAgent),
        csvEscape(JSON.stringify(r.beforeData ?? null)),
        csvEscape(JSON.stringify(r.afterData ?? null)),
      ].join(','),
    ),
  ];

  const filename = `audit_${entityType}_${entityId}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.status(200).send(lines.join('\n'));
});

export default router;
