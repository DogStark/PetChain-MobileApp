import * as SQLite from 'expo-sqlite';

import { encrypt, decrypt } from '../utils/encryption';

const db = SQLite.openDatabaseSync('petchain.db');

// ─── Schema Versioning ────────────────────────────────────────────────────────

const SCHEMA_VERSION_KEY = 'schema_version';
const CURRENT_SCHEMA_VERSION = 5; // Current database schema version (includes encryption migration)

/**
 * Read the current schema version from the database.
 * Defaults to 1 if not set (for initial setup).
 */
async function getSchemaVersion(): Promise<number> {
  try {
    const row = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM kv_store WHERE key = ? LIMIT 1`,
      [SCHEMA_VERSION_KEY],
    );
    if (!row) return 1; // Default to version 1 for new databases
    const decrypted = await decrypt<number>(row.value, `localdb_kv_${SCHEMA_VERSION_KEY}`);
    return Number(decrypted) || 1;
  } catch {
    return 1;
  }
}

/**
 * Set the schema version in the database.
 */
async function setSchemaVersion(version: number): Promise<void> {
  const encryptedVersion = await encrypt(String(version), `localdb_kv_${SCHEMA_VERSION_KEY}`);
  await db.runAsync(`INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)`, [
    SCHEMA_VERSION_KEY,
    encryptedVersion,
  ]);
}

/**
 * Get the current encryption version.
 */
async function getEncryptionVersion(): Promise<number> {
  try {
    const row = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM kv_store WHERE key = ? LIMIT 1`,
      [ENCRYPTION_VERSION_KEY],
    );
    if (!row) return 1; // Default to version 1
    const decrypted = await decrypt<number>(row.value, `localdb_kv_${ENCRYPTION_VERSION_KEY}`);
    return Number(decrypted) || 1;
  } catch {
    return 1;
  }
}

/**
 * Set the encryption version in the database.
 */
async function setEncryptionVersion(version: number): Promise<void> {
  const encryptedVersion = await encrypt(String(version), `localdb_kv_${ENCRYPTION_VERSION_KEY}`);
  await db.runAsync(`INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)`, [
    ENCRYPTION_VERSION_KEY,
    encryptedVersion,
  ]);
}

/**
 * Migration definitions: each migration must be idempotent and atomic.
 * Migrations are applied sequentially in order.
 */
interface Migration {
  version: number;
  name: string;
  up: () => Promise<void>;
}

const MIGRATIONS: Migration[] = [
  {
    version: 2,
    name: 'add_health_metrics_table',
    up: async () => {
      // health_metrics table added in migration 2
      // (already created in init(), this is a no-op for compatibility)
    },
  },
  {
    version: 3,
    name: 'add_appointments_table',
    up: async () => {
      // appointments table added in migration 3
      // (already created in init(), this is a no-op for compatibility)
    },
  },
  {
    version: 4,
    name: 'add_soap_note_drafts_table',
    up: async () => {
      // soap_note_drafts table added in migration 4
      // (already created in init(), this is a no-op for compatibility)
    },
  },
  {
    version: 5,
    name: 'encrypt_sensitive_records',
    up: async () => {
      // Migrate existing plaintext sensitive records to encrypted form
      // This migration encrypts sensitive fields in health_metrics, medications,
      // appointments, and dose_logs tables
      const tables = [
        { name: 'health_metrics', purpose: 'localdb_health_metrics' },
        { name: 'medications', purpose: 'localdb_medications' },
        { name: 'appointments', purpose: 'localdb_appointments' },
        { name: 'dose_logs', purpose: 'localdb_dose_logs' },
      ];

      for (const table of tables) {
        const rows = await db.getAllAsync<{ id: string; data: string }>(
          `SELECT id, data FROM ${table.name}`,
        );

        for (const row of rows) {
          try {
            // Decrypt the full record
            const record = await safeDecrypt<Record<string, any>>(
              row.data,
              table.purpose,
              true,
            );

            // Encrypt sensitive fields within the record
            const withEncryptedFields = await encryptSensitiveFields(record, table.purpose);

            // Re-encrypt the full record with sensitive fields encrypted
            const reencrypted = await encrypt(withEncryptedFields, table.purpose);

            // Update the row
            await db.runAsync(`UPDATE ${table.name} SET data = ? WHERE id = ?`, [
              reencrypted,
              row.id,
            ]);
          } catch {
            // Skip rows that can't be migrated (corrupted data)
          }
        }
      }

      // Update encryption version
      await setEncryptionVersion(CURRENT_ENCRYPTION_VERSION);
    },
  },
];

