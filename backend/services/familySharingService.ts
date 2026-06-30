/**
 * Family Sharing Service
 * Handles family group management, member invitations, pet access permissions, and activity feeds
 */

import { randomUUID } from 'crypto';

import { cacheKey, get as cacheGet, set as cacheSet, invalidate as cacheInvalidate, getCacheMetrics } from './cacheService';
import type {
  ActivityFeedEntry,
  CreateFamilyGroupInput,
  FamilyActivityFeed,
  FamilyGroup,
  FamilyGroupWithMembers,
  FamilyInvitation,
  FamilyMember,
  GrantPetAccessInput,
  InviteFamilyMemberInput,
  InvitationStatus,
  PetAccessPermission,
  PetOwnershipTransfer,
  PermissionCheckResult,
  TransferPetOwnershipInput,
  UpdateFamilyMemberInput,
} from '../models/FamilySharing';
import {
  FamilyMemberRole,
  FamilyMemberStatus,
  InvitationStatus as InvStatus,
  PetAccessLevel,
} from '../models/FamilySharing';

// In-memory stores (replace with DB repositories in production)
const familyGroups = new Map<string, FamilyGroup>();
const familyMembers = new Map<string, FamilyMember>();
const petAccessPermissions = new Map<string, PetAccessPermission>();
const familyInvitations = new Map<string, FamilyInvitation>();
const activityFeed = new Map<string, FamilyActivityFeed>();
const ownershipTransfers = new Map<string, PetOwnershipTransfer>();

// ─── Cache constants ──────────────────────────────────────────────────────────
const PERMISSION_TTL = 300; // 5 minutes
function permissionCacheKey(userId: string, petId: string): string {
  return cacheKey('family', 'perm', userId, petId);
}

// ─── Cache hit-rate metric logging ───────────────────────────────────────────
setInterval(() => {
  const metrics = getCacheMetrics();
  console.warn('[familySharingService] cache hit-rate:', metrics.hitRate, metrics);
}, 60_000);

function now(): string {
  return new Date().toISOString();
}

function generateInvitationToken(): string {
  return randomUUID();
}

function getInvitationExpiresAt(daysFromNow: number = 7): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString();
}

// ─── Family Group Operations ───────────────────────────────────────────────────

export function createFamilyGroup(ownerId: string, input: CreateFamilyGroupInput): FamilyGroup {
  const id = randomUUID();
  const t = now();

  const group: FamilyGroup = {
    id,
    name: input.name,
    description: input.description,
    ownerId,
    createdAt: t,
    updatedAt: t,
  };

  familyGroups.set(id, group);

  // Add owner as admin member
  const memberId = randomUUID();
  const member: FamilyMember = {
    id: memberId,
    familyGroupId: id,
    userId: ownerId,
    role: FamilyMemberRole.OWNER,
    status: FamilyMemberStatus.ACCEPTED,
    acceptedAt: t,
    createdAt: t,
    updatedAt: t,
  };
  familyMembers.set(memberId, member);

  // Log activity
  logActivity(
    id,
    ownerId,
    'family_group.created',
    'family_group',
    id,
    `Created family group "${input.name}"`,
  );

  return group;
}

export function getFamilyGroup(familyGroupId: string): FamilyGroup | undefined {
  return familyGroups.get(familyGroupId);
}

export function getFamilyGroupsByUser(userId: string): FamilyGroup[] {
  const userMemberships = [...familyMembers.values()].filter(
    (m) => m.userId === userId && m.status === FamilyMemberStatus.ACCEPTED,
  );

  return userMemberships
    .map((m) => familyGroups.get(m.familyGroupId))
    .filter((g): g is FamilyGroup => g !== undefined);
}

export function updateFamilyGroup(
  familyGroupId: string,
  updatedBy: string,
  input: Partial<CreateFamilyGroupInput>,
): FamilyGroup | null {
  const group = familyGroups.get(familyGroupId);
  if (!group) return null;

  // Only owner can update
  if (group.ownerId !== updatedBy) return null;

  const updated: FamilyGroup = {
    ...group,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    updatedAt: now(),
  };

  familyGroups.set(familyGroupId, updated);
  logActivity(
    familyGroupId,
    updatedBy,
    'family_group.updated',
    'family_group',
    familyGroupId,
    'Updated family group',
  );

  return updated;
}

