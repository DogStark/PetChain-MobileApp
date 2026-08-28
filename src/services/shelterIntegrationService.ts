import axios from 'axios';

import apiClient from './apiClient';

export type ShelterProvider = 'petfinder' | 'adopt-a-pet';
export type ShelterSpecies = 'dog' | 'cat' | 'rabbit' | 'other';

export interface ShelterOAuthConnection {
  provider: ShelterProvider;
  authorizationUrl: string;
  state: string;
  mock: boolean;
}

export interface ShelterPetRecord {
  type: 'vaccination' | 'checkup' | 'treatment' | 'diagnosis';
  title: string;
  notes: string;
  visitDate: string;
  veterinarian: string;
  nextVisitDate?: string;
}

export interface ShelterVaccination {
  vaccineName: string;
  administeredAt: string;
  nextDueDate?: string;
  notes?: string;
}

export interface ShelterPet {
  id: string;
  provider: ShelterProvider;
  name: string;
  species: ShelterSpecies;
  breed?: string;
  ageMonths: number;
  location: string;
  shelterName: string;
  shelterContact?: string;
  description: string;
  photoUrl?: string;
  microchipId?: string;
  vaccinations: ShelterVaccination[];
  medicalHistory: ShelterPetRecord[];
  adoptionFee?: string;
  status: 'available' | 'pending' | 'adopted';
  updatedAt: string;
}

export interface BrowseShelterPetsFilters {
  provider?: ShelterProvider;
  species?: ShelterSpecies | 'all';
  breed?: string;
  location?: string;
  ageMinMonths?: number;
  ageMaxMonths?: number;
}

export interface AdoptShelterPetInput {
  provider: ShelterProvider;
  shelterPetId: string;
}

export interface AdoptShelterPetResult {
  pet: {
    id: string;
    name: string;
    species: string;
    breed?: string;
    dateOfBirth?: string;
    microchipId?: string;
    photoUrl?: string;
    ownerId: string;
    createdAt: string;
    updatedAt: string;
  };
  shelterPet: ShelterPet;
  transferredRecords: Array<{
    id: string;
    type: string;
    blockchainTxHash?: string;
    blockchainHash?: string;
    status: 'anchored' | 'pending' | 'failed';
  }>;
}

interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
  message?: string;
}

function unwrap<T>(payload: ApiEnvelope<T> | T): T {
  if (payload && typeof payload === 'object' && 'success' in payload && payload.success) {
    return (payload as ApiEnvelope<T>).data as T;
  }
  return payload as T;
}

function toParams(filters: BrowseShelterPetsFilters = {}): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.provider) params.set('provider', filters.provider);
  if (filters.species) params.set('species', filters.species);
  if (filters.breed?.trim()) params.set('breed', filters.breed.trim());
  if (filters.location?.trim()) params.set('location', filters.location.trim());
  if (typeof filters.ageMinMonths === 'number')
    params.set('ageMinMonths', String(filters.ageMinMonths));
  if (typeof filters.ageMaxMonths === 'number')
    params.set('ageMaxMonths', String(filters.ageMaxMonths));
  return params;
}

export async function getShelterOAuthUrl(
  provider: ShelterProvider,
  redirectUri?: string,
): Promise<ShelterOAuthConnection> {
  const params = redirectUri ? `?redirectUri=${encodeURIComponent(redirectUri)}` : '';
  const response = await apiClient.get<
    ApiEnvelope<ShelterOAuthConnection> | ShelterOAuthConnection
  >(`/shelter/oauth/${encodeURIComponent(provider)}${params}`);
  return unwrap(response.data);
}

export async function browseAdoptablePets(
  filters: BrowseShelterPetsFilters = {},
): Promise<ShelterPet[]> {
  const response = await apiClient.get<ApiEnvelope<ShelterPet[]> | ShelterPet[]>(
    `/shelter/pets?${toParams(filters).toString()}`,
  );
  return unwrap(response.data);
}

export async function adoptShelterPet(input: AdoptShelterPetInput): Promise<AdoptShelterPetResult> {
  const response = await apiClient.post<ApiEnvelope<AdoptShelterPetResult> | AdoptShelterPetResult>(
    '/shelter/adopt',
    input,
  );
  return unwrap(response.data);
}

export class ShelterIntegrationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'ShelterIntegrationError';
  }
}

function toShelterError(error: unknown): ShelterIntegrationError {
  if (axios.isAxiosError(error)) {
    const message =
      (error.response?.data as { message?: string; error?: { message?: string } } | undefined)
        ?.message ??
      (error.response?.data as { error?: { message?: string } } | undefined)?.error?.message ??
      error.message;
    return new ShelterIntegrationError(
      message || 'Shelter integration request failed',
      'HTTP_ERROR',
    );
  }
  return new ShelterIntegrationError(
    error instanceof Error ? error.message : 'Unexpected shelter integration error',
    'UNKNOWN_ERROR',
  );
}

export const shelterIntegrationService = {
  getShelterOAuthUrl: async (provider: ShelterProvider, redirectUri?: string) => {
    try {
      return await getShelterOAuthUrl(provider, redirectUri);
    } catch (error) {
      throw toShelterError(error);
    }
  },
  browseAdoptablePets: async (filters: BrowseShelterPetsFilters = {}) => {
    try {
      return await browseAdoptablePets(filters);
    } catch (error) {
      throw toShelterError(error);
    }
  },
  adoptShelterPet: async (input: AdoptShelterPetInput) => {
    try {
      return await adoptShelterPet(input);
    } catch (error) {
      throw toShelterError(error);
    }
  },
};

export default shelterIntegrationService;
