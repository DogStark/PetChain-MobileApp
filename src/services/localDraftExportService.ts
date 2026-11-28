import CryptoJS from 'crypto-js';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { resilientRequest } from './apiClient';
import { getAllSoapDrafts, queryAll } from './localDB';
import syncEngine from './syncEngine';

const EXPORT_PERMISSION_URL = '/privacy/export/permission';
const EXPORT_FORMAT = 'petchain-local-drafts';
const EXPORT_VERSION = 1;
const PBKDF2_ITERATIONS = 150_000;
const MIN_PASSPHRASE_LENGTH = 12;
const MAX_PASSPHRASE_LENGTH = 256;

export type LocalDraftExportErrorCode =
  | 'PERMISSION_DENIED'
  | 'PERMISSION_UNCONFIRMED'
  | 'NO_DRAFTS'
  | 'SHARING_UNAVAILABLE'
  | 'INVALID_PASSPHRASE';

export class LocalDraftExportError extends Error {
  constructor(
    message: string,
    public readonly code: LocalDraftExportErrorCode,
  ) {
    super(message);
    this.name = 'LocalDraftExportError';
  }
}

interface PendingChangeRow {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  payload: string;
  updated_at: string;
  sync_version: number;
  attempts: number;
}

export interface PendingLocalChange {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  payload: Record<string, unknown>;
  updatedAt: string;
  syncVersion: number;
  attempts: number;
}

export interface LocalDraftSnapshot {
  version: 1;
  createdAt: string;
  clinicalNoteDrafts: Awaited<ReturnType<typeof getAllSoapDrafts>>;
  pendingChanges: PendingLocalChange[];
}

export interface LocalDraftSummary {
  clinicalNoteDraftCount: number;
  pendingChangeCount: number;
  fingerprint: string;
}

interface EncryptedDraftExport {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  algorithm: 'AES-256-CBC+HMAC-SHA256';
  keyDerivation: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
  authenticationTag: string;
}

function statusOf(error: unknown): number | undefined {
  return (error as { response?: { status?: number } })?.response?.status;
}

export function validateDraftExportPassphrase(passphrase: string): void {
  if (
    typeof passphrase !== 'string' ||
    passphrase.length < MIN_PASSPHRASE_LENGTH ||
    passphrase.length > MAX_PASSPHRASE_LENGTH
  ) {
    throw new LocalDraftExportError(
      `Use a passphrase between ${MIN_PASSPHRASE_LENGTH} and ${MAX_PASSPHRASE_LENGTH} characters.`,
      'INVALID_PASSPHRASE',
    );
  }
}

/** Ask the server each time; a previous permission result is never cached. */
export async function getLocalDraftExportPermission(): Promise<void> {
  try {
    const response = await resilientRequest<{ data?: { canExport?: boolean } }>({
      method: 'GET',
      url: EXPORT_PERMISSION_URL,
    });
    if (response.data?.data?.canExport !== true) {
      throw new LocalDraftExportError(
        'The server has not confirmed permission to export these drafts.',
        'PERMISSION_DENIED',
      );
    }
  } catch (error) {
    if (error instanceof LocalDraftExportError) throw error;
    if (statusOf(error) === 403) {
      throw new LocalDraftExportError(
        'You do not have permission to export local drafts.',
        'PERMISSION_DENIED',
      );
    }
    throw new LocalDraftExportError(
      'Export permission could not be confirmed. Check your connection and retry.',
      'PERMISSION_UNCONFIRMED',
    );
  }
}

async function readLocalDraftSnapshot(): Promise<LocalDraftSnapshot> {
  await syncEngine.initialize();
  const [clinicalNoteDrafts, rows] = await Promise.all([
    getAllSoapDrafts(),
    queryAll<PendingChangeRow>(
      `SELECT id, entity_type, entity_id, action, payload, updated_at, sync_version, attempts
       FROM dirty_records ORDER BY updated_at ASC`,
    ),
  ]);

  const pendingChanges = rows.map((row): PendingLocalChange => {
    const payload: unknown = JSON.parse(row.payload);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error(`Pending change ${row.id} could not be read`);
    }
    return {
      id: row.id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      action: row.action,
      payload: payload as Record<string, unknown>,
      updatedAt: row.updated_at,
      syncVersion: row.sync_version,
      attempts: row.attempts,
    };
  });

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    clinicalNoteDrafts,
    pendingChanges,
  };
}

