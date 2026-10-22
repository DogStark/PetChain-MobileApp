/**
 * Sharing management routes — allows pet owners to create, view, revoke,
 * and renew access grants for veterinarians and emergency contacts.
 *
 * Routes:
 *   POST   /api/sharing/pets/:petId/grants          — create grant
 *   GET    /api/sharing/pets/:petId/grants          — list grants for a pet
 *   GET    /api/sharing/grants                      — list all grants owned by caller
 *   DELETE /api/sharing/grants/:grantId             — revoke grant
 *   POST   /api/sharing/grants/:grantId/renew       — renew grant
 *   GET    /api/sharing/grants/:grantId             — get single grant
 */

import * as crypto from 'crypto';
import { randomUUID } from 'crypto';

import * as express from 'express';

import type { AuditableRequest } from '../../middleware/auditLog';
import { authenticateJWT, type AuthenticatedRequest } from '../../middleware/auth';
import {
  grantStore,
  hashToken,
  requirePetOwnership,
  type RbacRequest,
} from '../../middleware/rbac';
import {
  toGrantSummary,
  type AccessGrant,
  type CreateAccessGrantInput,
  type GrantRole,
} from '../../models/AccessGrant';
import { UserRole } from '../../models/UserRole';
import { ok, sendError } from '../../server/response';
import { store } from '../../server/store';
import auditLogService from '../../services/auditLogService';
import { accessGrantRepository } from '../repositories/accessGrantRepository';

const router = express.Router();

const VALID_ROLES: GrantRole[] = ['vet-read', 'vet-write', 'emergency-contact'];
const MAX_EXPIRES_HOURS = 720; // 30 days
const DEFAULT_EXPIRES_HOURS = 24;

function generateToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, tokenHash: hashToken(token) };
}

function expiresAt(hours: number): string {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return d.toISOString();
}

// All sharing routes require JWT authentication
router.use(authenticateJWT);

/**
 * POST /api/sharing/pets/:petId/grants
 * Create a new access grant for a pet. Only the pet owner can do this.
 */
router.post(
  '/pets/:petId/grants',
  requirePetOwnership,
  async (req: RbacRequest & AuditableRequest, res) => {
    const { petId } = req.params;
    const pet = store.pets.get(petId);
    if (!pet) return sendError(res, 404, 'NOT_FOUND', 'Pet not found.');

    // Verify ownership (admin bypasses)
    if (req.user!.role !== UserRole.ADMIN && pet.ownerId !== req.user!.id) {
      auditLogService.log({
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        role: req.user!.role,
        action: 'rbac.access_denied',
        resourceType: 'access_grant',
        resourceId: petId,
        meta: { reason: 'not_owner' },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        outcome: 'denied',
      });
      return sendError(res, 403, 'FORBIDDEN', 'You do not own this pet.');
    }

    const body = req.body as Partial<CreateAccessGrantInput>;
    const { granteeId, role, expiresInHours } = body;

    if (!granteeId?.trim()) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'granteeId is required.');
    }
    if (!role || !VALID_ROLES.includes(role)) {
      return sendError(
        res,
        400,
        'VALIDATION_ERROR',
        `role must be one of: ${VALID_ROLES.join(', ')}`,
      );
    }

    // Prevent self-grant
    if (granteeId.trim() === req.user!.id) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Cannot grant access to yourself.');
    }

    // Validate grantee exists
    const grantee = store.users.get(granteeId.trim());
    if (!grantee) {
      return sendError(res, 404, 'NOT_FOUND', 'Grantee user not found.');
    }

    // Prevent privilege escalation: vet-write requires grantee to be a vet
    if (role === 'vet-write' && grantee.role !== UserRole.VET && grantee.role !== UserRole.ADMIN) {
      return sendError(
        res,
        403,
        'PRIVILEGE_ESCALATION',
        'vet-write role can only be granted to users with vet role.',
      );
    }

    const hours = Math.min(
      MAX_EXPIRES_HOURS,
      Math.max(1, Number(expiresInHours) || DEFAULT_EXPIRES_HOURS),
    );

    const { token, tokenHash } = generateToken();
    const now = new Date().toISOString();
    const grant: AccessGrant = {
      id: randomUUID(),
      ownerId: req.user!.id,
      granteeId: granteeId.trim(),
      petId,
      role,
      token, // plaintext — only returned at creation
      tokenHash,
      expiresAt: expiresAt(hours),
      createdAt: now,
      updatedAt: now,
    };

    await accessGrantRepository.create({
      id: grant.id,
      owner_id: grant.ownerId,
      grantee_id: grant.granteeId,
      pet_id: grant.petId,
      role: grant.role,
      token_hash: grant.tokenHash,
      expires_at: grant.expiresAt,
      revoked_at: null,
      created_at: grant.createdAt,
      updated_at: grant.updatedAt,
    });

    grantStore.set(grant.id, grant);

    auditLogService.log({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      role: req.user!.role,
      action: 'access_grant.created',
      resourceType: 'access_grant',
      resourceId: grant.id,
      meta: { petId, granteeId: grant.granteeId, grantRole: role, expiresAt: grant.expiresAt },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      outcome: 'success',
    });

    // Return the plaintext token only at creation time
    return res.status(201).json(
      ok(
        {
          ...toGrantSummary(grant),
          token, // one-time reveal
        },
        'Access grant created.',
      ),
    );
  },
);

/**
 * GET /api/sharing/pets/:petId/grants
 * List all grants for a specific pet. Owner or admin only.
 */
