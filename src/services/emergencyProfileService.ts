import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Offline emergency-profile freshness policy (issue #1042).
 *
 * Cached emergency information can become outdated while still appearing
 * authoritative to a rescuer. This service stores the last verification time
 * for cached emergency profile data, exposes a freshness state so the UI can
 * display it prominently, marks expired data, and offers a minimal safe
 * fallback. Refreshes are atomic and never overwrite newer local edits.
 */

export type EmergencyProfile = {
  id: string;
  bloodType?: string;
  allergies?: string[];
  medications?: string[];
  conditions?: string[];
  emergencyContacts?: { name: string; phone: string }[];
  notes?: string;
  /** Local revision counter, bumped on every local edit. */
  localRevision: number;
  /** Epoch ms of the last successful verification against the server. */
  lastVerifiedAt: number | null;
  /** Epoch ms of the last local edit, used to protect newer local edits. */
  lastLocalEditAt: number | null;
};

export type FreshnessState = 'fresh' | 'stale' | 'expired' | 'unverified';

export type Freshness = {
  state: FreshnessState;
  /** Age of the data in ms, or null when never verified. */
  ageMs: number | null;
  /** Human-readable label for prominent display. */
  label: string;
  /** True when the data must not be treated as authoritative. */
  isExpired: boolean;
};

/** Data older than this is considered stale but still usable. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000; // 24h
/** Data older than this is expired and must be marked as such. */
export const EXPIRED_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 7d
/** Tolerated clock skew when comparing timestamps. */
export const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000; // 5m

const STORAGE_KEY = '@emergency_profile';

/**
 * Minimal safe fallback shown when cached data is expired or unavailable.
 * It intentionally contains no potentially-wrong medical claims.
 */
export const SAFE_FALLBACK: Pick<
  EmergencyProfile,
  'bloodType' | 'allergies' | 'medications' | 'conditions' | 'emergencyContacts' | 'notes'
> = {
  bloodType: undefined,
  allergies: undefined,
  medications: undefined,
  conditions: undefined,
  emergencyContacts: undefined,
  notes: 'Emergency information is out of date. Verify with the patient or a medical professional.',
};

function now(): number {
  return Date.now();
}

/**
 * Compute the freshness of a profile. Handles clock skew: a verification time
 * in the future (beyond tolerated skew) is treated as unverified rather than
 * fresh, so a skewed device clock cannot make stale data look authoritative.
 */
export function getFreshness(
  profile: EmergencyProfile | null,
  at: number = now(),
): Freshness {
  if (!profile || profile.lastVerifiedAt == null) {
    return {
      state: 'unverified',
      ageMs: null,
      label: 'Not verified',
      isExpired: true,
    };
  }

  const ageMs = at - profile.lastVerifiedAt;

  // Clock skew: verification timestamp is in the future beyond tolerance.
  if (ageMs < -CLOCK_SKEW_TOLERANCE_MS) {
    return {
      state: 'unverified',
      ageMs: null,
      label: 'Not verified',
      isExpired: true,
    };
  }

  const effectiveAge = Math.max(0, ageMs);

  if (effectiveAge >= EXPIRED_AFTER_MS) {
    return {
      state: 'expired',
      ageMs: effectiveAge,
      label: 'Expired — verify before use',
      isExpired: true,
    };
  }

  if (effectiveAge >= STALE_AFTER_MS) {
    return {
      state: 'stale',
      ageMs: effectiveAge,
      label: 'May be out of date',
      isExpired: false,
    };
  }

  return {
    state: 'fresh',
    ageMs: effectiveAge,
    label: 'Verified recently',
    isExpired: false,
  };
}

/**
 * Return the profile to display, substituting the minimal safe fallback when
 * the cached data is expired or unverified.
 */
export function getDisplayProfile(
  profile: EmergencyProfile | null,
  at: number = now(),
): { profile: EmergencyProfile | null; freshness: Freshness; usingFallback: boolean } {
  const freshness = getFreshness(profile, at);
  if (!profile || freshness.isExpired) {
    return {
      profile: profile
        ? { ...profile, ...SAFE_FALLBACK }
        : null,
      freshness,
      usingFallback: true,
    };
  }
  return { profile, freshness, usingFallback: false };
}

export async function loadProfile(): Promise<EmergencyProfile | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as EmergencyProfile;
  } catch {
    return null;
  }
}

async function persist(profile: EmergencyProfile): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

/**
 * Apply a local edit. Bumps the local revision and records the edit time so a
 * later refresh cannot clobber newer local changes.
 */
export async function applyLocalEdit(
  patch: Partial<EmergencyProfile>,
  at: number = now(),
): Promise<EmergencyProfile> {
  const current = await loadProfile();
  const base: EmergencyProfile = current ?? {
    id: patch.id ?? 'local',
    localRevision: 0,
    lastVerifiedAt: null,
    lastLocalEditAt: null,
  };
  const next: EmergencyProfile = {
    ...base,
    ...patch,
    localRevision: base.localRevision + 1,
    lastLocalEditAt: at,
  };
  await persist(next);
  return next;
}

/**
 * Atomically refresh the cached profile from a server payload.
 *
 * The refresh is rejected (returns the current local profile unchanged) when
 * the local copy has newer edits than the incoming payload, so a refresh can
 * never replace newer local emergency edits. The write is a single atomic
 * persist of the merged result.
 */
export async function refreshProfile(
  incoming: EmergencyProfile,
  at: number = now(),
): Promise<{ profile: EmergencyProfile; applied: boolean }> {
  const current = await loadProfile();

  if (current) {
    const localEditAt = current.lastLocalEditAt ?? 0;
    const incomingEditAt = incoming.lastLocalEditAt ?? 0;
    const localIsNewer =
      current.localRevision > incoming.localRevision ||
      localEditAt > incomingEditAt + CLOCK_SKEW_TOLERANCE_MS;

    if (localIsNewer) {
      // Preserve newer local edits; do not overwrite.
      return { profile: current, applied: false };
    }
  }

  const merged: EmergencyProfile = {
    ...incoming,
    localRevision: current ? current.localRevision : incoming.localRevision,
    lastLocalEditAt: current ? current.lastLocalEditAt : incoming.lastLocalEditAt,
    lastVerifiedAt: at,
  };

  await persist(merged);
  return { profile: merged, applied: true };
}

/**
 * Reconcile a revocation from the server. When the server reports the profile
 * as revoked, the cached medical data is cleared and marked unverified so it
 * is no longer shown as authoritative.
 */
export async function reconcileRevocation(
  revoked: boolean,
  at: number = now(),
): Promise<EmergencyProfile | null> {
  const current = await loadProfile();
  if (!revoked) return current;

  if (!current) return null;

  const cleared: EmergencyProfile = {
    ...current,
    ...SAFE_FALLBACK,
    lastVerifiedAt: null,
    lastLocalEditAt: at,
  };
  await persist(cleared);
  return cleared;
}
