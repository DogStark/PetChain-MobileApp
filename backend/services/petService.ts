import apiClient from './apiClient';

/**
 * Pet model returned by backend APIs.
 */
export interface Pet {
  id: string;
  name: string;
  species: string;
  breed?: string;
  age?: number;
  weight?: number;
  color?: string;
  qrCode: string;
  ownerId: string;
  medicalHistory?: MedicalRecord[];
  createdAt: string;
  updatedAt: string;
}


/**
 * Medical record for a pet.
 */
export interface MedicalRecord {
  id: string;
  date: string;
  type: string;
  description: string;
  veterinarian?: string;
}

/**
 * Payload for creating a new pet.
 */
export interface CreatePetInput {
  name: string;
  species: string;
  breed?: string;
  age?: number;
  weight?: number;
  color?: string;
  ownerId: string;
}

/**
 * Payload for updating a pet.
 */
export interface UpdatePetInput {
  name?: string;
  species?: string;
  breed?: string;
  age?: number;
  weight?: number;
  color?: string;
  medicalHistory?: MedicalRecord[];
}

/**
 * API response wrapper.
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
