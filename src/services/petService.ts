import axios from 'axios';

import apiClient from './apiClient';
import { parseQRCodeData } from './qrCodeService';
import { pickImage, compressImage, uploadToStorage } from '../utils/imageUtils';

export interface PetOwnerSummary {
  id: string;
  name: string;
  email: string;
}

export interface Pet {
  id: string;
  name: string;
  species: string;
  breed?: string;
  dateOfBirth?: string;
  microchipId?: string;
  photoUrl?: string;
  ownerId: string;
  owner?: PetOwnerSummary;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePetInput {
  name: string;
  species: string;
  breed?: string;
  dateOfBirth?: string;
  microchipId?: string;
  photoUrl?: string;
  ownerId: string;
}

export interface UpdatePetInput {
  name?: string;
  species?: string;
  breed?: string;
  dateOfBirth?: string;
  microchipId?: string;
  photoUrl?: string;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export class PetServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status?: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'PetServiceError';
  }
}

const QR_DEEP_LINK_PREFIX = 'petchain://pet/';
const PETS_ENDPOINT = '/pets';

function unwrapApiData<T>(payload: ApiResponse<T> | T): T {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'success' in payload &&
    (payload as { success: boolean }).success === true &&
    'data' in payload
  ) {
    return (payload as ApiResponse<T>).data;
  }
  return payload as T;
}

function toPetServiceError(error: unknown): PetServiceError {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const responseBody = error.response?.data as
      | { message?: string; error?: { message?: string; code?: string }; code?: string }
      | undefined;

    const message =
      responseBody?.error?.message ||
      responseBody?.message ||
      error.message ||
      'Pet API request failed';

    const code =
      responseBody?.error?.code ||
      responseBody?.code ||
      (status ? `HTTP_${status}` : 'NETWORK_ERROR');

    return new PetServiceError(message, code, status, error.response?.data);
  }

  if (error instanceof PetServiceError) {
    return error;
  }

  if (error instanceof Error) {
    return new PetServiceError(error.message, 'UNKNOWN_ERROR');
  }

  return new PetServiceError('Unexpected pet service error', 'UNKNOWN_ERROR');
}

function _replacePathParam(template: string, key: string, value: string): string {
  return template.replace(`:${key}`, encodeURIComponent(value));
}

function extractPetIdFromQrScan(scanData: string): string | null {
  const trimmed = scanData.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith(QR_DEEP_LINK_PREFIX)) {
    const rawId = trimmed.slice(QR_DEEP_LINK_PREFIX.length).trim();
    return rawId ? decodeURIComponent(rawId) : null;
  }

  try {
    return parseQRCodeData(trimmed).petId;
  } catch {
    return null;
  }
}

export async function getAllPets(): Promise<Pet[]> {
  try {
    const response = await apiClient.get<ApiResponse<Pet[]> | Pet[]>(PETS_ENDPOINT);
    return unwrapApiData(response.data);
  } catch (error) {
    throw toPetServiceError(error);
  }
}

export async function getPetById(petId: string): Promise<Pet> {
  const normalizedPetId = petId.trim();
  if (!normalizedPetId) {
    throw new PetServiceError('Pet ID is required', 'INVALID_PET_ID');
  }

  try {
    const endpoint = `${PETS_ENDPOINT}/${encodeURIComponent(normalizedPetId)}`;
    const response = await apiClient.get<ApiResponse<Pet> | Pet>(endpoint);
    return unwrapApiData(response.data);
  } catch (error) {
    throw toPetServiceError(error);
  }
}

export async function getPetByQRCode(qrCode: string): Promise<Pet> {
  const scannedValue = qrCode.trim();
  if (!scannedValue) {
    throw new PetServiceError('QR code is required', 'INVALID_QR_CODE');
  }

  try {
    const response = await apiClient.get<ApiResponse<Pet> | Pet>(
      `${PETS_ENDPOINT}/qr/${encodeURIComponent(scannedValue)}`,
    );
    return unwrapApiData(response.data);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      const petId = extractPetIdFromQrScan(scannedValue);
      if (petId) {
        return getPetById(petId);
      }
    }

    throw toPetServiceError(error);
  }
}

export async function createPet(data: CreatePetInput): Promise<Pet> {
  try {
    const response = await apiClient.post<ApiResponse<Pet> | Pet>(PETS_ENDPOINT, data);
    return unwrapApiData(response.data);
  } catch (error) {
    throw toPetServiceError(error);
  }
}

export async function updatePet(petId: string, data: UpdatePetInput): Promise<Pet> {
  const normalizedPetId = petId.trim();
  if (!normalizedPetId) {
    throw new PetServiceError('Pet ID is required', 'INVALID_PET_ID');
  }

  try {
    const endpoint = `${PETS_ENDPOINT}/${encodeURIComponent(normalizedPetId)}`;
    const response = await apiClient.put<ApiResponse<Pet> | Pet>(endpoint, data);
    return unwrapApiData(response.data);
  } catch (error) {
    throw toPetServiceError(error);
  }
}

export async function deletePet(petId: string): Promise<void> {
  const normalizedPetId = petId.trim();
  if (!normalizedPetId) {
    throw new PetServiceError('Pet ID is required', 'INVALID_PET_ID');
  }

  try {
    const endpoint = `${PETS_ENDPOINT}/${encodeURIComponent(normalizedPetId)}`;
    await apiClient.delete<ApiResponse<null> | null>(endpoint);
  } catch (error) {
    throw toPetServiceError(error);
  }
}

export async function uploadPetPhoto(petId: string): Promise<string | null> {
  try {
    const imageResult = await pickImage();
    if (!imageResult) return null;

    const compressed = await compressImage(imageResult.uri);
    const uploadResult = await uploadToStorage(compressed.uri, petId);

    await updatePet(petId, { photoUrl: uploadResult.url });

    return uploadResult.url;
  } catch (error) {
    throw toPetServiceError(error);
  }
}

const petService = {
  getAllPets,
  getPetById,
  getPetByQRCode,
  createPet,
  updatePet,
  deletePet,
  uploadPetPhoto,
};

export default petService;