export function deleteFamilyGroup(familyGroupId: string, deletedBy: string): boolean {
  const group = familyGroups.get(familyGroupId);
  if (!group || group.ownerId !== deletedBy) return false;

  familyGroups.delete(familyGroupId);

  // Clean up related data
  [...familyMembers.values()]
    .filter((m) => m.familyGroupId === familyGroupId)
    .forEach((m) => familyMembers.delete(m.id));

  [...familyInvitations.values()]
    .filter((i) => i.familyGroupId === familyGroupId)
    .forEach((i) => familyInvitations.delete(i.id));

  logActivity(
    familyGroupId,
    deletedBy,
    'family_group.deleted',
    'family_group',
    familyGroupId,
    'Deleted family group',
  );

  return true;
}

// ─── Family Member Operations ──────────────────────────────────────────────────

export function getFamilyMembers(familyGroupId: string): FamilyMember[] {
  return [...familyMembers.values()].filter((m) => m.familyGroupId === familyGroupId);
}

export function getFamilyMember(familyGroupId: string, userId: string): FamilyMember | undefined {
  return [...familyMembers.values()].find(
    (m) =>
      m.familyGroupId === familyGroupId &&
      m.userId === userId &&
      m.status === FamilyMemberStatus.ACCEPTED,
  );
}

export function inviteFamilyMember(
  familyGroupId: string,
  invitedBy: string,
  input: InviteFamilyMemberInput,
): FamilyInvitation {
  const id = randomUUID();
  const token = generateInvitationToken();
  const t = now();

  const invitation: FamilyInvitation = {
    id,
    familyGroupId,
    invitedEmail: input.email.toLowerCase(),
    invitedBy,
    role: input.role,
    token,
    status: InvStatus.PENDING,
    expiresAt: getInvitationExpiresAt(),
    createdAt: t,
    updatedAt: t,
  };

  familyInvitations.set(id, invitation);
  logActivity(
    familyGroupId,
    invitedBy,
    'family_member.invited',
    'family_member',
    id,
    `Invited ${input.email} as ${input.role}`,
  );

  return invitation;
}

export function acceptFamilyInvitation(
  invitationToken: string,
  userId: string,
  userEmail: string,
): FamilyMember | null {
  const invitation = [...familyInvitations.values()].find((i) => i.token === invitationToken);
  if (!invitation) return null;

  // Verify invitation is valid
  if (invitation.status !== InvStatus.PENDING) return null;
  if (new Date(invitation.expiresAt) < new Date()) {
    invitation.status = InvStatus.EXPIRED;
    return null;
  }
  if (invitation.invitedEmail !== userEmail.toLowerCase()) return null;

  // Create family member
  const memberId = randomUUID();
  const t = now();

  const member: FamilyMember = {
    id: memberId,
    familyGroupId: invitation.familyGroupId,
    userId,
    role: invitation.role,
    invitedBy: invitation.invitedBy,
    invitedAt: invitation.createdAt,
    acceptedAt: t,
    status: FamilyMemberStatus.ACCEPTED,
    createdAt: t,
    updatedAt: t,
  };

  familyMembers.set(memberId, member);

  // Update invitation
  invitation.status = InvStatus.ACCEPTED;
  invitation.acceptedBy = userId;
  invitation.acceptedAt = t;

  logActivity(
    invitation.familyGroupId,
    userId,
    'family_member.accepted',
    'family_member',
    memberId,
    `Accepted invitation to family group`,
  );

  return member;
}

export function declineFamilyInvitation(invitationToken: string): boolean {
  const invitation = [...familyInvitations.values()].find((i) => i.token === invitationToken);
  if (!invitation || invitation.status !== InvStatus.PENDING) return false;

  invitation.status = InvStatus.DECLINED;
  return true;
}

export function updateFamilyMemberRole(
  familyGroupId: string,
  userId: string,
  updatedBy: string,
  input: UpdateFamilyMemberInput,
): FamilyMember | null {
  const member = getFamilyMember(familyGroupId, userId);
  if (!member) return null;

  // Only owner/admin can update roles
  const updater = getFamilyMember(familyGroupId, updatedBy);
  if (
    !updater ||
    (updater.role !== FamilyMemberRole.OWNER && updater.role !== FamilyMemberRole.ADMIN)
  ) {
    return null;
  }

  // Can't change owner role
  if (member.role === FamilyMemberRole.OWNER) return null;

  const updated: FamilyMember = {
    ...member,
    role: input.role,
    updatedAt: now(),
  };

  familyMembers.set(member.id, updated);

  // Invalidate all pet permission cache entries for this user
  void invalidatePetPermissionsForUser(userId);

  logActivity(
    familyGroupId,
    updatedBy,
    'family_member.role_updated',
    'family_member',
    member.id,
    `Updated ${member.userId} role to ${input.role}`,
  );

  return updated;
}

