import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../../backend/services/apiClient';
import {
  API_ENDPOINTS,
  type ApiResponse,
  type GetPetResponse,
  type PetEditPermissionResponse,
  type UpdatePetRequest,
} from '../../backend/types/api';
import { updatePet } from './petService';

export type PetProfileField = keyof UpdatePetRequest;
export type ConflictChoice = 'local' | 'server';

const EDITABLE_FIELDS: readonly PetProfileField[] = [
  'name',
  'species',
  'breed',
  'dateOfBirth',
  'microchipId',
];
const DRAFT_KEY_PREFIX = '@petchain/pet-profile-merge/';

export interface PetProfileConflict {
  field: PetProfileField;
  baseValue: string | undefined;
  localValue: string | undefined;
  serverValue: string | undefined;
  choice?: ConflictChoice;
}

export interface PetProfileMergeDraft {
  petId: string;
  base: GetPetResponse;
  local: GetPetResponse;
  server: GetPetResponse;
  permission: PetEditPermissionResponse;
  conflicts: PetProfileConflict[];
  createdAt: string;
  updatedAt: string;
  offline: boolean;
}

export interface PetProfileMergeStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export class PetProfileMergeError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'INVALID_PET_ID'
      | 'PERMISSION_DENIED'
      | 'STALE_DATA'
      | 'UNRESOLVED_CONFLICTS'
      | 'OFFLINE'
      | 'INVALID_CONFLICT'
      | 'MERGE_FAILED',
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'PetProfileMergeError';
  }
}

const defaultStorage: PetProfileMergeStorage = {
  get: (key) => AsyncStorage.getItem(key),
  set: (key, value) => AsyncStorage.setItem(key, value),
  remove: (key) => AsyncStorage.removeItem(key),
};

function endpoint(template: string, petId: string): string {
  return template.replace(':id', encodeURIComponent(petId));
}

function unwrap<T>(payload: ApiResponse<T> | T): T {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'success' in payload &&
    payload.success === true &&
    'data' in payload
  ) {
    return payload.data;
  }
  return payload as T;
}

function isOfflineError(error: unknown): boolean {
  return axios.isAxiosError(error) && !error.response;
}

function value(pet: GetPetResponse, field: PetProfileField): string | undefined {
  return pet[field];
}

function buildConflicts(
  base: GetPetResponse,
  local: GetPetResponse,
  server: GetPetResponse,
): PetProfileConflict[] {
  return EDITABLE_FIELDS.flatMap((field) => {
    const baseValue = value(base, field);
    const localValue = value(local, field);
    const serverValue = value(server, field);
    return localValue !== serverValue
      ? [{ field, baseValue, localValue, serverValue }]
      : [];
  });
}

function draftKey(petId: string): string {
  return `${DRAFT_KEY_PREFIX}${encodeURIComponent(petId)}`;
}

async function readDraft(
  storage: PetProfileMergeStorage,
  petId: string,
): Promise<PetProfileMergeDraft | null> {
  const serialized = await storage.get(draftKey(petId));
  return serialized ? (JSON.parse(serialized) as PetProfileMergeDraft) : null;
}

async function writeDraft(
  storage: PetProfileMergeStorage,
  draft: PetProfileMergeDraft,
): Promise<void> {
  await storage.set(draftKey(draft.petId), JSON.stringify(draft));
}

async function fetchPermission(petId: string): Promise<PetEditPermissionResponse> {
  const response = await apiClient.get<
    ApiResponse<PetEditPermissionResponse> | PetEditPermissionResponse
  >(endpoint(API_ENDPOINTS.PETS_EDIT_PERMISSION, petId));
  return unwrap(response.data);
}

async function fetchServerPet(petId: string): Promise<GetPetResponse> {
  const response = await apiClient.get<ApiResponse<GetPetResponse> | GetPetResponse>(
    endpoint(API_ENDPOINTS.PETS_GET, petId),
  );
  return unwrap(response.data);
}

