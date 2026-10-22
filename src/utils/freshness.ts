/**
 * Offline emergency-profile freshness policy.
 *
 * Cached emergency information can become outdated while still appearing
 * authoritative to a rescuer. This module centralizes the freshness rules so
 * the emergency UI can prominently display when data was last verified, mark
 * expired data, and offer a minimal safe fallback.
 */

/** Default time-to-live for cached emergency profile data (24 hours). */
export const DEFAULT_FRESHNESS_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Maximum tolerated clock skew between the device clock and the server clock.
 * A verification timestamp that is further in the future than this is treated
 * as untrusted and the data is considered stale.
 */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export type FreshnessState = 'fresh' | 'stale' | 'expired' | 'unknown';

export interface FreshnessInput {
  /** Epoch ms when the cached data was last verified against the server. */
  lastVerifiedAt?: number | null;
  /** Epoch ms of the current time. Defaults to Date.now(). */
  now?: number;
  /** Time-to-live in ms. Defaults to DEFAULT_FRESHNESS_TTL_MS. */
  ttlMs?: number;
}

export interface FreshnessResult {
  state: FreshnessState;
  /** Age of the data in ms, or null when unknown. */
  ageMs: number | null;
  /** Epoch ms when the data expires, or null when unknown. */
  expiresAt: number | null;
  /** True when the data must not be presented as authoritative. */
  isExpired: boolean;
  /** True when the data is still within its TTL and clock is trustworthy. */
  isFresh: boolean;
  /** Human-readable label suitable for prominent display. */
  label: string;
}

/**
 * Evaluate the freshness of cached emergency data.
 *
 * Handles clock skew: a `lastVerifiedAt` that is more than MAX_CLOCK_SKEW_MS
 * in the future relative to `now` is treated as untrusted (expired) rather
 * than fresh, so a manipulated device clock cannot make stale data look new.
 */
export function evaluateFreshness(input: FreshnessInput): FreshnessResult {
  const now = typeof input.now === 'number' ? input.now : Date.now();
  const ttlMs =
    typeof input.ttlMs === 'number' && input.ttlMs > 0
      ? input.ttlMs
      : DEFAULT_FRESHNESS_TTL_MS;
  const lastVerifiedAt = input.lastVerifiedAt;

  if (typeof lastVerifiedAt !== 'number' || !Number.isFinite(lastVerifiedAt)) {
    return {
      state: 'unknown',
      ageMs: null,
      expiresAt: null,
      isExpired: true,
      isFresh: false,
      label: 'Verification time unknown',
    };
  }

  const ageMs = now - lastVerifiedAt;

  // Clock skew: verification timestamp is implausibly in the future.
  if (ageMs < -MAX_CLOCK_SKEW_MS) {
    return {
      state: 'expired',
      ageMs,
      expiresAt: lastVerifiedAt + ttlMs,
      isExpired: true,
      isFresh: false,
      label: 'Verification time unreliable',
    };
  }

  const expiresAt = lastVerifiedAt + ttlMs;
  const isExpired = now >= expiresAt;

  if (isExpired) {
    return {
      state: 'expired',
      ageMs,
      expiresAt,
      isExpired: true,
      isFresh: false,
      label: `Expired ${formatAge(now - expiresAt)} ago`,
    };
  }

  // Within TTL but past the halfway point: surface as stale so the UI can
  // prompt a refresh without blocking the rescuer.
  const isStale = ageMs >= ttlMs / 2;

  return {
    state: isStale ? 'stale' : 'fresh',
    ageMs,
    expiresAt,
    isExpired: false,
    isFresh: true,
    label: isStale
      ? `Verified ${formatAge(ageMs)} ago`
      : `Verified ${formatAge(ageMs)} ago`,
  };
}

/**
 * Minimal safe fallback shown when cached emergency data is expired or
 * unverified. It intentionally contains only non-authoritative guidance so a
 * rescuer is never misled by stale data.
 */
export interface SafeFallback {
  title: string;
  message: string;
  /** Whether the caller should attempt an online refresh. */
  shouldRefresh: boolean;
}

export function getSafeFallback(result: FreshnessResult): SafeFallback {
  if (result.isFresh) {
    return {
      title: 'Emergency information',
      message: 'Showing the most recently verified emergency information.',
      shouldRefresh: result.state === 'stale',
    };
  }

  return {
    title: 'Emergency information may be outdated',
    message:
      'This information could not be verified recently. Do not rely on it. ' +
      'Call emergency services and confirm details directly.',
    shouldRefresh: true,
  };
}

/**
 * Atomically reconcile a refresh result with local edits.
 *
 * A refresh must never replace newer local emergency edits. When the local
 * record has been edited more recently than the incoming server record, the
 * local record wins and the refresh is rejected.
 */
export interface ReconcileInput<T> {
  local: T | null;
  remote: T | null;
  localEditedAt?: number | null;
  remoteVerifiedAt?: number | null;
}

export interface ReconcileResult<T> {
  /** The record that should be persisted. */
  value: T | null;
  /** True when the remote refresh was applied. */
  applied: boolean;
  /** True when local edits were preserved over the remote record. */
  preservedLocal: boolean;
}

export function reconcileRefresh<T>(input: ReconcileInput<T>): ReconcileResult<T> {
  const { local, remote, localEditedAt, remoteVerifiedAt } = input;

  if (remote == null) {
    return { value: local, applied: false, preservedLocal: local != null };
  }

  if (local == null) {
    return { value: remote, applied: true, preservedLocal: false };
  }

  const localTime =
    typeof localEditedAt === 'number' && Number.isFinite(localEditedAt)
      ? localEditedAt
      : null;
  const remoteTime =
    typeof remoteVerifiedAt === 'number' && Number.isFinite(remoteVerifiedAt)
      ? remoteVerifiedAt
      : null;

  // Local edits are newer than the remote verification: keep local edits.
  if (localTime != null && (remoteTime == null || localTime > remoteTime)) {
    return { value: local, applied: false, preservedLocal: true };
  }

  return { value: remote, applied: true, preservedLocal: false };
}

/**
 * Reconcile a revocation signal from the server. A revoked profile must be
 * cleared locally regardless of local edits, since it is no longer valid.
 */
export function reconcileRevocation<T>(
  local: T | null,
  revoked: boolean,
): ReconcileResult<T> {
  if (revoked) {
    return { value: null, applied: true, preservedLocal: false };
  }
  return { value: local, applied: false, preservedLocal: local != null };
}

/** Format a duration in ms as a short human-readable string. */
export function formatAge(ms: number): string {
  const abs = Math.abs(ms);
  const minutes = Math.floor(abs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