router.get('/pets/:petId/grants', requirePetOwnership, async (req: RbacRequest, res) => {
  const { petId } = req.params;
  const pet = store.pets.get(petId);
  if (!pet) return sendError(res, 404, 'NOT_FOUND', 'Pet not found.');

  if (req.user!.role !== UserRole.ADMIN && pet.ownerId !== req.user!.id) {
    return sendError(res, 403, 'FORBIDDEN', 'You do not own this pet.');
  }

  const dbGrants = await accessGrantRepository.findByPetId(petId);
  const grants = dbGrants
    .map((dbGrant) => {
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
      return toGrantSummary(grant);
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return res.json(ok(grants));
});

/**
 * GET /api/sharing/grants
 * List all grants created by the authenticated owner.
 */
router.get('/grants', async (req: AuthenticatedRequest, res) => {
  const dbGrants = await accessGrantRepository.findByOwnerId(req.user!.id);
  const grants = dbGrants
    .map((dbGrant) => {
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
      return toGrantSummary(grant);
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return res.json(ok(grants));
});

/**
 * GET /api/sharing/grants/:grantId
 * Get a single grant. Owner, admin, or the grantee can view.
 */
router.get('/grants/:grantId', async (req: AuthenticatedRequest, res) => {
  const dbGrant = await accessGrantRepository.findById(req.params.grantId);
  if (!dbGrant) return sendError(res, 404, 'NOT_FOUND', 'Access grant not found.');

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

  const isOwner = grant.ownerId === req.user!.id;
  const isGrantee = grant.granteeId === req.user!.id;
  const isAdmin = req.user!.role === UserRole.ADMIN;

  if (!isOwner && !isGrantee && !isAdmin) {
    return sendError(res, 403, 'FORBIDDEN', 'Access denied.');
  }

  return res.json(ok(toGrantSummary(grant)));
});

/**
 * DELETE /api/sharing/grants/:grantId
 * Revoke an access grant immediately. Owner or admin only.
 */
router.delete('/grants/:grantId', async (req: AuthenticatedRequest, res) => {
  const dbGrant = await accessGrantRepository.findById(req.params.grantId);
  if (!dbGrant) return sendError(res, 404, 'NOT_FOUND', 'Access grant not found.');

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

  const isOwner = grant.ownerId === req.user!.id;
  const isAdmin = req.user!.role === UserRole.ADMIN;

  if (!isOwner && !isAdmin) {
    return sendError(res, 403, 'FORBIDDEN', 'Only the grant owner can revoke it.');
  }

  if (grant.revokedAt) {
    return sendError(res, 409, 'ALREADY_REVOKED', 'Grant is already revoked.');
  }

  const revoked: AccessGrant = {
    ...grant,
    revokedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await accessGrantRepository.update(grant.id, {
    revoked_at: revoked.revokedAt ? new Date(revoked.revokedAt) : null,
    updated_at: new Date(revoked.updatedAt),
  });
  grantStore.set(grant.id, revoked);

  auditLogService.log({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    role: req.user!.role,
    action: 'access_grant.revoked',
    resourceType: 'access_grant',
    resourceId: grant.id,
    meta: { petId: grant.petId, granteeId: grant.granteeId, grantRole: grant.role },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    outcome: 'success',
  });

  return res.json(ok(toGrantSummary(revoked), 'Access grant revoked.'));
});

/**
 * POST /api/sharing/grants/:grantId/renew
 * Renew (extend) an existing grant. Owner or admin only.
 * Issues a new token and resets expiry.
 */
router.post('/grants/:grantId/renew', async (req: AuthenticatedRequest, res) => {
  const dbGrant = await accessGrantRepository.findById(req.params.grantId);
  if (!dbGrant) return sendError(res, 404, 'NOT_FOUND', 'Access grant not found.');

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

  const isOwner = grant.ownerId === req.user!.id;
  const isAdmin = req.user!.role === UserRole.ADMIN;

  if (!isOwner && !isAdmin) {
    return sendError(res, 403, 'FORBIDDEN', 'Only the grant owner can renew it.');
  }

  if (grant.revokedAt) {
    return sendError(res, 409, 'GRANT_REVOKED', 'Cannot renew a revoked grant.');
  }

  const { expiresInHours } = req.body as { expiresInHours?: number };
  const hours = Math.min(
    MAX_EXPIRES_HOURS,
    Math.max(1, Number(expiresInHours) || DEFAULT_EXPIRES_HOURS),
  );

  const { token, tokenHash } = generateToken();
  const renewed: AccessGrant = {
    ...grant,
    token,
    tokenHash,
    expiresAt: expiresAt(hours),
    updatedAt: new Date().toISOString(),
  };
  await accessGrantRepository.update(grant.id, {
    token_hash: renewed.tokenHash,
    expires_at: new Date(renewed.expiresAt),
    updated_at: new Date(renewed.updatedAt),
  });
  grantStore.set(grant.id, renewed);

  auditLogService.log({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    role: req.user!.role,
    action: 'access_grant.renewed',
    resourceType: 'access_grant',
    resourceId: grant.id,
    meta: { petId: grant.petId, granteeId: grant.granteeId, newExpiresAt: renewed.expiresAt },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    outcome: 'success',
  });

  return res.json(
    ok(
      {
        ...toGrantSummary(renewed),
        token, // new token revealed on renewal
      },
      'Access grant renewed.',
    ),
  );
});

export default router;
