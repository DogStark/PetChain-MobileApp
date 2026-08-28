import apiClient from './apiClient';
import { getItem, setItem } from './localDB';
import { type SyncEntityType } from './syncService';

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

export type CloudProvider = 'server' | 'icloud' | 'google_drive';

/** Status for a single entity type's last sync attempt */
export type EntitySyncStatus = 'success' | 'failed' | 'pending' | 'never';

export interface EntitySyncRecord {
  status: EntitySyncStatus;
  /** ISO timestamp of the last successful sync, null if never succeeded */
  lastSuccessAt: string | null;
  /** ISO timestamp of the last attempt (success or failure) */
  lastAttemptAt: string | null;
  /** Number of items pending sync */
  pendingCount: number;
  /** Error message from last failure, null if last attempt succeeded */
  lastError: string | null;
}

export interface CloudSyncConfig {
  /** Which provider to use (default: server) */
  provider: CloudProvider;
  /** Entity types included in sync (default: all) */
  syncedEntities: SyncEntityType[];
  /** Auto-sync on network reconnect */
  autoSync: boolean;
}

export interface BackupMetadata {
  backupId: string;
  provider: CloudProvider;
  createdAt: string;
  sizeBytes: number;
  entityCounts: Record<SyncEntityType, number>;
}

export interface RestoreResult {
  restoredAt: string;
  entityCounts: Record<SyncEntityType, number>;
  conflicts: number;
}

/** Result of a partial sync — one entry per entity type attempted */
export interface PartialSyncResult {
  entityType: SyncEntityType;
  status: EntitySyncStatus;
  error?: string;
}

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────

const CONFIG_KEY = '@cloud_sync_config';
const LAST_BACKUP_KEY = '@cloud_sync_last_backup';
const ENTITY_SYNC_STATUS_KEY = '@cloud_sync_entity_status';

const DEFAULT_CONFIG: CloudSyncConfig = {
  provider: 'server',
  syncedEntities: ['pet', 'appointment', 'medication', 'medicalRecord'],
  autoSync: true,
};

const ALL_ENTITY_TYPES: SyncEntityType[] = ['pet', 'appointment', 'medication', 'medicalRecord'];

const DEFAULT_ENTITY_SYNC_RECORD: EntitySyncRecord = {
  status: 'never',
  lastSuccessAt: null,
  lastAttemptAt: null,
  pendingCount: 0,
  lastError: null,
};

// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────

