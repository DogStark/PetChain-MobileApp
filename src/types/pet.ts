import type { Species } from '../models/Pet';
import type { ID, ISO8601DateString } from './common';

export interface CreatePetPayload {
  name: string;
  species: Species;
  breed?: string;
  dateOfBirth?: ISO8601DateString;
  weightKg?: number;
  microchipId?: string;
  photoUrl?: string;
  ownerId: ID;
}

export type UpdatePetPayload = Partial<Omit<CreatePetPayload, 'ownerId'>> & {
  metadata?: { stepGoal?: number; [key: string]: unknown };
};

export interface PetFilters {
  ownerId?: ID;
  species?: Species;
  search?: string;
  page?: number;
  limit?: number;
}
