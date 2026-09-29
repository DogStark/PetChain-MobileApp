/**
 * Account identifier utilities with versioned local cache namespaces.
 *
 * Issue #1102: Changing account-id formats can leave records under an old key
 * namespace and risk showing stale data after sign-in. This module versions
 * cache namespaces, migrates only records that can be safely attributed to a
 * single account, and quarantines ambiguous entries.
 */

export const CACHE_NAMESPACE_VERSION = 2;

const NAMESPACE_PREFIX = 'cache';
const QUARANTINE_PREFIX = 'cache:quarantine';

/**
 * Build a versioned namespace for a given account identifier.
 * Old (unversioned) namespaces can never be produced by this function, so a
 * new account cannot read records written under a legacy namespace.
 */
export function namespaceFor(accountId: string, version: number = CACHE_NAMESPACE_VERSION): string {
  return `${NAMESPACE_PREFIX}:v${version}:${accountId}`;
}

/**
 * Parse a namespaced key into its version and account id.
 * Returns null when the key does not match the expected shape.
 */
export function parseNamespace(key: string): { version: number; accountId: string } | null {
  const match = /^cache:v(\d+):(.+)$/.exec(key);
  if (!match) {
    return null;
  }
  const version = Number(match[1]);
  const accountId = match[2];
  if (!Number.isFinite(version) || accountId.length === 0) {
    return null;
  }
  return { version, accountId };
}

/**
 * A record discovered in local storage that may need migration.
 */
export interface CacheRecord {
  key: string;
  value: string;
  /** Account id the record can be attributed to, if any. */
  accountId?: string;
}

/**
 * Result of a namespace migration pass.
 */
export interface MigrationResult {
  /** Records that were safely attributed and rewritten under the new namespace. */
  migrated: string[];
  /** Records that could not be safely attributed and were quarantined. */
  quarantined: string[];
  /** Records that were already on the current namespace version. */
  skipped: string[];
}

/**
 * Minimal storage surface so this can run against localStorage or a test double.
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

function listKeys(storage: StorageLike): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key !== null) {
      keys.push(key);
    }
  }
  return keys;
}

/**
 * Determine whether a record can be safely attributed to exactly one account.
 * A record is safe when it already carries an account id, or when the caller
 * supplies a single unambiguous account id for the whole migration pass.
 */
function resolveAccountId(record: CacheRecord, fallbackAccountId?: string): string | null {
  if (record.accountId) {
    return record.accountId;
  }
  if (fallbackAccountId) {
    return fallbackAccountId;
  }
  return null;
}

/**
 * Migrate local cache records into the current versioned namespace.
 *
 * - Records already on the current version are skipped.
 * - Records that can be attributed to a single account are rewritten under the
 *   new namespace and the old key is removed (atomic per record).
 * - Records that cannot be attributed are moved to the quarantine namespace and
 *   reported so callers can surface them.
 */
export function migrateCacheNamespaces(
  storage: StorageLike,
  records: CacheRecord[],
  fallbackAccountId?: string,
): MigrationResult {
  const result: MigrationResult = { migrated: [], quarantined: [], skipped: [] };

  for (const record of records) {
    const parsed = parseNamespace(record.key);

    if (parsed && parsed.version === CACHE_NAMESPACE_VERSION) {
      result.skipped.push(record.key);
      continue;
    }

    const accountId = resolveAccountId(record, fallbackAccountId);

    if (!accountId) {
      // Ambiguous: cannot safely attribute to a single account.
      const quarantineKey = `${QUARANTINE_PREFIX}:${record.key}`;
      storage.setItem(quarantineKey, record.value);
      storage.removeItem(record.key);
      result.quarantined.push(record.key);
      continue;
    }

    const targetKey = namespaceFor(accountId);
    // Write the new key before removing the old one so a crash mid-migration
    // never loses the record.
    storage.setItem(targetKey, record.value);
    if (record.key !== targetKey) {
      storage.removeItem(record.key);
    }
    result.migrated.push(record.key);
  }

  return result;
}

/**
 * Collect candidate records from storage for migration. Keys already on the
 * current version are excluded; everything else is returned for evaluation.
 */
export function collectMigratableRecords(storage: StorageLike): CacheRecord[] {
  const records: CacheRecord[] = [];
  for (const key of listKeys(storage)) {
    if (key.startsWith(QUARANTINE_PREFIX)) {
      continue;
    }
    const parsed = parseNamespace(key);
    if (parsed && parsed.version === CACHE_NAMESPACE_VERSION) {
      continue;
    }
    const value = storage.getItem(key);
    if (value === null) {
      continue;
    }
    records.push({ key, value, accountId: parsed ? parsed.accountId : undefined });
  }
  return records;
}