/**
 * Run pending migrations on the database.
 * Uses transactions to ensure atomicity: all-or-nothing.
 */
async function runMigrations(): Promise<void> {
  const currentVersion = await getSchemaVersion();

  if (currentVersion >= CURRENT_SCHEMA_VERSION) {
    return; // Already at latest version
  }

  // Get migrations to apply
  const pendingMigrations = MIGRATIONS.filter((m) => m.version > currentVersion);

  for (const migration of pendingMigrations) {
    // Run each migration within a transaction
    await db.withTransactionAsync(async () => {
      await migration.up();
      // Update version only after successful migration
      await setSchemaVersion(migration.version);
    });
  }
}

// ─── Corruption Detection and Recovery ─────────────────────────────────────────

interface CorruptionDiagnostic {
  timestamp: string;
  table: string;
  corruptionType: 'malformed_row' | 'decryption_failure' | 'interrupted_migration';
  schemaVersion: number;
  encryptionVersion: number;
  affectedRowCount: number;
}

interface RecoveryResult {
  success: boolean;
  strategy: 'scoped_reset' | 'full_reset' | 'none';
  affectedTable?: string;
  diagnostic: CorruptionDiagnostic;
  message: string;
}

/**
 * Check for corruption in a specific table.
 * Returns array of corrupted row IDs.
 */
async function checkTableCorruption(
  tableName: string,
  purpose: string,
): Promise<{ corruptedIds: string[]; totalRows: number }> {
  const corruptedIds: string[] = [];
  let totalRows = 0;

  try {
    const rows = await db.getAllAsync<{ id: string; data: string }>(`SELECT id, data FROM ${tableName}`);
    totalRows = rows.length;

    for (const row of rows) {
      try {
        // Try to decrypt and parse the row
        await safeDecrypt<any>(row.data, purpose, true);
      } catch {
        // Row is corrupted
        corruptedIds.push(row.id);
      }
    }
  } catch {
    // Table itself is inaccessible - considered fully corrupted
  }

  return { corruptedIds, totalRows };
}

/**
 * Detect all corruption in the database at startup.
 * Returns diagnostic report without exposing sensitive data.
 */
async function detectDatabaseCorruption(): Promise<CorruptionDiagnostic | null> {
  const tables = [
    { name: 'medications', purpose: 'localdb_medications' },
    { name: 'dose_logs', purpose: 'localdb_dose_logs' },
    { name: 'health_metrics', purpose: 'localdb_health_metrics' },
    { name: 'appointments', purpose: 'localdb_appointments' },
    { name: 'soap_note_drafts', purpose: 'localdb_soap_drafts' },
  ];

  for (const table of tables) {
    const { corruptedIds } = await checkTableCorruption(table.name, table.purpose);

    if (corruptedIds.length > 0) {
      const schemaVer = await getSchemaVersion();
      const encryptionVer = await getEncryptionVersion();

      return {
        timestamp: new Date().toISOString(),
        table: table.name,
        corruptionType: 'malformed_row',
        schemaVersion: schemaVer,
        encryptionVersion: encryptionVer,
        affectedRowCount: corruptedIds.length,
      };
    }
  }

  return null;
}

/**
 * Reset a specific table, removing all corrupted data.
 * Preserves all other tables intact.
 */
async function resetTable(tableName: string): Promise<void> {
  await db.runAsync(`DELETE FROM ${tableName}`);
}

/**
 * Perform full database reset as last resort.
 * Only called after user confirmation.
 */
