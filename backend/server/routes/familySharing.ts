/**
 * Family Sharing Routes
 * Handles family group management, member invitations, pet access, and activity feeds
 */

import express from 'express';

import type { AuditableRequest } from '../../middleware/auditLog';
import { authenticateJWT, type AuthenticatedRequest } from '../../middleware/auth';
import { FamilyMemberRole } from '../../models/FamilySharing';
import familySharingService from '../../services/familySharingService';
import { ok, sendError } from '../response';

const router = express.Router();

// All routes require authentication
router.use(authenticateJWT);

// ─── Family Group Routes ───────────────────────────────────────────────────────

/**
 * GET /family-groups
 * List all family groups for the authenticated user
 */
router.get('/', (req: AuthenticatedRequest, res) => {
  const groups = familySharingService.getFamilyGroupsByUser(req.user!.id);
  return res.json(ok(groups));
});

/**
 * POST /family-groups
 * Create a new family group
 */
router.post('/', (req: AuthenticatedRequest, res) => {
  const { name, description } = req.body;

  if (!name?.trim()) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Family group name is required');
  }

  const group = familySharingService.createFamilyGroup(req.user!.id, {
    name: name.trim(),
    description: description?.trim(),
  });

  (req as AuditableRequest).audit?.('family_group.created', 'family_group', group.id, {
    name: group.name,
  });

  return res.status(201).json(ok(group, 'Family group created'));
});

/**
 * GET /family-groups/:id
 * Get family group details with members
 */
router.get('/:id', (req: AuthenticatedRequest, res) => {
  const group = familySharingService.getFamilyGroup(req.params.id);

  if (!group) {
    return sendError(res, 404, 'NOT_FOUND', 'Family group not found');
  }

  // Check if user has access
  if (!familySharingService.canUserAccessFamily(req.params.id, req.user!.id)) {
    return sendError(res, 403, 'FORBIDDEN', 'You do not have access to this family group');
  }

  const groupWithMembers = familySharingService.getFamilyGroupWithMembers(req.params.id);
  return res.json(ok(groupWithMembers));
});

/**
 * PUT /family-groups/:id
 * Update family group (owner only)
 */
router.put('/:id', (req: AuthenticatedRequest, res) => {
  const group = familySharingService.getFamilyGroup(req.params.id);

  if (!group) {
    return sendError(res, 404, 'NOT_FOUND', 'Family group not found');
  }

  if (group.ownerId !== req.user!.id) {
    return sendError(res, 403, 'FORBIDDEN', 'Only the owner can update this family group');
  }

  const { name, description } = req.body;
  const updated = familySharingService.updateFamilyGroup(req.params.id, req.user!.id, {
    name: name?.trim(),
    description: description?.trim(),
  });

  if (!updated) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to update family group');
  }

  (req as AuditableRequest).audit?.('family_group.updated', 'family_group', req.params.id);

  return res.json(ok(updated, 'Family group updated'));
});

/**
 * DELETE /family-groups/:id
 * Delete family group (owner only)
 */
router.delete('/:id', (req: AuthenticatedRequest, res) => {
  const group = familySharingService.getFamilyGroup(req.params.id);

  if (!group) {
    return sendError(res, 404, 'NOT_FOUND', 'Family group not found');
  }

  if (group.ownerId !== req.user!.id) {
    return sendError(res, 403, 'FORBIDDEN', 'Only the owner can delete this family group');
  }

  const deleted = familySharingService.deleteFamilyGroup(req.params.id, req.user!.id);

  if (!deleted) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to delete family group');
  }

  (req as AuditableRequest).audit?.('family_group.deleted', 'family_group', req.params.id);

  return res.json(ok(null, 'Family group deleted'));
});

// ─── Family Member Routes ──────────────────────────────────────────────────────

/**
 * GET /family-groups/:id/members
 * List family members
 */
router.get('/:id/members', (req: AuthenticatedRequest, res) => {
  if (!familySharingService.canUserAccessFamily(req.params.id, req.user!.id)) {
    return sendError(res, 403, 'FORBIDDEN', 'You do not have access to this family group');
  }

  const members = familySharingService.getFamilyMembers(req.params.id);
  return res.json(ok(members));
});

/**
 * POST /family-groups/:id/members
 * Invite a family member
 */
