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

type ApiErr = { response?: { data?: { message?: string } }; message?: string };

function errMsg(err: unknown, fallback: string): string {
  const e = err as ApiErr;
  return e?.response?.data?.message ?? e?.message ?? fallback;
}

/**
 * Get a pet by ID.
 */
export const getPetById = async (petId: string): Promise<ApiResponse<Pet>> => {
  try {
    const response = await apiClient.get<Pet>(`/pets/${petId}`);
    return { success: true, data: response.data };
  } catch (err: unknown) {
    return { success: false, error: errMsg(err, 'Failed to fetch pet') };
  }
};

/**
 * Get all pets with optional filtering.
 */
export const getAllPets = async (ownerId?: string): Promise<ApiResponse<Pet[]>> => {
  try {
    const params = ownerId ? { ownerId } : {};
    const response = await apiClient.get<Pet[]>('/pets', { params });
    return { success: true, data: response.data };
  } catch (err: unknown) {
    return { success: false, error: errMsg(err, 'Failed to fetch pets') };
  }
};

/**
 * Create a new pet.
 */
export const createPet = async (petData: CreatePetInput): Promise<ApiResponse<Pet>> => {
  try {
    const response = await apiClient.post<Pet>('/pets', petData);
    return { success: true, data: response.data, message: 'Pet created successfully' };
  } catch (err: unknown) {
    return { success: false, error: errMsg(err, 'Failed to create pet') };
  }
};

/**
 * Update an existing pet.
 */
export const updatePet = async (
  petId: string,
  petData: UpdatePetInput,
): Promise<ApiResponse<Pet>> => {
  try {
    const response = await apiClient.put<Pet>(`/pets/${petId}`, petData);
    return { success: true, data: response.data, message: 'Pet updated successfully' };
  } catch (err: unknown) {
    return { success: false, error: errMsg(err, 'Failed to update pet') };
  }
};

/**
 * Delete a pet.
 */
export const deletePet = async (petId: string): Promise<ApiResponse<void>> => {
  try {
    await apiClient.delete(`/pets/${petId}`);
    return { success: true, message: 'Pet deleted successfully' };
  } catch (err: unknown) {
    return { success: false, error: errMsg(err, 'Failed to delete pet') };
  }
};

/**
 * Get a pet by QR code.
 */
export const getPetByQRCode = async (qrCode: string): Promise<ApiResponse<Pet>> => {
  try {
    const response = await apiClient.get<Pet>(`/pets/qr/${qrCode}`);
    return { success: true, data: response.data };
  } catch (err: unknown) {
    return { success: false, error: errMsg(err, 'Failed to fetch pet by QR code') };
  }
};
