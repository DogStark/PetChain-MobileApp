/**
 * Joint ownership models for Stellar multisig pet co-ownership
 */

export type OwnershipType = 'sole' | 'joint';

export type CoOwnerStatus = 'pending' | 'active' | 'revoked';

export interface CoOwner {
  userId: string;
  name: string;
  email: string;
  publicKey: string;
  weight: number;
  status: CoOwnerStatus;
  invitedAt: string;
  acceptedAt?: string;
  revokedAt?: string;
}

export interface JointOwnership {
  id: string;
  petId: string;
  multisigAccountId: string;
  multisigPublicKey: string;
  coOwners: CoOwner[];
  thresholds: {
    low: number;
    medium: number;
    high: number;
  };
  /** M-of-N: minimum total weight required for critical ops */
  requiredWeight: number;
  /** Total weight across all active signers */
  totalWeight: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateJointOwnershipInput {
  petId: string;
  initiatorUserId: string;
  initiatorPublicKey: string;
  coOwners: {
    userId: string;
    name: string;
    email: string;
    publicKey: string;
    weight: number;
  }[];
  /** M-of-N threshold for critical operations (ownership transfer, record deletion) */
  requiredWeight: number;
}

export interface CoOwnerInvite {
  id: string;
  jointOwnershipId: string;
  petId: string;
  petName: string;
  invitedByUserId: string;
  invitedByName: string;
  invitedUserId: string;
  invitedEmail: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  expiresAt: string;
  createdAt: string;
}

export interface KeyRotationRequest {
  jointOwnershipId: string;
  userId: string;
  oldPublicKey: string;
  newPublicKey: string;
  reason?: string;
}