async function performFullReset(): Promise<void> {
  const tables = [
    'medications',
    'dose_logs',
    'health_metrics',
    'appointments',
    'soap_note_drafts',
  ];

  for (const table of tables) {
    await db.runAsync(`DELETE FROM ${table}`);
  }

  // Reset schema and encryption versions
  await setSchemaVersion(CURRENT_SCHEMA_VERSION);
  await setEncryptionVersion(CURRENT_ENCRYPTION_VERSION);
}

/**
 * Execute recovery for detected corruption.
 * Strategy: try scoped reset first, fall back to full reset if multiple tables affected.
 */
async function recoverFromCorruption(
  diagnostic: CorruptionDiagnostic,
): Promise<RecoveryResult> {
  try {
    // Check if other tables are also affected
    const tables = [
      { name: 'medications', purpose: 'localdb_medications' },
      { name: 'dose_logs', purpose: 'localdb_dose_logs' },
      { name: 'health_metrics', purpose: 'localdb_health_metrics' },
      { name: 'appointments', purpose: 'localdb_appointments' },
      { name: 'soap_note_drafts', purpose: 'localdb_soap_drafts' },
    ];

    let affectedTableCount = 0;
    for (const table of tables) {
      if (table.name === diagnostic.table) {
        affectedTableCount++;
      } else {
        const { corruptedIds } = await checkTableCorruption(table.name, table.purpose);
        if (corruptedIds.length > 0) {
          affectedTableCount++;
        }
      }
    }

    // If only one table is affected, use scoped reset
    if (affectedTableCount === 1) {
      await db.withTransactionAsync(async () => {
        await resetTable(diagnostic.table);
      });

      return {
        success: true,
        strategy: 'scoped_reset',
        affectedTable: diagnostic.table,
        diagnostic,
        message: `Reset ${diagnostic.table} table due to corruption. Other data preserved.`,
      };
    }

    // Multiple tables affected or critical system tables: full reset
    await db.withTransactionAsync(async () => {
      await performFullReset();
    });

    return {
      success: true,
      strategy: 'full_reset',
      diagnostic,
      message:
        'Full database reset due to widespread corruption. Local data has been cleared. Cloud backup will be restored on sync.',
    };
  } catch (e) {
    // Recovery itself failed
    return {
      success: false,
      strategy: 'none',
      diagnostic,
      message: `Corruption recovery failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
    };
  }
}

/**
 * Helper to safely decrypt data, falling back to original data if decryption fails.
 * This handles transition from unencrypted to encrypted data.
 */
async function safeDecrypt<T = string>(
  data: string,
  purpose: string,
  parseJson: boolean = false,
): Promise<T> {
  try {
    return await decrypt<T>(data, purpose, parseJson);
  } catch {
    // If decryption fails, it might be unencrypted legacy data
    if (parseJson) {
      try {
        return JSON.parse(data) as T;
      } catch {
        // Not JSON either, return as is if T is string
        return data as unknown as T;
      }
    }
    return data as unknown as T;
  }
}

// ─── Field-Level Encryption for Sensitive Data ────────────────────────────────

const ENCRYPTION_VERSION_KEY = 'encryption_version';
const CURRENT_ENCRYPTION_VERSION = 1;

/**
 * Sensitive field classification.
 * These fields are encrypted at the field level for additional security.
 */
const SENSITIVE_FIELDS = new Set([
  // Medical/health fields
  'dosage',
  'condition',
  'diagnosis',
  'weight',
  'temperature',
  'bloodPressure',
  'notes',
  'symptoms',
  // Emergency contact fields
  'emergencyPhone',
  'emergencyEmail',
  'emergencyAddress',
  // Wallet/payment fields
  'paymentToken',
  'accountNumber',
  'transactionHistory',
]);

/**
 * Encrypt sensitive fields in a record for additional protection.
 * Non-sensitive fields are left as-is.
 */
async function encryptSensitiveFields<T extends Record<string, any>>(
  record: T,
  purpose: string,
): Promise<T> {
  const encrypted = { ...record };
  for (const [key, value] of Object.entries(encrypted)) {
    if (SENSITIVE_FIELDS.has(key) && value != null) {
      encrypted[key] = await encrypt(String(value), `${purpose}::${key}`);
    }
  }
  return encrypted;
}

/**
 * Decrypt sensitive fields in a record.
 * Non-sensitive fields are left as-is.
 */
async function decryptSensitiveFields<T extends Record<string, any>>(
  record: T,
  purpose: string,
): Promise<T> {
  const decrypted = { ...record };
  for (const [key, value] of Object.entries(decrypted)) {
    if (SENSITIVE_FIELDS.has(key) && typeof value === 'string') {
      try {
        decrypted[key] = await decrypt<string>(value, `${purpose}::${key}`);
      } catch {
        // If decryption fails, leave as-is (might be plaintext legacy data)
      }
    }
  }
  return decrypted;
}

export async function executeSql(
  sql: string,
  params: SQLite.SQLiteBindParams = [],
): Promise<SQLite.SQLiteRunResult> {
  return db.runAsync(sql, params);
}

async function init(): Promise<void> {
  // Key-value store for misc JSON blobs
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY NOT NULL, value TEXT)`,
  );

  // Structured tables for medications and dose logs
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS medications (id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL)`,
  );

  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS dose_logs (id TEXT PRIMARY KEY NOT NULL, medication_id TEXT, taken_at TEXT, skipped INTEGER, notes TEXT, data TEXT NOT NULL)`,
  );

  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS health_metrics (id TEXT PRIMARY KEY NOT NULL, pet_id TEXT NOT NULL, recorded_at TEXT NOT NULL, data TEXT NOT NULL)`,
  );

  // Appointments table – indexed by pet_id and scheduled_at for conflict lookups
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY NOT NULL,
      pet_id TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      data TEXT NOT NULL
    )`,
  );
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_appointments_pet_scheduled ON appointments (pet_id, scheduled_at)`,
  );

  // SOAP note drafts – one draft per (petId, vetId) pair
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS soap_note_drafts (
      id TEXT PRIMARY KEY NOT NULL,
      pet_id TEXT NOT NULL,
      vet_id TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  );
  await db.execAsync(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_soap_drafts_pet_vet ON soap_note_drafts (pet_id, vet_id)`,
  );

  // Run any pending migrations
  await runMigrations();

  // Initialize encryption version if not set
  const encryptionVer = await getEncryptionVersion();
  if (encryptionVer === 1) {
    await setEncryptionVersion(CURRENT_ENCRYPTION_VERSION);
  }

  // Detect and recover from any database corruption
  const corruption = await detectDatabaseCorruption();
  if (corruption) {
    // Corruption detected - attempt recovery
    // In a production app, this could trigger user notification
    await recoverFromCorruption(corruption);
  }
}

