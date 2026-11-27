/**
 * Pet data model interfaces and types
 */
import type { OwnershipType } from './JointOwnership';

/**
 * Medical history record for a pet
 */
export interface MedicalHistoryRecord {
  id: string;
  date: string;
  condition: string;
  treatment: string;
  veterinarian?: string;
  notes?: string;
}

/**
 * Vaccination record for a pet
 */
export interface VaccinationRecord {
  id: string;
  name: string;
  date: string;
  nextDueDate?: string;
  veterinarian?: string;
  batchNumber?: string;
}

/**
 * Medication record for a pet
 */
export interface MedicationRecord {
  id: string;
  name: string;
  dosage: string;
  frequency: string;
  startDate: string;
  endDate?: string;
  prescribedBy?: string;
  notes?: string;
}

/**
 * Pet species type
 */
export type Species = 'dog' | 'cat' | 'bird' | 'rabbit' | 'other';

/**
 * Main Pet interface
 */
export interface Pet {
  id: string;
  name: string;
  species: Species;
  breed?: string;
  dateOfBirth?: string;
  weightKg?: number;
  microchipId?: string;
  photoUrl?: string;
  ownerId: string;
  /** 'sole' for single owner, 'joint' for multisig co-ownership */
  ownershipType?: OwnershipType;
  /** ID of the JointOwnership record (present when ownershipType === 'joint') */
  jointOwnershipId?: string;
  /** Stellar multisig account public key (present when ownershipType === 'joint') */
  multisigPublicKey?: string;
  /** Arbitrary key/value metadata attached to the pet */
  metadata?: PetMetadata;
  createdAt: string;
  updatedAt: string;
}

/**
 * Arbitrary key/value metadata attached to a pet
 */
export type PetMetadata = Record<string, unknown>;

/**
 * A single JSON Patch operation (RFC 6902)
 */
export interface JsonPatchOperation {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  value?: unknown;
  from?: string;
}

/**
 * Computes a JSON Patch (RFC 6902) describing the changes needed to turn
 * `before` into `after`. Only top-level keys are diffed.
 */
export function computeMetadataPatch(
  before: PetMetadata | undefined,
  after: PetMetadata | undefined
): JsonPatchOperation[] {
  const prev = before ?? {};
  const next = after ?? {};
  const patch: JsonPatchOperation[] = [];

  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);

  for (const key of nextKeys) {
    const path = `/${escapeJsonPointerToken(key)}`;
    if (!(key in prev)) {
      patch.push({ op: 'add', path, value: next[key] });
    } else if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) {
      patch.push({ op: 'replace', path, value: next[key] });
    }
  }

  for (const key of prevKeys) {
    if (!(key in next)) {
      patch.push({ op: 'remove', path: `/${escapeJsonPointerToken(key)}` });
    }
  }

  return patch;
}

function escapeJsonPointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Persists a pet metadata update and records a before/after snapshot plus
 * the JSON patch in the audit trail.
 *
 * @returns the computed JSON patch
 */
export async function updatePetMetadata(
  petId: string,
  before: PetMetadata | undefined,
  after: PetMetadata | undefined,
  actorId?: string
): Promise<JsonPatchOperation[]> {
  const patch = computeMetadataPatch(before, after);

  // Lazily import to avoid a circular dependency between model and service.
  const { auditLogService } = await import('../services/auditLogService');

  await auditLogService.log({
    action: 'pet.metadata.update',
    resourceType: 'pet',
    resourceId: petId,
    actorId,
    meta: {
      before: before ?? {},
      after: after ?? {},
      patch,
    },
  });

  return patch;
}

/**
 * Pet with additional details for full profile
 */
export interface PetWithDetails extends Pet {
  age?: number;
  weight?: number;
  weightKg?: number;
  gender?: 'male' | 'female';
  color?: string;
  medicalHistory: MedicalHistoryRecord[];
  vaccinations: VaccinationRecord[];
  medications: MedicationRecord[];
  qrCode?: string;
}
