/**
 * Family Sharing Models
 * Defines types for family groups, members, permissions, and activity feeds
 */

/**
 * Family member roles with permission hierarchy
 * owner > admin > caregiver > viewer
 */
export enum FamilyMemberRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  CAREGIVER = 'caregiver',
  VIEWER = 'viewer',
}

/**
 * Pet access permission levels
 */
export enum PetAccessLevel {
  VIEWER = 'viewer',
  CAREGIVER = 'caregiver',
  ADMIN = 'admin',
}

/**
 * Family member invitation status
 */
export enum InvitationStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
  EXPIRED = 'expired',
}

/**
 * Family member status
 */
export enum FamilyMemberStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
}

/**
 * Family group representing a household or group managing pets together
 */
export interface FamilyGroup {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Family member with role and invitation status
 */
export interface FamilyMember {
  id: string;
  familyGroupId: string;
  userId: string;
  role: FamilyMemberRole;
  invitedBy?: string;
  invitedAt?: string;
  acceptedAt?: string;
  status: FamilyMemberStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Pet access permission for a user
 */
export interface PetAccessPermission {
  id: string;
  petId: string;
  userId: string;
  permissionLevel: PetAccessLevel;
  grantedBy: string;
  grantedAt: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Family invitation with secure token
 */
export interface FamilyInvitation {
  id: string;
  familyGroupId: string;
  invitedEmail: string;
  invitedBy: string;
  role: FamilyMemberRole;
  token: string;
  status: InvitationStatus;
  expiresAt: string;
  acceptedBy?: string;
  acceptedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Activity feed entry for family group
 */
export interface FamilyActivityFeed {
  id: string;
  familyGroupId: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  petId?: string;
  description: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

/**
 * Pet ownership transfer record
 */
export interface PetOwnershipTransfer {
  id: string;
  petId: string;
  fromUserId: string;
  toUserId: string;
  transferredBy: string;
  reason?: string;
  createdAt: string;
}

/**
 * Request payload for creating a family group
 */
export interface CreateFamilyGroupInput {
  name: string;
  description?: string;
}

/**
 * Request payload for inviting a family member
 */
export interface InviteFamilyMemberInput {
  email: string;
  role: FamilyMemberRole;
}

/**
 * Request payload for updating family member role
 */
export interface UpdateFamilyMemberInput {
  role: FamilyMemberRole;
}

/**
 * Request payload for granting pet access
 */
export interface GrantPetAccessInput {
  userId: string;
  permissionLevel: PetAccessLevel;
  expiresAt?: string;
}

/**
 * Request payload for transferring pet ownership
 */
export interface TransferPetOwnershipInput {
  toUserId: string;
  reason?: string;
}

/**
 * Response for family group with members
 */
export interface FamilyGroupWithMembers extends FamilyGroup {
  members: Array<FamilyMember & { user?: { id: string; name: string; email: string } }>;
  petCount: number;
}

/**
 * Response for pet with access information
 */
export interface PetWithAccess {
  petId: string;
  petName: string;
  accessLevel: PetAccessLevel;
  grantedAt: string;
  expiresAt?: string;
  grantedBy: string;
}

/**
 * Activity feed entry with actor details
 */
export interface ActivityFeedEntry extends FamilyActivityFeed {
  actor?: {
    id: string;
    name: string;
    email: string;
  };
}

/**
 * Permission check result
 */
export interface PermissionCheckResult {
  hasAccess: boolean;
  permissionLevel?: PetAccessLevel;
  reason?: string;
}