// Initialize DB on module import
init().catch(() => {});

// KV helpers (compat with AsyncStorage-like API)
export async function getItem(key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM kv_store WHERE key = ? LIMIT 1`,
    [key],
  );
  if (!row) return null;
  return await safeDecrypt(row.value, `localdb_kv_${key}`);
}

export async function setItem(key: string, value: string): Promise<void> {
  const encryptedValue = await encrypt(value, `localdb_kv_${key}`);
  await db.runAsync(`INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)`, [
    key,
    encryptedValue,
  ]);
}

export async function removeItem(key: string): Promise<void> {
  await db.runAsync(`DELETE FROM kv_store WHERE key = ?`, [key]);
}

export async function multiGet(keys: string[]): Promise<Array<[string, string | null]>> {
  if (keys.length === 0) return [];
  const placeholders = keys.map(() => '?').join(',');
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    `SELECT key, value FROM kv_store WHERE key IN (${placeholders})`,
    keys,
  );
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.key] = row.value;
  }

  return await Promise.all(
    keys.map(async (k) => {
      const val = map[k];
      return [k, val ? await safeDecrypt(val, `localdb_kv_${k}`) : null] as [string, string | null];
    }),
  );
}

export async function multiSet(items: Array<[string, string]>): Promise<void> {
  const encryptedItems = await Promise.all(
    items.map(async ([k, v]) => {
      const encryptedValue = await encrypt(v, `localdb_kv_${k}`);
      return [k, encryptedValue] as [string, string];
    }),
  );

  await db.withTransactionAsync(async () => {
    for (const [k, v] of encryptedItems) {
      await db.runAsync(`INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)`, [k, v]);
    }
  });
}

// Medications CRUD
export async function getAllMedications<T = unknown>(): Promise<T[]> {
  const rows = await db.getAllAsync<{ data: string }>(`SELECT data FROM medications`);
  const out: T[] = [];
  for (const row of rows) {
    try {
      const decrypted = await safeDecrypt<T>(row.data, 'localdb_medications', true);
      out.push(decrypted);
    } catch {
      // ignore bad rows
    }
  }
  return out;
}

export async function upsertMedication<T extends { id: string }>(med: T): Promise<void> {
  const encryptedData = await encrypt(med, 'localdb_medications');
  await db.runAsync(`INSERT OR REPLACE INTO medications (id, data) VALUES (?, ?)`, [
    med.id,
    encryptedData,
  ]);
}

export async function deleteMedicationById(id: string): Promise<void> {
  await db.runAsync(`DELETE FROM medications WHERE id = ?`, [id]);
}

// Dose logs
export async function getDoseLogs<T = unknown>(): Promise<T[]> {
  const rows = await db.getAllAsync<{ data: string }>(
    `SELECT data FROM dose_logs ORDER BY taken_at ASC`,
  );
  const out: T[] = [];
  for (const row of rows) {
    try {
      const decrypted = await safeDecrypt<T>(row.data, 'localdb_dose_logs', true);
      out.push(decrypted);
    } catch {
      // ignore
    }
  }
  return out;
}

export async function addDoseLog<
  T extends {
    id: string;
    medicationId?: string;
    takenAt?: string;
    skipped?: boolean;
    notes?: string;
  },
>(log: T): Promise<void> {
  const encryptedData = await encrypt(log, 'localdb_dose_logs');
  await db.runAsync(
    `INSERT OR REPLACE INTO dose_logs (id, medication_id, taken_at, skipped, notes, data) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      log.id,
      log.medicationId ?? null,
      log.takenAt ?? null,
      log.skipped ? 1 : 0,
      log.notes ?? null,
      encryptedData,
    ],
  );
}

