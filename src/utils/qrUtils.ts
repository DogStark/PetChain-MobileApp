import type { Pet } from '../models/Pet';
import { getItem, setItem, removeItem } from '../services/localDB';

// ─── Constants ────────────────────────────────────────────────────────────────

const QR_CACHE_PREFIX = '@qr_cache_';
const QR_CACHE_INDEX_KEY = '@qr_cache_index';

/** How long a cached QR payload is considered fresh (24 hours). */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CachedQR {
  petId: string;
  payload: string; // base64-encoded QR string
  cachedAt: number;
  /** Set when the owning QR token is revoked; stale data must not be shown. */
  revoked?: boolean;
  revokedAt?: number;
  /** Mirror of the embedded payload `expiresAt` (Unix ms) when known. */
  expiresAt?: number;
}

// ─── Format helpers ───────────────────────────────────────────────────────────

/**
 * Returns a human-readable label for a QR format version.
 */
export const formatVersionLabel = (version: number): string => {
  switch (version) {
    case 1:
      return 'v1 (id-only)';
    case 2:
      return 'v2 (full-data)';
    default:
      return `v${version} (unknown)`;
  }
};

/**
 * Extracts the version number from a decoded QR payload object.
 * Returns 0 if the version field is absent (legacy / unknown).
 */
export const extractVersion = (payload: Record<string, unknown>): number => {
  const v = payload.version;
  return typeof v === 'number' ? v : 0;
};

/**
 * Builds the deep-link URI for a pet.
 */
export const buildPetDeepLink = (petId: string): string =>
  `petchain://pet/${encodeURIComponent(petId)}`;

/**
 * Safely base64-encodes a JSON-serialisable object.
 */
export const encodePayload = (obj: unknown): string =>
  Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');

/**
 * Safely decodes a base64 string back to a plain object.
 * Throws a descriptive error on failure.
 */
export const decodePayload = (raw: string): Record<string, unknown> => {
  let json: string;
  try {
    json = Buffer.from(raw.trim(), 'base64').toString('utf8');
  } catch {
    throw new Error('QR data is not valid base64');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('QR data does not contain valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('QR payload must be a JSON object');
  }
  return parsed as Record<string, unknown>;
};

// ─── Offline QR cache ─────────────────────────────────────────────────────────

/**
 * Persist a generated QR payload so it can be displayed offline.
 */
export const cacheQRPayload = async (petId: string, payload: string): Promise<void> => {
  const entry: CachedQR = {
    petId,
    payload,
    cachedAt: Date.now(),
    expiresAt: readPayloadExpiry(payload),
  };
  await setItem(`${QR_CACHE_PREFIX}${petId}`, JSON.stringify(entry));

  // Keep an index of cached pet IDs
  const index = await getCacheIndex();
  if (!index.includes(petId)) {
    index.push(petId);
    await setItem(QR_CACHE_INDEX_KEY, JSON.stringify(index));
  }
};

/**
 * Retrieve a cached QR payload for a pet.
 * Returns null if not cached or if the cache has expired.
 */
export const getCachedQRPayload = async (petId: string): Promise<string | null> => {
  const raw = await getItem(`${QR_CACHE_PREFIX}${petId}`);
  if (!raw) return null;

  const entry: CachedQR = JSON.parse(raw);
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    await clearCachedQR(petId);
    return null;
  }
  return entry.payload;
};

/**
 * Remove a single pet's cached QR.
 */
export const clearCachedQR = async (petId: string): Promise<void> => {
  await removeItem(`${QR_CACHE_PREFIX}${petId}`);
  const index = await getCacheIndex();
  await setItem(QR_CACHE_INDEX_KEY, JSON.stringify(index.filter((id) => id !== petId)));
};

/**
 * Remove all cached QR payloads.
 */
export const clearAllCachedQRs = async (): Promise<void> => {
  const index = await getCacheIndex();
  await Promise.all(index.map((id) => removeItem(`${QR_CACHE_PREFIX}${id}`)));
  await removeItem(QR_CACHE_INDEX_KEY);
};

/**
 * Extract a minimal Pet-like object from a v2 QR payload for offline display.
 * Returns null if the payload does not contain pet data.
 */
export const extractPetFromPayload = (payload: Record<string, unknown>): Partial<Pet> | null => {
  const pet = payload.pet;
  if (typeof pet !== 'object' || pet === null) return null;
  return pet as Partial<Pet>;
};

// ─── Revocation / verification metadata ──────────────────────────────────────

/**
 * Mark the cached QR for a pet as revoked, but only when the cached payload
 * actually embeds the given token. This prevents a rotated/regenerated QR
 * (which issues a new token under the same pet) from being incorrectly revoked
 * because an older token was revoked.
 *
 * @returns true if the cache entry was updated, false otherwise.
 */
export const markQRRevoked = async (petId: string, token: string): Promise<boolean> => {
  const entry = await readCachedEntry(petId);
  if (!entry) return false;
  if (readPayloadToken(entry.payload) !== token) return false;
  const now = Date.now();
  await writeCachedEntry({ ...entry, revoked: true, revokedAt: now });
  return true;
};

// ─── Private helpers ──────────────────────────────────────────────────────────

const getCacheIndex = async (): Promise<string[]> => {
  const raw = await getItem(QR_CACHE_INDEX_KEY);
  return raw ? JSON.parse(raw) : [];
};

const readCachedEntry = async (petId: string): Promise<CachedQR | null> => {
  const raw = await getItem(`${QR_CACHE_PREFIX}${petId}`);
  return raw ? (JSON.parse(raw) as CachedQR) : null;
};

const writeCachedEntry = async (entry: CachedQR): Promise<void> => {
  await setItem(`${QR_CACHE_PREFIX}${entry.petId}`, JSON.stringify(entry));
};

const readPayloadExpiry = (payload: string): number | undefined => {
  try {
    const obj = decodePayload(payload);
    return typeof obj.expiresAt === 'number' ? obj.expiresAt : undefined;
  } catch {
    return undefined;
  }
};

const readPayloadToken = (payload: string): string | undefined => {
  try {
    const obj = decodePayload(payload);
    return typeof obj.token === 'string' ? obj.token : undefined;
  } catch {
    return undefined;
  }
};
