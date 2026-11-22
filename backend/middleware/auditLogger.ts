import { randomUUID } from 'crypto';

import type { AuthenticatedRequest } from './auth';
import type { AuditTrailAction, AuditTrailEntityType } from '../models/AuditTrail';
import { store } from '../server/store';
import familySharingService, { type SharedAccessContext } from '../services/familySharingService';
import { query } from '../src/db';

type JsonRecord = Record<string, unknown>;

function isPlainObject(v: unknown): v is JsonRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Build a shallow key diff.
 * - For CREATE: before=null, after=full
 * - For DELETE: before=full, after=null
 * - For UPDATE: before/after only contain changed keys
 */
export function buildAuditDiff(
  action: AuditTrailAction,
  before: unknown,
  after: unknown,
): { beforeData: JsonRecord | null; afterData: JsonRecord | null } {
  if (action === 'CREATE') {
    return { beforeData: null, afterData: isPlainObject(after) ? after : { value: after } };
  }
  if (action === 'DELETE') {
    return { beforeData: isPlainObject(before) ? before : { value: before }, afterData: null };
  }

  const b = isPlainObject(before) ? before : {};
  const a = isPlainObject(after) ? after : {};

  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const beforeData: JsonRecord = {};
  const afterData: JsonRecord = {};

  for (const k of keys) {
    const bv = b[k];
    const av = a[k];
    if (JSON.stringify(bv) !== JSON.stringify(av)) {
      beforeData[k] = bv;
      afterData[k] = av;
    }
  }

  return {
    beforeData: Object.keys(beforeData).length ? beforeData : null,
    afterData: Object.keys(afterData).length ? afterData : null,
  };
}

function actorIdFromReq(req: AuthenticatedRequest): string | null {
  return req.user?.id ?? null;
}

/**
 * Append an audit trail row to the DB.
 * This function must never throw (audit should not break the request flow).
 */
/**
 * Resolves the pet behind an audited entity and, when the actor is a co-owner
 * acting through a family-sharing grant, returns the attribution (#1398).
 */
function sharedAccessFor(
  entityType: string,
  entityId: string,
  actorId: string | null,
): SharedAccessContext | null {
  if (!actorId) return null;
  try {
    let petId: string | undefined;
    if (entityType === 'pet') petId = entityId;
    else if (entityType === 'medication') petId = store.medications.get(entityId)?.petId;
    else if (entityType === 'appointment') petId = store.appointments.get(entityId)?.petId;
    if (!petId) return null;
    const ownerId = store.pets.get(petId)?.ownerId;
    return familySharingService.resolveSharedAccess(petId, actorId, ownerId);
  } catch {
    return null;
  }
}

export async function logAuditTrail(params: {
  req: AuthenticatedRequest;
  entityType: AuditTrailEntityType | string;
  entityId: string;
  action: AuditTrailAction;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  try {
    const { beforeData, afterData } = buildAuditDiff(params.action, params.before, params.after);
    const actorId = actorIdFromReq(params.req);
    // Co-owner actions are attributed to both the co-owner and the primary owner.
    const shared = sharedAccessFor(params.entityType, params.entityId, actorId);
    if (shared) {
      familySharingService.recordSharedAccess(
        shared,
        `${params.entityType}.${params.action.toLowerCase()}`,
        params.entityType,
        params.entityId,
      );
    }

    await query(
      `
        INSERT INTO audit_trail (
          id, entity_type, entity_id, action,
          before_data, after_data,
          changed_by, ip_address, user_agent,
          acting_user_id, on_behalf_of_user_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `,
      [
        randomUUID(),
        params.entityType,
        params.entityId,
        params.action,
        beforeData,
        afterData,
        actorId,
        params.req.ip ?? null,
        params.req.headers['user-agent'] ?? null,
        shared?.actingUserId ?? actorId,
        shared?.onBehalfOfUserId ?? null,
      ],
    );
  } catch {
    // Swallow errors: audit logging must never break the request flow
  }
}