export async function startPetProfileMergeReview(
  petId: string,
  localPet: GetPetResponse,
  storage: PetProfileMergeStorage = defaultStorage,
): Promise<PetProfileMergeDraft> {
  const normalizedPetId = petId.trim();
  if (!normalizedPetId) {
    throw new PetProfileMergeError('Pet ID is required', 'INVALID_PET_ID');
  }

  try {
    const permission = await fetchPermission(normalizedPetId);
    if (!permission.canEdit) {
      throw new PetProfileMergeError(
        permission.reason || 'You do not have permission to edit this pet profile',
        'PERMISSION_DENIED',
      );
    }
    const server = await fetchServerPet(normalizedPetId);
    const now = new Date().toISOString();
    const draft: PetProfileMergeDraft = {
      petId: normalizedPetId,
      base: server,
      local: localPet,
      server,
      permission,
      conflicts: buildConflicts(server, localPet, server),
      createdAt: now,
      updatedAt: now,
      offline: false,
    };
    await writeDraft(storage, draft);
    return draft;
  } catch (error) {
    if (error instanceof PetProfileMergeError) throw error;
    const savedDraft = await readDraft(storage, normalizedPetId);
    if (savedDraft && isOfflineError(error)) {
      return { ...savedDraft, offline: true };
    }
    throw new PetProfileMergeError(
      'Unable to load the latest pet profile',
      isOfflineError(error) ? 'OFFLINE' : 'MERGE_FAILED',
      error,
    );
  }
}

export async function choosePetProfileConflict(
  draft: PetProfileMergeDraft,
  field: PetProfileField,
  choice: ConflictChoice,
  storage: PetProfileMergeStorage = defaultStorage,
): Promise<PetProfileMergeDraft> {
  const conflict = draft.conflicts.find((item) => item.field === field);
  if (!conflict) {
    throw new PetProfileMergeError(`No conflict exists for "${field}"`, 'INVALID_CONFLICT');
  }
  if (choice !== 'local' && choice !== 'server') {
    throw new PetProfileMergeError('A local or server choice is required', 'INVALID_CONFLICT');
  }
  const updated: PetProfileMergeDraft = {
    ...draft,
    conflicts: draft.conflicts.map((item) =>
      item.field === field ? { ...item, choice } : item,
    ),
    updatedAt: new Date().toISOString(),
  };
  await writeDraft(storage, updated);
  return updated;
}

function mergeSelectedValues(draft: PetProfileMergeDraft): UpdatePetRequest {
  const result: UpdatePetRequest = {};
  for (const field of EDITABLE_FIELDS) {
    const conflict = draft.conflicts.find((item) => item.field === field);
    const selected = conflict?.choice;
    const selectedValue = selected === 'server' ? value(draft.server, field) : value(draft.local, field);
    const localChanged = value(draft.local, field) !== value(draft.base, field);
    if (selectedValue !== undefined && (selected || localChanged)) {
      result[field] = selectedValue;
    }
  }
  return result;
}

export async function confirmPetProfileMerge(
  draft: PetProfileMergeDraft,
  storage: PetProfileMergeStorage = defaultStorage,
): Promise<GetPetResponse> {
  if (draft.conflicts.some((conflict) => !conflict.choice)) {
    throw new PetProfileMergeError(
      'Resolve every conflicting field before confirming',
      'UNRESOLVED_CONFLICTS',
    );
  }

  try {
    const permission = await fetchPermission(draft.petId);
    if (!permission.canEdit) {
      throw new PetProfileMergeError(
        permission.reason || 'Permission to edit this pet profile has expired',
        'PERMISSION_DENIED',
      );
    }
    const latestServer = await fetchServerPet(draft.petId);
    if (EDITABLE_FIELDS.some((field) => value(latestServer, field) !== value(draft.server, field))) {
      const staleDraft = {
        ...draft,
        server: latestServer,
        updatedAt: new Date().toISOString(),
      };
      await writeDraft(storage, staleDraft);
      throw new PetProfileMergeError(
        'The server profile changed while this review was open',
        'STALE_DATA',
        staleDraft,
      );
    }
    const result = await updatePet(draft.petId, mergeSelectedValues(draft));
    await storage.remove(draftKey(draft.petId));
    return result;
  } catch (error) {
    if (error instanceof PetProfileMergeError) throw error;
    const savedDraft = { ...draft, updatedAt: new Date().toISOString() };
    await writeDraft(storage, savedDraft);
    if (isOfflineError(error)) {
      throw new PetProfileMergeError(
        'Changes are saved as a draft and can be retried when online',
        'OFFLINE',
        savedDraft,
      );
    }
    throw new PetProfileMergeError('Unable to confirm pet profile changes', 'MERGE_FAILED', error);
  }
}

export async function discardPetProfileMerge(
  petId: string,
  storage: PetProfileMergeStorage = defaultStorage,
): Promise<void> {
  const normalizedPetId = petId.trim();
  if (!normalizedPetId) {
    throw new PetProfileMergeError('Pet ID is required', 'INVALID_PET_ID');
  }
  await storage.remove(draftKey(normalizedPetId));
}

export const petProfileMergeFields = EDITABLE_FIELDS;
