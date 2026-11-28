/**
 * #1072 — Deterministic GraphQL cache keys + invalidation for pet mutations.
 *
 * Every pet-derived view is addressed by a stable key so a mutation can
 * invalidate exactly the views it affects:
 *
 *   pets:list:<accountId>            → pet list query
 *   pets:detail:<accountId>:<petId>  → single pet query
 *   pets:dashboard:<accountId>       → dashboard aggregate query
 *
 * Rules:
 *   create  → list + dashboard
 *   update  → list + detail + dashboard
 *   archive → list + detail + dashboard
 *   restore → list + detail + dashboard
 *
 * Invalidation only runs after a mutation resolves successfully, so a failed
 * mutation leaves the prior cache intact. Account switches clear the whole
 * namespace of the previous account.
 */

export type PetMutationKind = 'create' | 'update' | 'archive' | 'restore';

export interface PetCacheKey {
  readonly accountId: string;
  readonly petId?: string;
}

const NAMESPACE = 'pets';

export function petListKey(accountId: string): string {
  return `${NAMESPACE}:list:${accountId}`;
}

export function petDetailKey(accountId: string, petId: string): string {
  return `${NAMESPACE}:detail:${accountId}:${petId}`;
}

export function petDashboardKey(accountId: string): string {
  return `${NAMESPACE}:dashboard:${accountId}`;
}

/** Keys invalidated by a successful mutation of the given kind. */
export function petMutationKeys(kind: PetMutationKind, key: PetCacheKey): string[] {
  const { accountId, petId } = key;
  const keys = [petListKey(accountId), petDashboardKey(accountId)];
  if (kind !== 'create') {
    if (!petId) throw new Error(`petId is required for pet ${kind} invalidation`);
    keys.push(petDetailKey(accountId, petId));
  }
  return keys;
}

export interface PetCacheStore {
  invalidate(keys: string[]): void | Promise<void>;
}

/**
 * Run `mutation` and invalidate the affected keys only if it succeeds.
 * A rejected mutation propagates unchanged and touches no cache entry.
 */
export async function invalidateAfterPetMutation<T>(
  store: PetCacheStore,
  kind: PetMutationKind,
  key: PetCacheKey,
  mutation: () => Promise<T>,
): Promise<T> {
  const result = await mutation();
  await store.invalidate(petMutationKeys(kind, key));
  return result;
}

/** Clear every cached view of the previous account on account switch. */
export async function clearAccountNamespace(
  store: PetCacheStore,
  previousAccountId: string,
): Promise<void> {
  await store.invalidate([
    petListKey(previousAccountId),
    petDashboardKey(previousAccountId),
    `${NAMESPACE}:detail:${previousAccountId}:*`,
  ]);
}

/**
 * InMemoryCache adapter: evicts the given keys (supports a trailing `*`
 * wildcard for the detail namespace) and refetches active queries.
 */
export function createApolloPetCacheStore(cache: {
  extract(): unknown;
  evict(options: { id: string }): boolean;
  gc(): void;
}): PetCacheStore {
  return {
    invalidate(keys: string[]): void {
      for (const key of keys) {
        if (key.endsWith('*')) {
          const prefix = key.slice(0, -1);
          const snapshot = cache.extract() as Record<string, unknown> | undefined;
          for (const rootKey of Object.keys(snapshot ?? {})) {
            if (rootKey.startsWith(prefix)) cache.evict({ id: rootKey });
          }
        } else {
          cache.evict({ id: key });
        }
      }
      cache.gc();
    },
  };
}