router.post('/:id/members', (req: AuthenticatedRequest, res) => {
  const group = familySharingService.getFamilyGroup(req.params.id);

  if (!group) {
    return sendError(res, 404, 'NOT_FOUND', 'Family group not found');
  }

  // Check if user is admin or owner
  const userRole = familySharingService.getUserFamilyRole(req.params.id, req.user!.id);
  if (userRole !== FamilyMemberRole.OWNER && userRole !== FamilyMemberRole.ADMIN) {
    return sendError(res, 403, 'FORBIDDEN', 'Only admins can invite members');
  }

  const { email, role } = req.body;

  if (!email?.trim()) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Email is required');
  }

  if (!role || !Object.values(FamilyMemberRole).includes(role)) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Valid role is required');
  }

  const invitation = familySharingService.inviteFamilyMember(req.params.id, req.user!.id, {
    email: email.trim(),
    role,
  });

  (req as AuditableRequest).audit?.('family_member.invited', 'family_member', invitation.id, {
    email: email.trim(),
    role,
  });

  return res.status(201).json(ok(invitation, 'Invitation sent'));
});

/**
 * PUT /family-groups/:id/members/:userId
 * Update family member role
 */
router.put('/:id/members/:userId', (req: AuthenticatedRequest, res) => {
  const { role } = req.body;

  if (!role || !Object.values(FamilyMemberRole).includes(role)) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Valid role is required');
  }

  const updated = familySharingService.updateFamilyMemberRole(
    req.params.id,
    req.params.userId,
    req.user!.id,
    { role },
  );

  if (!updated) {
    return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to update this member');
  }

  (req as AuditableRequest).audit?.('family_member.role_updated', 'family_member', updated.id, {
    userId: req.params.userId,
    role,
  });

  return res.json(ok(updated, 'Member role updated'));
});

/**
 * DELETE /family-groups/:id/members/:userId
 * Remove family member
 */
router.delete('/:id/members/:userId', (req: AuthenticatedRequest, res) => {
  const removed = familySharingService.removeFamilyMember(
    req.params.id,
    req.params.userId,
    req.user!.id,
  );

  if (!removed) {
    return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to remove this member');
  }

  (req as AuditableRequest).audit?.('family_member.removed', 'family_member', req.params.userId, {
    userId: req.params.userId,
  });

  return res.json(ok(null, 'Member removed'));
});

// ─── Invitation Routes ─────────────────────────────────────────────────────────

/**
 * POST /family-groups/invitations/:token/accept
 * Accept family invitation
 */
router.post('/invitations/:token/accept', (req: AuthenticatedRequest, res) => {
  const member = familySharingService.acceptFamilyInvitation(
    req.params.token,
    req.user!.id,
    req.user!.email,
  );

  if (!member) {
    return sendError(res, 400, 'INVALID_INVITATION', 'Invalid or expired invitation');
  }

  (req as AuditableRequest).audit?.('family_member.accepted', 'family_member', member.id);

  return res.json(ok(member, 'Invitation accepted'));
});

/**
 * POST /family-groups/invitations/:token/decline
 * Decline family invitation
 */
router.post('/invitations/:token/decline', (req: AuthenticatedRequest, res) => {
  const declined = familySharingService.declineFamilyInvitation(req.params.token);

  if (!declined) {
    return sendError(res, 400, 'INVALID_INVITATION', 'Invalid or expired invitation');
  }

  (req as AuditableRequest).audit?.('family_member.declined', 'family_member', req.params.token);

  return res.json(ok(null, 'Invitation declined'));
});

// ─── Pet Access Routes ─────────────────────────────────────────────────────────

/**
 * POST /pets/:petId/share
 * Grant pet access to a user
 */
router.post('/pets/:petId/share', (req: AuthenticatedRequest, res) => {
  const { userId, permissionLevel, expiresAt } = req.body;

  if (!userId?.trim()) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'userId is required');
  }

  if (!permissionLevel) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'permissionLevel is required');
  }

  // Check if user can manage pet access
  if (!familySharingService.canManagePetAccess(req.params.petId, req.user!.id)) {
    return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to share this pet');
  }

  const permission = familySharingService.grantPetAccess(req.params.petId, req.user!.id, {
    userId: userId.trim(),
    permissionLevel,
    expiresAt,
  });

  (req as AuditableRequest).audit?.('pet_access.granted', 'pet_access', permission.id, {
    petId: req.params.petId,
    userId: userId.trim(),
    permissionLevel,
  });

  return res.status(201).json(ok(permission, 'Pet access granted'));
});

/**
 * GET /pets/:petId/access
 * List who has access to a pet
 */
router.get('/pets/:petId/access', async (req: AuthenticatedRequest, res) => {
  // Check if user has access to pet
  const access = await familySharingService.checkPetAccess(req.params.petId, req.user!.id);
  if (!access.hasAccess) {
    return sendError(res, 403, 'FORBIDDEN', 'You do not have access to this pet');
  }

  const accessList = familySharingService.getPetAccessList(req.params.petId);
  return res.json(ok(accessList));
});