export function removeFamilyMember(
  familyGroupId: string,
  userId: string,
  removedBy: string,
): boolean {
  const member = getFamilyMember(familyGroupId, userId);
  if (!member) return false;

  // Only owner/admin can remove members
  const remover = getFamilyMember(familyGroupId, removedBy);
  if (
    !remover ||
    (remover.role !== FamilyMemberRole.OWNER && remover.role !== FamilyMemberRole.ADMIN)
  ) {
    return false;
  }

  // Can't remove owner
  if (member.role === FamilyMemberRole.OWNER) return false;

  familyMembers.delete(member.id);

  // Invalidate all pet permission cache entries for this user
  void invalidatePetPermissionsForUser(userId);

  logActivity(
    familyGroupId,
    removedBy,
    'family_member.removed',
    'family_member',
    member.id,
    `Removed ${userId}`,
  );

  return true;
}

/** Invalidates all cached permission entries for a given user across all pets. */
async function invalidatePetPermissionsForUser(userId: string): Promise<void> {
  const keys = [...petAccessPermissions.values()]
    .filter((p) => p.userId === userId)
    .map((p) => permissionCacheKey(userId, p.petId));
  if (keys.length > 0) await cacheInvalidate(...keys);
}

// ─── Pet Access Operations ─────────────────────────────────────────────────────

export function grantPetAccess(
  petId: string,
  grantedBy: string,
  input: GrantPetAccessInput,
): PetAccessPermission {
  const id = randomUUID();
  const t = now();

  const permission: PetAccessPermission = {
    id,
    petId,
    userId: input.userId,
    permissionLevel: input.permissionLevel,
    grantedBy,
    grantedAt: t,
    expiresAt: input.expiresAt,
    createdAt: t,
    updatedAt: t,
  };

  petAccessPermissions.set(id, permission);
  logActivity(
    '', // No family group context for direct pet access
    grantedBy,
    'pet_access.granted',
    'pet_access',
    id,
    `Granted ${input.permissionLevel} access to pet ${petId}`,
    { petId, userId: input.userId },
  );

  return permission;
}

export function getPetAccess(petId: string, userId: string): PetAccessPermission | undefined {
  const permission = [...petAccessPermissions.values()].find(
    (p) => p.petId === petId && p.userId === userId,
  );

  // Check if expired
  if (permission && permission.expiresAt && new Date(permission.expiresAt) < new Date()) {
    return undefined;
  }

  return permission;
}

export function getPetAccessList(petId: string): PetAccessPermission[] {
  return [...petAccessPermissions.values()]
    .filter((p) => p.petId === petId)
    .filter((p) => !p.expiresAt || new Date(p.expiresAt) >= new Date());
}

export function revokePetAccess(petId: string, userId: string, revokedBy: string): boolean {
  const permission = [...petAccessPermissions.values()].find(
    (p) => p.petId === petId && p.userId === userId,
  );

  if (!permission) return false;

  petAccessPermissions.delete(permission.id);
  void cacheInvalidate(permissionCacheKey(userId, petId));
  logActivity(
    '',
    revokedBy,
    'pet_access.revoked',
    'pet_access',
    permission.id,
    `Revoked access to pet ${petId}`,
    { petId, userId },
  );

  return true;
}

export function updatePetAccess(
  petId: string,
  userId: string,
  updatedBy: string,
  newLevel: PetAccessLevel,
): PetAccessPermission | null {
  const permission = getPetAccess(petId, userId);
  if (!permission) return null;

  const updated: PetAccessPermission = {
    ...permission,
    permissionLevel: newLevel,
    updatedAt: now(),
  };

  petAccessPermissions.set(permission.id, updated);
  void cacheInvalidate(permissionCacheKey(userId, petId));
  logActivity(
    '',
    updatedBy,
    'pet_access.updated',
    'pet_access',
    permission.id,
    `Updated access level to ${newLevel}`,
    { petId, userId },
  );

  return updated;
}

// ─── Permission Checks ─────────────────────────────────────────────────────────

export async function checkPetAccess(petId: string, userId: string): Promise<PermissionCheckResult> {
  const key = permissionCacheKey(userId, petId);
  const cached = await cacheGet<PermissionCheckResult>(key);
  if (cached !== null) return cached;

  const permission = getPetAccess(petId, userId);
  const result: PermissionCheckResult = permission
    ? { hasAccess: true, permissionLevel: permission.permissionLevel }
    : { hasAccess: false, reason: 'No access permission for this pet' };

  await cacheSet(key, result, PERMISSION_TTL);
  return result;
}

