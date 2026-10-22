import apiClient from './apiClient';
import { cleanupTempFile, uploadDocument, type DocumentCategory } from './documentService';
import {
  validateMedicalImportFile,
  type AllowedMedicalMimeType,
} from '../utils/medicalFileValidation';

/**
 * Import of documents shared into PetChain from other apps (share extension).
 *
 * Shared files are untrusted. Every file is quarantined on arrival, validated
 * before it can be used, and kept in memory only. Nothing is imported until the
 * user explicitly picks a pet and a destination, and the server confirms the
 * user can access that pet at confirm time. Quarantined files go stale after a
 * short window so a share from earlier cannot be imported against changed data.
 */

/** A quarantined file older than this must be re-shared before it can be imported. */
export const SHARED_IMPORT_STALE_MS = 15 * 60 * 1000;

/** Destinations are the document vault categories a shared file can be filed under. */
export const SHARED_IMPORT_DESTINATIONS = [
  'vaccination',
  'insurance',
  'vet_report',
  'other',
] as const satisfies readonly DocumentCategory[];

export type SharedImportDestination = (typeof SHARED_IMPORT_DESTINATIONS)[number];

export interface SharedFileInput {
  /** Stable id for this share, used as the idempotency key so retries never duplicate. */
  id: string;
  name: string;
  size: number;
  mimeType?: string | null;
  /** Local file uri handed over by the sharing app. */
  uri: string;
  /** Base64 contents, if already loaded, enabling magic-byte checks. */
  base64?: string | null;
}

export type QuarantinedSharedFile =
  | {
      status: 'quarantined';
      id: string;
      name: string;
      size: number;
      uri: string;
      mimeType: AllowedMedicalMimeType;
      receivedAt: number;
    }
  | {
      status: 'rejected';
      id: string;
      name: string;
      size: number;
      uri: string;
      /** Short, user-safe reason. Never contains file contents. */
      reason: string;
      receivedAt: number;
    };

export interface SharedImportSelection {
  petId: string | null;
  destination: SharedImportDestination | null;
}

export type SharedImportErrorCode =
  | 'not-quarantined'
  | 'stale'
  | 'no-pet'
  | 'no-destination'
  | 'pet-not-found'
  | 'forbidden'
  | 'offline'
  | 'server-error'
  | 'upload-failed';

export class SharedImportError extends Error {
  constructor(
    message: string,
    public readonly code: SharedImportErrorCode,
  ) {
    super(message);
    this.name = 'SharedImportError';
  }
}

/**
 * Quarantine a shared file: validate it before any parser or upload sees it.
 * Rejected files are returned (not thrown) so the UI can explain why.
 */
export function quarantineSharedFile(
  input: SharedFileInput,
  now: number = Date.now(),
): QuarantinedSharedFile {
  const base = { id: input.id, name: input.name, size: input.size, uri: input.uri };
  const result = validateMedicalImportFile({
    name: input.name,
    size: input.size,
    mimeType: input.mimeType,
    base64: input.base64,
  });

  if (!result.ok || !result.resolvedType) {
    return { ...base, status: 'rejected', reason: result.message, receivedAt: now };
  }

  return {
    ...base,
    status: 'quarantined',
    mimeType: result.resolvedType,
    receivedAt: now,
  };
}

export function isQuarantineStale(file: QuarantinedSharedFile, now: number = Date.now()): boolean {
  return now - file.receivedAt > SHARED_IMPORT_STALE_MS;
}

/** Pure check that the user has picked everything needed before confirming. */
export function getSelectionError(
  selection: SharedImportSelection,
): SharedImportErrorCode | null {
  if (!selection.petId) return 'no-pet';
  if (!selection.destination) return 'no-destination';
  return null;
}

/**
 * Ask the server whether the current user can access the pet. This deliberately
 * bypasses the pet cache used by getPetById, so a cached pet can never confirm
 * access for a pet the server has since revoked.
 */
export async function confirmPetAccess(petId: string): Promise<void> {
  try {
    await apiClient.get(`/pets/${encodeURIComponent(petId)}`);
  } catch (error) {
    const status = (error as { response?: { status?: number } })?.response?.status;
    if (status === 404) {
      throw new SharedImportError('That pet could not be found.', 'pet-not-found');
    }
    if (status === 401 || status === 403) {
      throw new SharedImportError('You do not have access to that pet.', 'forbidden');
    }
    if (status === undefined) {
      throw new SharedImportError('You appear to be offline. Try again when connected.', 'offline');
    }
    throw new SharedImportError('Could not confirm access to that pet.', 'server-error');
  }
}

/**
 * Import a quarantined file into the selected pet and destination.
 *
 * On a transient failure (offline, server error) the file stays quarantined so
 * the user can retry. The share id is reused as the idempotency key, so a retry
 * after a dropped response cannot create a duplicate document.
 */
export async function confirmSharedImport(
  file: QuarantinedSharedFile,
  selection: SharedImportSelection,
  now: number = Date.now(),
): Promise<{ documentId: string }> {
  if (file.status !== 'quarantined') {
    throw new SharedImportError('This file was rejected and cannot be imported.', 'not-quarantined');
  }
  if (isQuarantineStale(file, now)) {
    throw new SharedImportError('This file is out of date. Share it again to import.', 'stale');
  }

  const selectionError = getSelectionError(selection);
  if (selectionError) {
    throw new SharedImportError('Choose a pet and a destination first.', selectionError);
  }

  const petId = selection.petId as string;
  const destination = selection.destination as SharedImportDestination;

  await confirmPetAccess(petId);

  try {
    const doc = await uploadDocument({
      petId,
      name: file.name,
      category: destination,
      uri: file.uri,
      mimeType: file.mimeType,
      idempotencyKey: `shared-import:${file.id}`,
    });
    await cleanupTempFile(file.uri);
    return { documentId: doc.id };
  } catch (error) {
    throw new SharedImportError(
      error instanceof Error ? error.message : 'The file could not be imported.',
      'upload-failed',
    );
  }
}

/** Discard a shared file and remove its local copy. */
export async function discardSharedFile(file: QuarantinedSharedFile): Promise<void> {
  await cleanupTempFile(file.uri);
}