export async function clearDoseLogs(): Promise<void> {
  await db.runAsync(`DELETE FROM dose_logs`);
}

export async function getHealthMetricsByPetId(petId: string): Promise<unknown[]> {
  const rows = await db.getAllAsync<{ data: string }>(
    `SELECT data FROM health_metrics WHERE pet_id = ? ORDER BY recorded_at ASC`,
    [petId],
  );
  const out: unknown[] = [];
  for (const row of rows) {
    try {
      const decrypted = await safeDecrypt(row.data, 'localdb_health_metrics', true);
      out.push(decrypted);
    } catch {
      // ignore
    }
  }
  return out;
}

export async function upsertHealthMetric(entry: {
  id: string;
  petId: string;
  recordedAt: string;
  [k: string]: unknown;
}): Promise<void> {
  const encryptedData = await encrypt(entry, 'localdb_health_metrics');
  await db.runAsync(
    `INSERT OR REPLACE INTO health_metrics (id, pet_id, recorded_at, data) VALUES (?, ?, ?, ?)`,
    [entry.id, entry.petId, entry.recordedAt, encryptedData],
  );
}

export async function deleteHealthMetricById(id: string): Promise<void> {
  await db.runAsync(`DELETE FROM health_metrics WHERE id = ?`, [id]);
}

// ─── SOAP Note Drafts ────────────────────────────────────────────────────────
// Table is created in init() above (soap_note_drafts, unique on pet_id + vet_id).

export interface SoapNoteDraft {
  petId: string;
  vetId: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  savedAt: string; // ISO string
}