export async function getCloudSyncConfig(): Promise<CloudSyncConfig> {
  try {
    const stored = await getItem(CONFIG_KEY);
    return stored ? { ...DEFAULT_CONFIG, ...JSON.parse(stored) } : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function updateCloudSyncConfig(
  updates: Partial<CloudSyncConfig>,
): Promise<CloudSyncConfig> {
  const current = await getCloudSyncConfig();
  const updated = { ...current, ...updates };
  await setItem(CONFIG_KEY, JSON.stringify(updated));
  return updated;
}

// ─────────────────────────────────────────────────────────────
// ENTITY SYNC STATUS
// ─────────────────────────────────────────────────────────────

/**
 * Retrieve per-entity-type sync status records.
 * Returns a map of entity type → EntitySyncRecord.
 */
export async function getEntitySyncStatuses(): Promise<Record<SyncEntityType, EntitySyncRecord>> {
  try {
    const stored = await getItem(ENTITY_SYNC_STATUS_KEY);
    const saved: Partial<Record<SyncEntityType, EntitySyncRecord>> = stored
      ? JSON.parse(stored)
      : {};
    const result = {} as Record<SyncEntityType, EntitySyncRecord>;
    for (const entityType of ALL_ENTITY_TYPES) {
      result[entityType] = { ...DEFAULT_ENTITY_SYNC_RECORD, ...(saved[entityType] ?? {}) };
    }
    return result;
  } catch {
    const result = {} as Record<SyncEntityType, EntitySyncRecord>;
    for (const entityType of ALL_ENTITY_TYPES) {
      result[entityType] = { ...DEFAULT_ENTITY_SYNC_RECORD };
    }
    return result;
  }
}

/**
 * Update the sync record for a single entity type.
 */
export async function updateEntitySyncStatus(
  entityType: SyncEntityType,
  update: Partial<EntitySyncRecord>,
): Promise<void> {
  const current = await getEntitySyncStatuses();
  current[entityType] = { ...current[entityType], ...update };
  await setItem(ENTITY_SYNC_STATUS_KEY, JSON.stringify(current));
}

// ─────────────────────────────────────────────────────────────
// BACKUP
// ─────────────────────────────────────────────────────────────

/**
 * Create a cloud backup.
 *
 * Each entity type is synced independently. A failure on one entity type does
 * NOT roll back or block the others. Per-entity sync status is persisted so
 * the UI can surface exactly which types have pending changes or errors.
 *
 * Server provider: calls the app's own REST API.
 * iCloud / Google Drive: stubs for native module integration.
 */
export async function createBackup(
  userId: string,
  config?: CloudSyncConfig,
): Promise<BackupMetadata> {
  const cfg = config ?? (await getCloudSyncConfig());

  if (cfg.provider === 'server') {
    // Sync each entity type independently so a failure in one does not block others
    const results = await syncEntitiesIndependently(userId, cfg.syncedEntities);

    // Build the backup metadata from the entity counts returned per successful entity
    const entityCounts = {} as Record<SyncEntityType, number>;
    for (const result of results) {
      entityCounts[result.entityType] = 0; // populated by the API response below
    }

    // Create the final backup record on the server; the server uses the already-synced data
    const response = await apiClient.post<BackupMetadata>('/cloud-sync/backup', {
      userId,
      syncedEntities: cfg.syncedEntities,
      partialSyncResults: results,
    });
    await setItem(LAST_BACKUP_KEY, JSON.stringify(response.data));
    return response.data;
  }

  if (cfg.provider === 'icloud') {
    throw new Error(
      'iCloud sync requires the react-native-icloud-storage native module. ' +
        'Install and link it, then replace this stub with the native calls.',
    );
  }

  if (cfg.provider === 'google_drive') {
    throw new Error(
      'Google Drive sync requires @react-native-google-signin/google-signin. ' +
        'Install and configure it, then replace this stub with Drive API calls.',
    );
  }

  throw new Error(`Unknown cloud provider: ${cfg.provider}`);
}

/**
 * Sync each entity type independently. Failures are isolated — a failed
 * entity type does not affect the others. Status is persisted via
 * updateEntitySyncStatus so the UI can display per-entity progress.
 */
export async function syncEntitiesIndependently(
  userId: string,
  entityTypes: SyncEntityType[],
): Promise<PartialSyncResult[]> {
  const results: PartialSyncResult[] = [];

  await Promise.all(
    entityTypes.map(async (entityType) => {
      const attemptedAt = new Date().toISOString();
      try {
        await apiClient.post(`/cloud-sync/sync-entity`, { userId, entityType });

        await updateEntitySyncStatus(entityType, {
          status: 'success',
          lastSuccessAt: attemptedAt,
          lastAttemptAt: attemptedAt,
          pendingCount: 0,
          lastError: null,
        });

        results.push({ entityType, status: 'success' });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);

        await updateEntitySyncStatus(entityType, {
          status: 'failed',
          lastAttemptAt: attemptedAt,
          lastError: errorMessage,
        });

        results.push({ entityType, status: 'failed', error: errorMessage });
        // Intentionally not re-throwing — failures are isolated per entity type
      }
    }),
  );

  return results;
}

// ─────────────────────────────────────────────────────────────
// RESTORE
// ─────────────────────────────────────────────────────────────

export async function restoreFromBackup(userId: string, backupId: string): Promise<RestoreResult> {
  const response = await apiClient.post<RestoreResult>('/cloud-sync/restore', {
    userId,
    backupId,
  });
  return response.data;
}

// ─────────────────────────────────────────────────────────────
// SELECTIVE SYNC
// ─────────────────────────────────────────────────────────────

/**
 * Toggle sync for a specific entity type without affecting others.
 */
export async function toggleEntitySync(
  entityType: SyncEntityType,
  enabled: boolean,
): Promise<CloudSyncConfig> {
  const config = await getCloudSyncConfig();
  const syncedEntities = enabled
    ? [...new Set([...config.syncedEntities, entityType])]
    : config.syncedEntities.filter((e) => e !== entityType);

  return updateCloudSyncConfig({ syncedEntities });
}

// ─────────────────────────────────────────────────────────────
// STATUS
// ─────────────────────────────────────────────────────────────

export async function getLastBackupMetadata(): Promise<BackupMetadata | null> {
  try {
    const stored = await getItem(LAST_BACKUP_KEY);
    return stored ? (JSON.parse(stored) as BackupMetadata) : null;
  } catch {
    return null;
  }
}

export async function listBackups(userId: string): Promise<BackupMetadata[]> {
  const response = await apiClient.get<BackupMetadata[]>(`/cloud-sync/backups/${userId}`);
  return response.data;
}