export async function canEditPet(petId: string, userId: string): Promise<boolean> {
  const result = await checkPetAccess(petId, userId);
  if (!result.hasAccess) return false;
  return (
    result.permissionLevel === PetAccessLevel.ADMIN ||
    result.permissionLevel === PetAccessLevel.CAREGIVER
  );
}

export async function canManagePetAccess(petId: string, userId: string): Promise<boolean> {
  const result = await checkPetAccess(petId, userId);
  if (!result.hasAccess) return false;
  return result.permissionLevel === PetAccessLevel.ADMIN;
}

// ─── Pet Ownership Transfer ───────────────────────────────────────────────────

export function transferPetOwnership(
  petId: string,
  toUserId: string,
  transferredBy: string,
  input: TransferPetOwnershipInput,
): PetOwnershipTransfer {
  const id = randomUUID();

  const transfer: PetOwnershipTransfer = {
    id,
    petId,
    fromUserId: transferredBy,
    toUserId,
    transferredBy,
    reason: input.reason,
    createdAt: now(),
  };

  ownershipTransfers.set(id, transfer);
  logActivity(
    '',
    transferredBy,
    'pet_ownership.transferred',
    'pet_ownership',
    id,
    `Transferred pet ownership to ${toUserId}`,
    { petId, toUserId, reason: input.reason },
  );

  return transfer;
}

export function getPetOwnershipHistory(petId: string): PetOwnershipTransfer[] {
  return [...ownershipTransfers.values()]
    .filter((t) => t.petId === petId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// ─── Activity Feed Operations ──────────────────────────────────────────────────

function logActivity(
  familyGroupId: string,
  actorId: string,
  action: string,
  resourceType: string,
  resourceId: string,
  description: string,
  metadata?: Record<string, unknown>,
): void {
  const id = randomUUID();

  const entry: FamilyActivityFeed = {
    id,
    familyGroupId,
    actorId,
    action,
    resourceType,
    resourceId,
    description,
    metadata,
    createdAt: now(),
  };

  activityFeed.set(id, entry);
}

export function getFamilyActivityFeed(
  familyGroupId: string,
  limit: number = 50,
  offset: number = 0,
): FamilyActivityFeed[] {
  return [...activityFeed.values()]
    .filter((a) => a.familyGroupId === familyGroupId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(offset, offset + limit);
}

export function getPetActivityFeed(
  petId: string,
  limit: number = 50,
  offset: number = 0,
): FamilyActivityFeed[] {
  return [...activityFeed.values()]
    .filter((a) => a.petId === petId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(offset, offset + limit);
}

export function getActivityFeedEntry(entryId: string): FamilyActivityFeed | undefined {
  return activityFeed.get(entryId);
}

// ─── Utility Functions ─────────────────────────────────────────────────────────

export function getFamilyGroupWithMembers(familyGroupId: string): FamilyGroupWithMembers | null {
  const group = familyGroups.get(familyGroupId);
  if (!group) return null;

  const members = getFamilyMembers(familyGroupId);

  return {
    ...group,
    members,
    petCount: 0, // Would be populated from pet repository
  };
}

export function canUserAccessFamily(familyGroupId: string, userId: string): boolean {
  return getFamilyMember(familyGroupId, userId) !== undefined;
}

export function getUserFamilyRole(familyGroupId: string, userId: string): FamilyMemberRole | null {
  const member = getFamilyMember(familyGroupId, userId);
  return member?.role ?? null;
}

export default {
  // Family Group
  createFamilyGroup,
  getFamilyGroup,
  getFamilyGroupsByUser,
  updateFamilyGroup,
  deleteFamilyGroup,

  // Family Members
  getFamilyMembers,
  getFamilyMember,
  inviteFamilyMember,
  acceptFamilyInvitation,
  declineFamilyInvitation,
  updateFamilyMemberRole,
  removeFamilyMember,

  // Pet Access
  grantPetAccess,
  getPetAccess,
  getPetAccessList,
  revokePetAccess,
  updatePetAccess,

  // Permission Checks (async — use Redis cache)
  checkPetAccess,
  canEditPet,
  canManagePetAccess,

  // Pet Ownership
  transferPetOwnership,
  getPetOwnershipHistory,

  // Activity Feed
  getFamilyActivityFeed,
  getPetActivityFeed,
  getActivityFeedEntry,

  // Utilities
  getFamilyGroupWithMembers,
  canUserAccessFamily,
  getUserFamilyRole,
};