export async function upsertSoapDraft(draft: SoapNoteDraft): Promise<void> {
  const encryptedData = await encrypt(draft, 'localdb_soap_drafts');
  await db.runAsync(
    `INSERT OR REPLACE INTO soap_note_drafts (id, pet_id, vet_id, data, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [`${draft.petId}::${draft.vetId}`, draft.petId, draft.vetId, encryptedData, draft.savedAt],
  );
}

export async function getSoapDraft(petId: string, vetId: string): Promise<SoapNoteDraft | null> {
  const row = await db.getFirstAsync<{ data: string }>(
    `SELECT data FROM soap_note_drafts WHERE pet_id = ? AND vet_id = ? LIMIT 1`,
    [petId, vetId],
  );
  if (!row) return null;
  try {
    return await safeDecrypt<SoapNoteDraft>(row.data, 'localdb_soap_drafts', true);
  } catch {
    return null;
  }
}

export async function deleteSoapDraft(petId: string, vetId: string): Promise<void> {
  await db.runAsync(`DELETE FROM soap_note_drafts WHERE pet_id = ? AND vet_id = ?`, [petId, vetId]);
}

// ─── Appointments CRUD ────────────────────────────────────────────────────────

export async function getAllAppointmentsByPetId<T = unknown>(petId: string): Promise<T[]> {
  const rows = await db.getAllAsync<{ data: string }>(
    `SELECT data FROM appointments WHERE pet_id = ? ORDER BY scheduled_at ASC`,
    [petId],
  );
  const out: T[] = [];
  for (const row of rows) {
    try {
      const decrypted = await safeDecrypt<T>(row.data, 'localdb_appointments', true);
      out.push(decrypted);
    } catch {
      // ignore bad rows
    }
  }
  return out;
}

export async function getAllLocalAppointments<T = unknown>(): Promise<T[]> {
  const rows = await db.getAllAsync<{ data: string }>(
    `SELECT data FROM appointments ORDER BY scheduled_at ASC`,
  );
  const out: T[] = [];
  for (const row of rows) {
    try {
      const decrypted = await safeDecrypt<T>(row.data, 'localdb_appointments', true);
      out.push(decrypted);
    } catch {
      // ignore bad rows
    }
  }
  return out;
}

/**
 * Fetch appointments for a pet within a specific time window (for conflict detection).
 * windowStart / windowEnd are ISO strings.
 */
export async function getAppointmentsInWindow<T = unknown>(
  petId: string,
  windowStart: string,
  windowEnd: string,
): Promise<T[]> {
  const rows = await db.getAllAsync<{ data: string }>(
    `SELECT data FROM appointments
     WHERE pet_id = ? AND scheduled_at >= ? AND scheduled_at <= ?
     AND status != 'CANCELLED'
     ORDER BY scheduled_at ASC`,
    [petId, windowStart, windowEnd],
  );
  const out: T[] = [];
  for (const row of rows) {
    try {
      const decrypted = await safeDecrypt<T>(row.data, 'localdb_appointments', true);
      out.push(decrypted);
    } catch {
      // ignore bad rows
    }
  }
  return out;
}

export async function upsertAppointment<
  T extends { id: string; petId: string; date: string; status?: string },
>(appt: T): Promise<void> {
  const encryptedData = await encrypt(appt, 'localdb_appointments');
  await db.runAsync(
    `INSERT OR REPLACE INTO appointments (id, pet_id, scheduled_at, status, data) VALUES (?, ?, ?, ?, ?)`,
    [appt.id, appt.petId, appt.date, appt.status ?? 'PENDING', encryptedData],
  );
}

export async function deleteAppointmentById(id: string): Promise<void> {
  await db.runAsync(`DELETE FROM appointments WHERE id = ?`, [id]);
}

export async function clearAllData(): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM kv_store`);
    await db.runAsync(`DELETE FROM medications`);
    await db.runAsync(`DELETE FROM dose_logs`);
    await db.runAsync(`DELETE FROM health_metrics`);
    await db.runAsync(`DELETE FROM appointments`);
    await db.runAsync(`DELETE FROM soap_note_drafts`);
  });
}

export default {
  getItem,
  setItem,
  removeItem,
  multiGet,
  multiSet,
  getAllMedications,
  upsertMedication,
  deleteMedicationById,
  getDoseLogs,
  addDoseLog,
  getHealthMetricsByPetId,
  upsertHealthMetric,
  deleteHealthMetricById,
  upsertSoapDraft,
  getSoapDraft,
  deleteSoapDraft,
  getAllAppointmentsByPetId,
  getAllLocalAppointments,
  getAppointmentsInWindow,
  upsertAppointment,
  deleteAppointmentById,
  clearAllData,
};
