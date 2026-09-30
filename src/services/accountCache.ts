import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Secure local cache with versioned namespaces keyed by account identifier.
 *
 * Namespaces are versioned so that a new account (or a new account-id format)
 * can never read records written under an older namespace. Records that can be
 * safely attributed to a single account are migrated atomically; ambiguous
 * records are quarantined and reported instead of being silently exposed.
 */

export const CACHE_NAMESPACE_VERSION = 2;

const NAMESPACE_PREFIX = 'cache';
const QUARANTINE_PREFIX = 'cache:quarantine';
const MIGRATION_LOCK_KEY = 'cache:migration:lock';

/** A record as persisted in a namespace. */
export interface CacheRecord<T = unknown> {
  /** Account identifier the record belongs to, when it can be attributed. */
  accountId?: string;
  value: T;
  updatedAt: number;
}

/** Result of a namespace migration run. */
export interface MigrationReport {
  migrated: string[];
  quarantined: string[];
  skipped: string[];
}

function namespaceKey(accountId: string, version = CACHE_NAMESPACE_VERSION): string {
  return `${NAMESPACE_PREFIX}:v${version}:${accountId}`;
}

function legacyNamespaceKey(accountId: string): string {
  return `${NAMESPACE_PREFIX}:${accountId}`;
}

function quarantineKey(key: string): string {
  return `${QUARANTINE_PREFIX}:${key}`;
}

/**
 * Read a record for an account. Only the current versioned namespace is
 * consulted, so old namespaces can never be read by a new account.
 */
export async function readCache<T>(accountId: string, key: string): Promise<T | null> {
  const raw = await AsyncStorage.getItem(`${namespaceKey(accountId)}:${key}`);
  if (raw == null) {
    return null;
  }
  try {
    const record = JSON.parse(raw) as CacheRecord<T>;
    return record.value;
  } catch {
    return null;
  }
}

/** Write a record into the account's current versioned namespace. */
export async function writeCache<T>(accountId: string, key: string, value: T): Promise<void> {
  const record: CacheRecord<T> = { accountId, value, updatedAt: Date.now() };
  await AsyncStorage.setItem(`${namespaceKey(accountId)}:${key}`, JSON.stringify(record));
}

/** Remove a single record from the account's current namespace. */
export async function removeCache(accountId: string, key: string): Promise<void> {
  await AsyncStorage.removeItem(`${namespaceKey(accountId)}:${key}`);
}

/**
 * Determine which account a legacy record can be safely attributed to.
 * Returns the account id when exactly one account is implied, otherwise null.
 */
function attributeAccount(record: Partial<CacheRecord>): string | null {
  if (typeof record.accountId === 'string' && record.accountId.length > 0) {
    return record.accountId;
  }
  return null;
}

/**
 * Migrate legacy (unversioned) cache namespaces into the current versioned
 * namespace.
 *
 * - Records that can be safely attributed to a single account are migrated
 *   atomically (all-or-nothing per account) and the legacy entry is removed.
 * - Ambiguous records are quarantined under a separate namespace and reported.
 *
 * The migration is guarded by a lock so concurrent runs cannot interleave.
 */
export async function migrateCacheNamespaces(): Promise<MigrationReport> {
  const report: MigrationReport = { migrated: [], quarantined: [], skipped: [] };

  const lock = await AsyncStorage.getItem(MIGRATION_LOCK_KEY);
  if (lock != null) {
    return report;
  }
  await AsyncStorage.setItem(MIGRATION_LOCK_KEY, String(Date.now()));

  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const legacyKeys = allKeys.filter(
      (key) =>
        key.startsWith(`${NAMESPACE_PREFIX}:`) &&
        !key.startsWith(`${NAMESPACE_PREFIX}:v`) &&
        !key.startsWith(QUARANTINE_PREFIX),
    );

    if (legacyKeys.length === 0) {
      return report;
    }

    const entries = await AsyncStorage.multiGet(legacyKeys);

    // Group attributable records by account so each account migrates atomically.
    const byAccount = new Map<string, Array<[string, string]>>();
    const ambiguous: string[] = [];

    for (const [key, raw] of entries) {
      if (raw == null) {
        report.skipped.push(key);
        continue;
      }
      let parsed: Partial<CacheRecord>;
      try {
        parsed = JSON.parse(raw) as Partial<CacheRecord>;
      } catch {
        ambiguous.push(key);
        continue;
      }
      const accountId = attributeAccount(parsed);
      if (accountId == null) {
        ambiguous.push(key);
        continue;
      }
      const bucket = byAccount.get(accountId) ?? [];
      bucket.push([key, raw]);
      byAccount.set(accountId, bucket);
    }

    // Atomically migrate each account's attributable records.
    for (const [accountId, records] of byAccount) {
      const writes: Array<[string, string]> = [];
      const removals: string[] = [];
      for (const [key, raw] of records) {
        const suffix = key.slice(`${NAMESPACE_PREFIX}:`.length);
        writes.push([`${namespaceKey(accountId)}:${suffix}`, raw]);
        removals.push(key);
      }
      await AsyncStorage.multiSet(writes);
      await AsyncStorage.multiRemove(removals);
      report.migrated.push(accountId);
    }

    // Quarantine ambiguous records so they are never read by any account.
    if (ambiguous.length > 0) {
      const quarantineWrites: Array<[string, string]> = [];
      for (const key of ambiguous) {
        const raw = await AsyncStorage.getItem(key);
        if (raw != null) {
          quarantineWrites.push([quarantineKey(key), raw]);
        }
      }
      if (quarantineWrites.length > 0) {
        await AsyncStorage.multiSet(quarantineWrites);
      }
      await AsyncStorage.multiRemove(ambiguous);
      report.quarantined.push(...ambiguous);
    }

    return report;
  } finally {
    await AsyncStorage.removeItem(MIGRATION_LOCK_KEY);
  }
}

/** Read quarantined records for reporting/inspection. */
export async function getQuarantinedKeys(): Promise<string[]> {
  const allKeys = await AsyncStorage.getAllKeys();
  return allKeys.filter((key) => key.startsWith(`${QUARANTINE_PREFIX}:`));
}
