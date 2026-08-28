/**
 * Access grant model — represents a time-limited, role-scoped permission
 * granted by a pet owner to a veterinarian or emergency contact.
 */

/** Roles that can be granted via access tokens (distinct from UserRole) */
export type GrantRole = 'vet-read' | 'vet-write' | 'emergency-contact';

/** Permissions associated with each grant role */
export const GRANT_PERMISSIONS: Record<GrantRole, readonly string[]> = {
  'vet-read': ['pet:read', 'medical_record:read', 'medication:read', 'appointment:read'],
  'vet-write': [
    'pet:read',
    'medical_record:read',
    'medical_record:write',
    'medication:read',
    'medication:write',
    'appointment:read',
    'appointment:write',
  ],
  'emergency-contact': ['pet:read', 'medical_record:read'],
} as const;

export interface AccessGrant {
  id: string;
  ownerId: string;
  granteeId: string;
  petId: string;
  role: GrantRole;
  /** Plaintext token — only returned at creation time */
  token?: string;
  /** SHA-256 hash of the token stored in DB */
  tokenHash: string;
  expiresAt: string;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAccessGrantInput {
  granteeId: string;
  petId: string;
  role: GrantRole;
  /** Duration in hours (default 24, max 720 = 30 days) */
  expiresInHours?: number;
}

export interface AccessGrantSummary {
  id: string;
  ownerId: string;
  granteeId: string;
  petId: string;
  role: GrantRole;
  expiresAt: string;
  revokedAt?: string;
  createdAt: string;
  isActive: boolean;
}

export function isGrantActive(grant: Pick<AccessGrant, 'revokedAt' | 'expiresAt'>): boolean {
  if (grant.revokedAt) return false;
  return new Date(grant.expiresAt) > new Date();
}

export function toGrantSummary(grant: AccessGrant): AccessGrantSummary {
  return {
    id: grant.id,
    ownerId: grant.ownerId,
    granteeId: grant.granteeId,
    petId: grant.petId,
    role: grant.role,
    expiresAt: grant.expiresAt,
    revokedAt: grant.revokedAt,
    createdAt: grant.createdAt,
    isActive: isGrantActive(grant),
  };
}
