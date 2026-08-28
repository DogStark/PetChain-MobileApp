import { gqlRequest } from './graphqlClient';
import {
  getMedicalRecords,
  type MedicalRecord,
  type RecordFilters,
  type PaginatedResponse,
} from './medicalRecordService';
import { getPetById, getAllPets, type Pet } from './petService';

// --- Queries ---

const PET_QUERY = `
  query GetPet($id: ID!) {
    pet(id: $id) {
      id name species breed dateOfBirth microchipId photoUrl createdAt updatedAt
      owner { id name email }
    }
  }
`;

const ALL_PETS_QUERY = `
  query GetAllPets {
    pets {
      id name species breed photoUrl ownerId createdAt updatedAt
    }
  }
`;

const MEDICAL_RECORDS_QUERY = `
  query GetMedicalRecords($petId: ID!, $type: String, $startDate: String, $endDate: String, $page: Int, $limit: Int) {
    medicalRecords(petId: $petId, type: $type, startDate: $startDate, endDate: $endDate, page: $page, limit: $limit) {
      data { id petId type date veterinarian notes createdAt }
      total page limit totalPages
    }
  }
`;

// --- Fetchers with REST fallback ---

export async function fetchPet(petId: string): Promise<Pet> {
  try {
    const result = await gqlRequest<{ pet: Pet }>(PET_QUERY, { id: petId });
    return result.pet;
  } catch {
    return getPetById(petId);
  }
}

export async function fetchAllPets(): Promise<Pet[]> {
  try {
    const result = await gqlRequest<{ pets: Pet[] }>(ALL_PETS_QUERY);
    return result.pets;
  } catch {
    return getAllPets();
  }
}

export async function fetchMedicalRecords(
  petId: string,
  filters?: RecordFilters,
): Promise<PaginatedResponse<MedicalRecord>> {
  try {
    const result = await gqlRequest<{ medicalRecords: PaginatedResponse<MedicalRecord> }>(
      MEDICAL_RECORDS_QUERY,
      { petId, ...filters },
    );
    return result.medicalRecords;
  } catch {
    const response = await getMedicalRecords(petId, filters);
    return response.data;
  }
}
