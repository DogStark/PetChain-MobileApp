import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Local cache storage with versioned, account-scoped namespaces.
 *
 * Namespaces are versioned so that a change to the account-id format cannot
 * leak records written under an older key layout into a new account session.
 * Only records that can be safely attributed to a single account are migrated;
 * anything ambiguous is quarantined and reported instead of being surfaced.
 */

export const CACHE_NAMESPACE_VERSION = 2;

const NAMESPACE_PREFIX = 'cache';
const QUARANTINE_PREFIX = 'cache:quarantine';
const MIGRATION_MARKER_PREFIX = 'cache:migrated';

/** Shape of a single persisted cache record. */
export interface CacheRecord<T = unknown> {
  accountId: string;
  value: T;
  updatedAt: number;
}

/** A record that could not be safely attributed to exactly one account. */
export interface QuarantinedRecord {
  key: string;
  reason: 'ambiguous-account' | 'missing-account' | 'malformed';
  raw: string;
}

/** Result of a namespace migration run. */
export interface MigrationResult {
  migrated: string[];
  quarantined: QuarantinedRecord[];
  skipped: string[];
}

function namespaceFor(accountId: string, version = CACHE_NAMESPACE_VERSION): string {
  return `${NAMESPACE_PREFIX}:v${version}:${accountId}`;
}

function legacyNamespaceFor(accountId: string): string {
  return `${NAMESPACE_PREFIX}:${accountId}`;
}

function scopedKey(accountId: string, key: string, version = CACHE_NAMESPACE_VERSION): string {
  return `${namespaceFor(accountId, version)}:${key}`;
}

function quarantineKey(key: string): string {
  return `${QUARANTINE_PREFIX}:${key}`;
}

function migrationMarker(accountId: string): string {
  return `${MIGRATION_MARKER_PREFIX}:v${CACHE_NAMESPACE_VERSION}:${accountId}`;
}

/**
 * Read a cache record for the given account. Only the current versioned
 * namespace is consulted, so records written under an old namespace can never
 * be read by a new account.
 */
export async function getCacheRecord<T = unknown>(
  accountId: string,
  key: string,
): Promise<CacheRecord<T> | null> {
  const raw = await AsyncStorage.getItem(scopedKey(accountId, key));
  if (raw == null) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as CacheRecord<T>;
    if (parsed == null || parsed.accountId !== accountId) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Write a cache record into the current versioned namespace for the account. */
export async function setCacheRecord<T = unknown>(
  accountId: string,
  key: string,
  value: T,
): Promise<void> {
  const record: CacheRecord<T> = { accountId, value, updatedAt: Date.now() };
  await AsyncStorage.setItem(scopedKey(accountId, key), JSON.stringify(record));
}

/** Remove a single record from the current versioned namespace. */
export async function removeCacheRecord(accountId: string, key: string): Promise<void> {
  await AsyncStorage.removeItem(scopedKey(accountId, key));
}

/**
 * Determine which account a legacy record belongs to. Returns the account id
 * only when the record can be attributed to exactly one account; otherwise
 * returns null so the caller can quarantine it.
 */
function attributeLegacyRecord(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed == null || typeof parsed !== 'object') {
    return null;
  }
  const candidate = parsed as { accountId?: unknown };
  if (typeof candidate.accountId === 'string' && candidate.accountId.length > 0) {
    return candidate.accountId;
  }
  return null;
}

/**
 * Migrate legacy (unversioned) cache records into the current versioned
 * namespace. Records that can be safely attributed to a single account are
 * moved atomically; ambiguous or malformed records are quarantined and
 * reported in the returned result.
 */
export async function migrateCacheNamespace(): Promise<MigrationResult> {
  const result: MigrationResult = { migrated: [], quarantined: [], skipped: [] };

  const allKeys = await AsyncStorage.getAllKeys();
  const legacyKeys = allKeys.filter((key) => {
    if (!key.startsWith(`${NAMESPACE_PREFIX}:`)) {
      return false;
    }
    if (key.startsWith(`${NAMESPACE_PREFIX}:v`)) {
      return false;
    }
    if (key.startsWith(QUARANTINE_PREFIX) || key.startsWith(MIGRATION_MARKER_PREFIX)) {
      return false;
    }
    return true;
  });

  if (legacyKeys.length === 0) {
    return result;
  }

  const entries = await AsyncStorage.multiGet(legacyKeys);
  const writes: [string, string][] = [];
  const removals: string[] = [];

  for (const [key, raw] of entries) {
    if (raw == null) {
      removals.push(key);
      continue;
    }

    const accountId = attributeLegacyRecord(raw);
    if (accountId == null) {
      const reason: QuarantinedRecord['reason'] = raw.trim().startsWith('{')
        ? 'missing-account'
        : 'malformed';
      writes.push([quarantineKey(key), raw]);
      removals.push(key);
      result.quarantined.push({ key, reason, raw });
      continue;
    }

    const suffix = key.slice(`${NAMESPACE_PREFIX}:`.length);
    const recordKey = suffix.includes(':')
      ? suffix.slice(suffix.indexOf(':') + 1)
      : suffix;

    writes.push([scopedKey(accountId, recordKey), raw]);
    removals.push(key);
    result.migrated.push(key);
  }

  // Apply all writes and removals in a single atomic batch so a partial
  // migration cannot leave records readable under both namespaces.
  if (writes.length > 0) {
    await AsyncStorage.multiSet(writes);
  }
  if (removals.length > 0) {
    await AsyncStorage.multiRemove(removals);
  }

  const migratedAccounts = new Set(
    result.migrated.map((key) => {
      const suffix = key.slice(`${NAMESPACE_PREFIX}:`.length);
      return suffix.includes(':') ? suffix.slice(0, suffix.indexOf(':')) : suffix;
    }),
  );
  if (migratedAccounts.size > 0) {
    await AsyncStorage.multiSet(
      Array.from(migratedAccounts).map((accountId) => [migrationMarker(accountId), '1']),
    );
  }

  return result;
}

/** Whether the current namespace version has already been migrated for an account. */
export async function isNamespaceMigrated(accountId: string): Promise<boolean> {
  const marker = await AsyncStorage.getItem(migrationMarker(accountId));
  return marker === '1';
}

/** Read quarantined records so they can be surfaced to the user or telemetry. */
export async function getQuarantinedRecords(): Promise<QuarantinedRecord[]> {
  const allKeys = await AsyncStorage.getAllKeys();
  const keys = allKeys.filter((key) => key.startsWith(`${QUARANTINE_PREFIX}:`));
  if (keys.length === 0) {
    return [];
  }
  const entries = await AsyncStorage.multiGet(keys);
  return entries
    .filter(([, raw]) => raw != null)
    .map(([key, raw]) => ({
      key: key.slice(`${QUARANTINE_PREFIX}:`.length),
      reason: 'ambiguous-account' as const,
      raw: raw as string,
    }));
}

/** Clear all cache records for an account in the current namespace. */
export async function clearAccountCache(accountId: string): Promise<void> {
  const allKeys = await AsyncStorage.getAllKeys();
  const prefix = `${namespaceFor(accountId)}:`;
  const keys = allKeys.filter((key) => key.startsWith(prefix));
  if (keys.length > 0) {
    await AsyncStorage.multiRemove(keys);
  }
}
