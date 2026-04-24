/**
 * Pet model for mobile app
 */

export type Species = 'dog' | 'cat' | 'bird' | 'rabbit' | 'other';

export interface Pet {
  id: string;
  name: string;
  species: Species;
  breed?: string;
  dateOfBirth?: string;
  microchipId?: string;
  photoUrl?: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface PetFormData {
  name: string;
  species: Species;
  breed?: string;
  dateOfBirth?: string;
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