function summarizeSnapshot(snapshot: LocalDraftSnapshot): LocalDraftSummary {
  return {
    clinicalNoteDraftCount: snapshot.clinicalNoteDrafts.length,
    pendingChangeCount: snapshot.pendingChanges.length,
    fingerprint: CryptoJS.SHA256(
      JSON.stringify({
        clinicalNoteDrafts: snapshot.clinicalNoteDrafts,
        pendingChanges: snapshot.pendingChanges,
      }),
    ).toString(CryptoJS.enc.Hex),
  };
}

export async function getLocalDraftSummary(): Promise<LocalDraftSummary> {
  return summarizeSnapshot(await readLocalDraftSnapshot());
}

function encryptSnapshot(snapshot: LocalDraftSnapshot, passphrase: string): EncryptedDraftExport {
  const salt = CryptoJS.lib.WordArray.random(16);
  const iv = CryptoJS.lib.WordArray.random(16);
  const saltHex = salt.toString(CryptoJS.enc.Hex);
  const ivHex = iv.toString(CryptoJS.enc.Hex);
  const key = CryptoJS.PBKDF2(passphrase, salt, {
    keySize: 512 / 32,
    iterations: PBKDF2_ITERATIONS,
    hasher: CryptoJS.algo.SHA256,
  });
  const encryptionKey = CryptoJS.lib.WordArray.create(key.words.slice(0, 8), 32);
  const authenticationKey = CryptoJS.lib.WordArray.create(key.words.slice(8, 16), 32);
  const ciphertext = CryptoJS.AES.encrypt(JSON.stringify(snapshot), encryptionKey, { iv }).ciphertext
    .toString(CryptoJS.enc.Base64);
  const authenticationTag = CryptoJS.HmacSHA256(
    `${EXPORT_VERSION}:${saltHex}:${ivHex}:${ciphertext}`,
    authenticationKey,
  ).toString(CryptoJS.enc.Hex);

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    algorithm: 'AES-256-CBC+HMAC-SHA256',
    keyDerivation: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: saltHex,
    iv: ivHex,
    ciphertext,
    authenticationTag,
  };
}

export async function isLocalDraftExportShareAvailable(): Promise<boolean> {
  return Sharing.isAvailableAsync();
}

/** Rechecks permission and reads the latest local state immediately before export. */
export async function exportLocalDrafts(passphrase: string): Promise<LocalDraftSummary> {
  validateDraftExportPassphrase(passphrase);
  await getLocalDraftExportPermission();
  if (!(await isLocalDraftExportShareAvailable())) {
    throw new LocalDraftExportError(
      'Sharing encrypted exports is not available on this device.',
      'SHARING_UNAVAILABLE',
    );
  }

  const snapshot = await readLocalDraftSnapshot();
  const summary = summarizeSnapshot(snapshot);
  if (summary.clinicalNoteDraftCount + summary.pendingChangeCount === 0) {
    throw new LocalDraftExportError('There are no local drafts or pending changes to export.', 'NO_DRAFTS');
  }

  const directory = FileSystem.cacheDirectory;
  if (!directory) throw new Error('Temporary storage is not available for the encrypted export');
  const fileUri = `${directory}petchain-local-drafts-${Date.now()}.json`;

  try {
    await FileSystem.writeAsStringAsync(
      fileUri,
      JSON.stringify(encryptSnapshot(snapshot, passphrase), null, 2),
      { encoding: FileSystem.EncodingType.UTF8 },
    );
    await Sharing.shareAsync(fileUri, {
      mimeType: 'application/json',
      dialogTitle: 'Save your encrypted PetChain drafts',
    });
  } finally {
    await FileSystem.deleteAsync(fileUri, { idempotent: true });
  }

  return summary;
}
