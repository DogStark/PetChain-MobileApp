/**
 * Centralized RBAC middleware for veterinary sharing system.
 *
 * Supports two authorization paths:
 *  1. JWT-authenticated users with UserRole (owner/vet/admin) — existing system
 *  2. Access-grant tokens — time-limited, scoped tokens issued by owners
 *
 * Usage:
 *   router.get('/pets/:petId/records', requirePermission('medical_record:read'), handler)
 */

import * as crypto from 'crypto';

import type { NextFunction, Response } from 'express';

import type { AuthenticatedRequest } from './auth';
import {
  GRANT_PERMISSIONS,
  isGrantActive,
  type AccessGrant,
  type GrantRole,
} from '../models/AccessGrant';
import { UserRole } from '../models/UserRole';
import { sendError } from '../server/response';
import auditLogService from '../services/auditLogService';
import { accessGrantRepository } from '../src/repositories/accessGrantRepository';

/** In-memory cache for access grants to support existing route patterns.
 * Primary persistence is the database repository. The cache is hydrated on demand.
 */
const grantStore = new Map<string, AccessGrant>();

/** Exported for use in sharing routes and tests */
export { grantStore };

export type Permission =
  | 'pet:read'
  | 'pet:write'
  | 'medical_record:read'
  | 'medical_record:write'
  | 'medication:read'
  | 'medication:write'
  | 'appointment:read'
  | 'appointment:write'
  | 'access_grant:manage';

/** Permissions held by each UserRole (for JWT-authenticated requests) */
const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  [UserRole.ADMIN]: [
    'pet:read',
    'pet:write',
    'medical_record:read',
    'medical_record:write',
    'medication:read',
    'medication:write',
    'appointment:read',
    'appointment:write',
    'access_grant:manage',
  ],
  [UserRole.VET]: [
    'pet:read',
    'medical_record:read',
    'medical_record:write',
    'medication:read',
    'medication:write',
    'appointment:read',
    'appointment:write',
  ],
  [UserRole.OWNER]: [
    'pet:read',
    'pet:write',
    'medical_record:read',
    'medication:read',
    'appointment:read',
    'appointment:write',
    'access_grant:manage',
  ],
} as const;

