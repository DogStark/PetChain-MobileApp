/**
 * Pet model for mobile app
 */

export type Species = 'dog' | 'cat' | 'bird' | 'rabbit' | 'other';

/**
 * Minimal owner reference embedded in a pet payload, so screens can render
 * the owner without a second request. Full owner data lives in `Owner`.
 */
export interface PetOwnerRef {
  /** Owner (user) id — matches `Pet.ownerId` */
  id: string;
  /** Owner display name */
  name: string;
  /** Owner contact email */
  email?: string;
  /** Owner contact phone */
  phone?: string;
}

/**
 * A pet profile as returned by the backend `/pets` API.
 */
export interface Pet {
  /** Unique pet identifier */
  id: string;
  /** Pet's display name */
  name: string;
  /** Species category */
  species: Species;
  /** Breed, when known */
  breed?: string;
  /** ISO-8601 date of birth */
  dateOfBirth?: string;
  /** Age in years — derived from `dateOfBirth` when the backend supplies it */
  age?: number;
  /** Current weight in kilograms */
  weightKg?: number;
  /** 15-character hexadecimal microchip identifier */
  microchipId?: string;
  /** Value encoded in the pet's QR tag, used for scan lookups */
  qrCode?: string;
  /** Remote URL of the pet's profile photo */
  photoUrl?: string;
  /** Id of the owning user */
  ownerId: string;
  /** Embedded owner summary, when the backend expands it */
  owner?: PetOwnerRef;
  /** Ids of medical records linked to this pet */
  medicalRecordIds?: string[];
  /** ISO-8601 creation timestamp */
  createdAt: string;
  /** ISO-8601 last-update timestamp */
  updatedAt: string;
  /** Free-form extras (e.g. daily step goal) */
  metadata?: { stepGoal?: number; [key: string]: unknown };
}

/**
 * Factory to safely create a Pet object from raw data,
 * ensuring all required fields have sensible defaults.
 */
export const createPet = (data: Partial<Pet>): Pet => ({
  id: data.id || '',
  name: data.name || 'Unknown Pet',
  species: data.species || 'other',
  breed: data.breed,
  dateOfBirth: data.dateOfBirth,
  weightKg: data.weightKg,
  age: data.age,
  microchipId: data.microchipId,
  qrCode: data.qrCode,
  photoUrl: data.photoUrl,
  ownerId: data.ownerId || '',
  owner: data.owner,
  medicalRecordIds: data.medicalRecordIds,
  createdAt: data.createdAt || new Date().toISOString(),
  updatedAt: data.updatedAt || new Date().toISOString(),
  metadata: data.metadata,
});

export interface PetFormData {
  name: string;
  species: Species;
  breed?: string;
  dateOfBirth?: string;
  weightKg?: number;
  microchipId?: string;
  photoUrl?: string;
}

export const validatePet = (data: Partial<PetFormData>): string[] => {
  const errors: string[] = [];

  if (!data.name?.trim()) {
    errors.push('Name is required');
  }

  if (!data.species) {
    errors.push('Species is required');
  }

  if (data.microchipId && !/^[0-9A-Fa-f]{15}$/.test(data.microchipId)) {
    errors.push('Microchip ID must be 15 hexadecimal characters');
  }

  if (data.photoUrl && !isValidImageUrl(data.photoUrl)) {
    errors.push('Invalid photo URL format');
  }

  return errors;
};

const isValidImageUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return /\.(jpg|jpeg|png|gif|webp)$/i.test(parsed.pathname);
  } catch {
    return false;
  }
};