/**
 * PUT /pets/:petId/access/:userId
 * Update pet access level
 */
router.put('/pets/:petId/access/:userId', (req: AuthenticatedRequest, res) => {
  const { permissionLevel } = req.body;

  if (!permissionLevel) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'permissionLevel is required');
  }

  if (!familySharingService.canManagePetAccess(req.params.petId, req.user!.id)) {
    return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to manage pet access');
  }

  const updated = familySharingService.updatePetAccess(
    req.params.petId,
    req.params.userId,
    req.user!.id,
    permissionLevel,
  );

  if (!updated) {
    return sendError(res, 404, 'NOT_FOUND', 'Pet access not found');
  }

  (req as AuditableRequest).audit?.('pet_access.updated', 'pet_access', updated.id, {
    petId: req.params.petId,
    userId: req.params.userId,
    permissionLevel,
  });

  return res.json(ok(updated, 'Pet access updated'));
});

/**
 * DELETE /pets/:petId/access/:userId
 * Revoke pet access
 */
router.delete('/pets/:petId/access/:userId', (req: AuthenticatedRequest, res) => {
  if (!familySharingService.canManagePetAccess(req.params.petId, req.user!.id)) {
    return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to revoke pet access');
  }

  const revoked = familySharingService.revokePetAccess(
    req.params.petId,
    req.params.userId,
    req.user!.id,
  );

  if (!revoked) {
    return sendError(res, 404, 'NOT_FOUND', 'Pet access not found');
  }

  (req as AuditableRequest).audit?.('pet_access.revoked', 'pet_access', req.params.userId, {
    petId: req.params.petId,
    userId: req.params.userId,
  });

  return res.json(ok(null, 'Pet access revoked'));
});

// ─── Activity Feed Routes ──────────────────────────────────────────────────────

/**
 * GET /family-groups/:id/activity
 * Get family activity feed
 */
router.get('/:id/activity', (req: AuthenticatedRequest, res) => {
  if (!familySharingService.canUserAccessFamily(req.params.id, req.user!.id)) {
    return sendError(res, 403, 'FORBIDDEN', 'You do not have access to this family group');
  }

  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);

  const feed = familySharingService.getFamilyActivityFeed(req.params.id, limit, offset);

  return res.json(ok(feed));
});

/**
 * GET /pets/:petId/activity
 * Get pet activity feed
 */
router.get('/pets/:petId/activity', async (req: AuthenticatedRequest, res) => {
  const access = await familySharingService.checkPetAccess(req.params.petId, req.user!.id);
  if (!access.hasAccess) {
    return sendError(res, 403, 'FORBIDDEN', 'You do not have access to this pet');
  }

  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);

  const feed = familySharingService.getPetActivityFeed(req.params.petId, limit, offset);

  return res.json(ok(feed));
});

// ─── Pet Ownership Transfer Routes ─────────────────────────────────────────────

/**
 * POST /pets/:petId/transfer-ownership
 * Transfer pet ownership
 */
router.post('/pets/:petId/transfer-ownership', (req: AuthenticatedRequest, res) => {
  const { toUserId, reason } = req.body;

  if (!toUserId?.trim()) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'toUserId is required');
  }

  if (!familySharingService.canManagePetAccess(req.params.petId, req.user!.id)) {
    return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to transfer this pet');
  }

  const transfer = familySharingService.transferPetOwnership(
    req.params.petId,
    toUserId.trim(),
    req.user!.id,
    { toUserId: toUserId.trim(), reason: reason?.trim() },
  );

  (req as AuditableRequest).audit?.('pet_ownership.transferred', 'pet_ownership', transfer.id, {
    petId: req.params.petId,
    toUserId: toUserId.trim(),
    reason: reason?.trim(),
  });

  return res.status(201).json(ok(transfer, 'Pet ownership transferred'));
});

/**
 * GET /pets/:petId/ownership-history
 * Get pet ownership transfer history
 */
router.get('/pets/:petId/ownership-history', async (req: AuthenticatedRequest, res) => {
  const access = await familySharingService.checkPetAccess(req.params.petId, req.user!.id);
  if (!access.hasAccess) {
    return sendError(res, 403, 'FORBIDDEN', 'You do not have access to this pet');
  }

  const history = familySharingService.getPetOwnershipHistory(req.params.petId);

  return res.json(ok(history));
});

export default router;