export interface RbacRequest extends AuthenticatedRequest {
  /** Set when request is authenticated via an access-grant token */
  grantContext?: {
    grant: AccessGrant;
    permissions: readonly string[];
  };
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Resolve an access-grant token from the Authorization header.
 * Returns the grant if valid and active, null otherwise.
 */
async function loadGrantByHash(hash: string): Promise<AccessGrant | null> {
  const cachedGrant = Array.from(grantStore.values()).find((g) => g.tokenHash === hash);
  if (cachedGrant) return cachedGrant;

  const dbGrant = await accessGrantRepository.findByTokenHash(hash);
  if (!dbGrant) return null;

  const grant: AccessGrant = {
    id: dbGrant.id,
    ownerId: dbGrant.owner_id,
    granteeId: dbGrant.grantee_id,
    petId: dbGrant.pet_id,
    role: dbGrant.role,
    tokenHash: dbGrant.token_hash,
    expiresAt: dbGrant.expires_at.toISOString(),
    revokedAt: dbGrant.revoked_at?.toISOString(),
    createdAt: dbGrant.created_at.toISOString(),
    updatedAt: dbGrant.updated_at.toISOString(),
  };

  grantStore.set(grant.id, grant);
  return grant;
}

async function resolveGrantToken(authHeader: string | undefined): Promise<AccessGrant | null> {
  if (!authHeader?.startsWith('Grant ')) return null;
  const token = authHeader.slice(6).trim();
  if (!token) return null;
  const hash = hashToken(token);
  return await loadGrantByHash(hash);
}

/**
 * Middleware factory: requires the caller to hold a specific permission.
 *
 * Accepts either:
 *  - A JWT-authenticated user whose UserRole includes the permission, OR
 *  - A valid, active access-grant token whose GrantRole includes the permission
 *
 * Optionally restricts to a specific petId (from req.params.petId).
 */
export function requirePermission(permission: Permission) {
  return async (req: RbacRequest, res: Response, next: NextFunction): Promise<void> => {
    const ip = req.ip;
    const ua = req.headers['user-agent'];

    // --- Path 1: JWT-authenticated user ---
    if (req.user) {
      const userPerms = ROLE_PERMISSIONS[req.user.role] as readonly string[];
      if (userPerms.includes(permission)) {
        return next();
      }
      // JWT user lacks permission — check if they have a grant token too
      // (fall through to grant check below)
    }

    // --- Path 2: Access-grant token ---
    const grant = await resolveGrantToken(req.headers.authorization);

    if (!grant) {
      const actorId = req.user?.id ?? 'anonymous';
      const actorEmail = req.user?.email ?? 'anonymous';
      auditLogService.log({
        actorId,
        actorEmail,
        role: req.user?.role,
        action: 'rbac.access_denied',
        resourceType: 'pet',
        meta: { permission, reason: 'no_valid_token' },
        ipAddress: ip,
        userAgent: ua,
        outcome: 'denied',
      });
      sendError(res, 403, 'FORBIDDEN', 'Insufficient permissions.');
      return;
    }

    // Validate grant is active
    if (!isGrantActive(grant)) {
      const isExpired = !grant.revokedAt && new Date(grant.expiresAt) <= new Date();
      auditLogService.log({
        actorId: grant.granteeId,
        actorEmail: '',
        role: grant.role,
        action: isExpired ? 'rbac.token_expired' : 'rbac.token_revoked',
        resourceType: 'access_grant',
        resourceId: grant.id,
        meta: { permission, petId: grant.petId },
        ipAddress: ip,
        userAgent: ua,
        outcome: 'denied',
      });
      sendError(
        res,
        403,
        isExpired ? 'TOKEN_EXPIRED' : 'TOKEN_REVOKED',
        isExpired ? 'Access token has expired.' : 'Access token has been revoked.',
      );
      return;
    }

    // Validate petId scope if present in route params
    const petId = req.params?.petId;
    if (petId && grant.petId !== petId) {
      auditLogService.log({
        actorId: grant.granteeId,
        actorEmail: '',
        role: grant.role,
        action: 'rbac.access_denied',
        resourceType: 'pet',
        resourceId: petId,
        meta: { permission, grantPetId: grant.petId, requestedPetId: petId },
        ipAddress: ip,
        userAgent: ua,
        outcome: 'denied',
      });
      sendError(res, 403, 'FORBIDDEN', 'Token is not valid for this pet.');
      return;
    }

    // Check permission against grant role
    const grantPerms = GRANT_PERMISSIONS[grant.role as GrantRole] as readonly string[];
    if (!grantPerms.includes(permission)) {
      auditLogService.log({
        actorId: grant.granteeId,
        actorEmail: '',
        role: grant.role,
        action: 'rbac.access_denied',
        resourceType: 'pet',
        resourceId: grant.petId,
        meta: { permission, grantRole: grant.role },
        ipAddress: ip,
        userAgent: ua,
        outcome: 'denied',
      });
      sendError(res, 403, 'FORBIDDEN', 'Insufficient permissions for this action.');
      return;
    }

    // Grant is valid — attach context and log usage
    req.grantContext = { grant, permissions: grantPerms };
    auditLogService.log({
      actorId: grant.granteeId,
      actorEmail: '',
      role: grant.role,
      action: 'access_grant.used',
      resourceType: 'access_grant',
      resourceId: grant.id,
      meta: { permission, petId: grant.petId },
      ipAddress: ip,
      userAgent: ua,
      outcome: 'success',
    });

    next();
  };
}

/**
 * Middleware: requires the caller to be the owner of the pet in req.params.petId.
 * Used to protect grant management endpoints.
 */
export function requirePetOwnership(req: RbacRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    sendError(res, 401, 'UNAUTHORIZED', 'Authentication required.');
    return;
  }
  if (req.user.role === UserRole.ADMIN) return next();

  const petId = req.params?.petId;
  if (!petId) {
    sendError(res, 400, 'BAD_REQUEST', 'petId is required.');
    return;
  }

  // Ownership is validated in the route handler against the store
  // This middleware just ensures the user is an OWNER role
  if (req.user.role !== UserRole.OWNER) {
    sendError(res, 403, 'FORBIDDEN', 'Only pet owners can manage access grants.');
    return;
  }

  next();
}

/** Exported helpers for sharing routes */
export { hashToken, resolveGrantToken };
