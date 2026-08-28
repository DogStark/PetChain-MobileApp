import CryptoJS from 'crypto-js';
import { Share } from 'react-native';

import apiClient from './apiClient';
import { getItem, removeItem, setItem } from './localDB';
import type { Pet } from '../models/Pet';
import {
  buildPetDeepLink,
  cacheQRPayload,
  decodePayload,
  encodePayload,
  extractPetFromPayload,
  extractVersion,
  getCachedQRPayload,
  markQRRevoked,
} from '../utils/qrUtils';

// ─── QR format versions ───────────────────────────────────────────────────────

/**
 * v1 — legacy: id + deepLink + checksum only (read-only support)
 * v2 — current: full pet snapshot embedded, versioned, offline-capable
 */
export const QR_FORMAT_VERSION = 2;

// ─── Expiry presets ───────────────────────────────────────────────────────────

export type QRExpiry = '1h' | '24h' | '7d' | 'never';

const EXPIRY_MS: Record<QRExpiry, number | null> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  never: null,
};

const QR_TOKEN_PREFIX = '@qr_token_';

const QR_PREFIX = 'PETCHAIN_QR';
const PET_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const QR_IMAGE_BASE_URL = 'https://api.qrserver.com/v1/create-qr-code/';

// ─── Types ────────────────────────────────────────────────────────────────────

/** v1 payload shape (legacy — parse only). */
export interface PetQRDataV1 {
  version: 1;
  petId: string;
  deepLink: string;
  generatedAt: number;
  checksum: string;
}

/** v2 payload shape — current format. */
export interface PetQRDataV2 {
  version: 2;
  petId: string;
  deepLink: string;
  generatedAt: number;
  checksum: string;
  /** Snapshot of core pet fields for offline display. */
  pet: Pick<Pet, 'id' | 'name' | 'species' | 'breed' | 'microchipId'>;
  /** Unix ms timestamp after which this QR is invalid. Absent = never expires. */
  expiresAt?: number;
  /** If true, invalidated after first successful scan. */
  oneTimeUse?: boolean;
  /** Unique token for server-side revocation / usage tracking. */
  token?: string;
}

export type PetQRData = PetQRDataV1 | PetQRDataV2;

export interface QRCodeOptions {
  expiry?: QRExpiry;
  oneTimeUse?: boolean;
}

/** Persisted token state stored in localDB. */
interface QRTokenState {
  token: string;
  petId: string;
  usageCount: number;
  revokedAt?: number;
}

export interface QRScanResult {
  valid: boolean;
  petId?: string;
  /** Present when the QR embeds pet data (v2+). */
  petData?: Partial<Pet>;
  version?: number;
  error?: string;
}

export type PetQRInput = Pick<Pet, 'id' | 'name' | 'species' | 'breed' | 'microchipId'>;

// ─── Checksum ─────────────────────────────────────────────────────────────────

const computeChecksum = (petId: string, deepLink: string, generatedAt: number): string =>
  CryptoJS.SHA256(`${QR_PREFIX}|${petId}|${deepLink}|${generatedAt}`).toString();

// ─── Generation ───────────────────────────────────────────────────────────────

// ─── Token helpers ────────────────────────────────────────────────────────────

const getTokenState = async (token: string): Promise<QRTokenState | null> => {
  const raw = await getItem(`${QR_TOKEN_PREFIX}${token}`);
  return raw ? (JSON.parse(raw) as QRTokenState) : null;
};

const saveTokenState = async (state: QRTokenState): Promise<void> => {
  await setItem(`${QR_TOKEN_PREFIX}${state.token}`, JSON.stringify(state));
};

/**
 * Revoke an active QR token so it is rejected on the next scan.
 *
 * Revocation also invalidates the matching offline cache entry (when it embeds
 * this token) so a revoked tag's cached data is never presented as valid
 * emergency data later.
 */
export const revokeQRCode = async (token: string): Promise<void> => {
  const state = await getTokenState(token);
  if (!state) return;
  await saveTokenState({ ...state, revokedAt: Date.now() });
  await markQRRevoked(state.petId, token);
};

/**
 * Remove all persisted token state for a QR token.
 */
export const deleteQRToken = async (token: string): Promise<void> => {
  await removeItem(`${QR_TOKEN_PREFIX}${token}`);
};

/**
 * Generate a v2 QR payload string for a pet.
 * The payload is base64-encoded JSON containing a pet snapshot and checksum.
 * The result is also persisted to the offline cache automatically.
 *
 * @param pet - Full pet object (only core fields are embedded in the QR).
 * @param options - Optional expiry and one-time-use settings.
 * @returns Base64-encoded QR payload string.
 */
export const generatePetQRCode = async (pet: Pet, options: QRCodeOptions = {}): Promise<string> => {
  if (!pet.id || pet.id.trim().length === 0) {
    throw new Error('QR generation failed: pet.id must not be empty');
  }
  if (!PET_ID_REGEX.test(pet.id)) {
    throw new Error(
      'QR generation failed: pet.id contains invalid characters (allowed: letters, digits, hyphens, underscores, max 64 chars)',
    );
  }

  const generatedAt = Date.now();
  const deepLink = buildPetDeepLink(pet.id);
  const checksum = computeChecksum(pet.id, deepLink, generatedAt);
  const token = CryptoJS.lib.WordArray.random(16).toString();

  const expiryMs = options.expiry ? EXPIRY_MS[options.expiry] : null;
  const expiresAt = expiryMs ? generatedAt + expiryMs : undefined;

  const payload: PetQRDataV2 = {
    version: QR_FORMAT_VERSION,
    petId: pet.id,
    deepLink,
    generatedAt,
    checksum,
    pet: {
      id: pet.id,
      name: pet.name,
      species: pet.species,
      breed: pet.breed,
      microchipId: pet.microchipId,
    },
    ...(expiresAt !== undefined && { expiresAt }),
    ...(options.oneTimeUse && { oneTimeUse: true }),
    token,
  };

  await saveTokenState({ token, petId: pet.id, usageCount: 0 });

  const encoded = encodePayload(payload);

  // Persist for offline display
  await cacheQRPayload(pet.id, encoded);

  return encoded;
};

export const generateQR = async (
  petData: PetQRInput,
  options: QRCodeOptions = {},
): Promise<string> => {
  return generatePetQRCode(
    {
      ...petData,
      ownerId: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    options,
  );
};

export const getQRImageUrl = (qrData: string, size = 240): string => {
  const clampedSize = Math.max(120, Math.min(size, 512));
  return `${QR_IMAGE_BASE_URL}?size=${clampedSize}x${clampedSize}&data=${encodeURIComponent(qrData)}`;
};

export const sharePetQRCode = async (
  petData: PetQRInput,
  options: QRCodeOptions = {},
): Promise<string> => {
  const payload = await generateQR(petData, options);
  const imageUrl = getQRImageUrl(payload);
  await Share.share({
    title: `${petData.name}'s PetChain QR`,
    message: `PetChain QR for ${petData.name}:\n${imageUrl}`,
    url: imageUrl,
  });
  return payload;
};

export const printPetQRCode = async (
  petData: PetQRInput,
  options: QRCodeOptions = {},
): Promise<string> => {
  const payload = await generateQR(petData, options);
  const imageUrl = getQRImageUrl(payload);
  await Share.share({
    title: `Print ${petData.name}'s PetChain QR`,
    message: `Print or save this PetChain QR for ${petData.name}:\n${imageUrl}`,
    url: imageUrl,
  });
  return payload;
};

/**
 * Return a cached QR payload for offline display.
 * Returns null if no valid cache entry exists.
 */
export const getOfflineQRCode = async (petId: string): Promise<string | null> => {
  return getCachedQRPayload(petId);
};

/** How confident we are in a cached (offline) QR before showing it as valid. */
export type QRVerificationStatus =
  | 'verified'
  | 'revoked'
  | 'expired'
  | 'unverifiable'
  | 'not_found';

/** Offline QR payload plus its revocation/expiry verification result. */
export interface OfflineQRCodeInfo {
  petId: string;
  /** The cached QR payload, or null when nothing usable is stored. */
  payload: string | null;
  status: QRVerificationStatus;
  /** Human-readable reason for a non-verified result. */
  reason?: string;
}

/**
 * Inspect a pet's cached QR payload and report whether it is still safe to
 * present offline. A revoked, expired, or unverifiable tag must not be shown
 * as valid emergency data.
 *
 * "verified" here means the payload passed the offline expiry checks and its
 * revocation token state is known and not revoked — it does not imply a fresh
 * network confirmation.
 */
export const getOfflineQRCodeInfo = async (petId: string): Promise<OfflineQRCodeInfo> => {
  const cached = await getCachedQRPayload(petId);
  if (!cached) {
    return { petId, payload: null, status: 'not_found', reason: 'No offline QR code available' };
  }

  let data: PetQRData;
  try {
    data = parseQRCodeData(cached);
  } catch {
    return {
      petId,
      payload: cached,
      status: 'unverifiable',
      reason: 'Offline QR code could not be decoded',
    };
  }

  if (data.version === 2) {
    const v2 = data as PetQRDataV2;

    if (v2.expiresAt !== undefined && Date.now() > v2.expiresAt) {
      return { petId, payload: cached, status: 'expired', reason: 'This code has expired' };
    }

    if (v2.token) {
      const state = await getTokenState(v2.token);

      if (state?.revokedAt !== undefined) {
        return { petId, payload: cached, status: 'revoked', reason: 'This code has been revoked' };
      }

      if (!state) {
        return {
          petId,
          payload: cached,
          status: 'unverifiable',
          reason: 'Revocation cannot be verified while offline',
        };
      }

      return { petId, payload: cached, status: 'verified' };
    }
  }

  return {
    petId,
    payload: cached,
    status: 'unverifiable',
    reason: 'Offline QR code has no revocation metadata',
  };
};

// ─── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Decode a raw QR string into a typed payload object.
 * Supports both v1 (legacy) and v2 payloads.
 * Throws a descriptive error on any parse failure.
 */
export const parseQRCodeData = (qrData: string): PetQRData => {
  if (!qrData || qrData.trim().length === 0) {
    throw new Error('QR parsing failed: QR data is empty');
  }

  const obj = decodePayload(qrData);

  const version = extractVersion(obj);

  // Required fields common to all versions
  const requiredFields = ['petId', 'deepLink', 'generatedAt', 'checksum'] as const;
  for (const field of requiredFields) {
    if (!(field in obj)) {
      throw new Error(`QR parsing failed: missing required field "${field}"`);
    }
  }

  if (version === 2) {
    if (typeof obj.pet !== 'object' || obj.pet === null) {
      throw new Error('QR parsing failed: v2 payload is missing "pet" object');
    }
    return obj as unknown as PetQRDataV2;
  }

  // Treat version 0 (no version field) as v1 legacy
  return obj as unknown as PetQRDataV1;
};

// ─── Scanning ─────────────────────────────────────────────────────────────────

/**
 * Validate and parse a scanned QR string.
 * Works fully offline — no network call required.
 *
 * Returns a QRScanResult with:
 *  - valid: whether the QR is a genuine PetChain code
 *  - petId: the pet's ID
 *  - petData: embedded pet snapshot (v2 only)
 *  - version: format version number
 *  - error: human-readable reason if invalid
 */
export const scanQRCode = async (qrData: string): Promise<QRScanResult> => {
  if (!qrData || qrData.trim().length === 0) {
    return { valid: false, error: 'QR data is empty' };
  }

  let data: PetQRData;
  try {
    data = parseQRCodeData(qrData);
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : 'Failed to parse QR data',
    };
  }

  // Validate petId format
  if (!PET_ID_REGEX.test(data.petId)) {
    return { valid: false, error: 'QR code contains an invalid pet ID format' };
  }

  // Validate deep link
  const expectedDeepLink = buildPetDeepLink(data.petId);
  if (data.deepLink !== expectedDeepLink) {
    return { valid: false, error: 'QR code contains an invalid deep link' };
  }

  // Validate checksum (tamper detection)
  const expectedChecksum = computeChecksum(data.petId, data.deepLink, data.generatedAt);
  if (data.checksum !== expectedChecksum) {
    return { valid: false, error: 'QR code checksum mismatch — data may have been tampered with' };
  }

  // v2-specific: expiry, one-time-use, revocation checks
  if (data.version === 2) {
    const v2 = data as PetQRDataV2;

    if (v2.expiresAt !== undefined && Date.now() > v2.expiresAt) {
      return { valid: false, error: 'This code has expired' };
    }

    if (v2.token) {
      const state = await getTokenState(v2.token);

      if (state?.revokedAt !== undefined) {
        return { valid: false, error: 'This code has been revoked' };
      }

      if (v2.oneTimeUse && state && state.usageCount >= 1) {
        return { valid: false, error: 'This code has already been used' };
      }

      // Record usage
      if (state) {
        await saveTokenState({ ...state, usageCount: state.usageCount + 1 });
      }
    }
  }

  const result: QRScanResult = {
    valid: true,
    petId: data.petId,
    version: data.version ?? 1,
  };

  // Extract embedded pet data for v2+
  if (data.version === 2) {
    const petData = extractPetFromPayload(data as unknown as Record<string, unknown>);
    if (petData) result.petData = petData;
  }

  return result;
};

// ─── Legacy alias (v1 compat) ─────────────────────────────────────────────────

/**
 * @deprecated Use `scanQRCode` instead.
 * Kept for backward compatibility with code that calls validateQRCode.
 */
export const validateQRCode = (
  qrData: string,
): Promise<{ valid: boolean; petId?: string; error?: string }> => scanQRCode(qrData);

// ─── Canonical named API (issue #794) ─────────────────────────────────────────

/**
 * Generate a QR payload string for a pet.
 *
 * Thin, explicitly-named wrapper over {@link generatePetQRCode} so callers can
 * use the canonical `generateQRCode` name. Honours expiry / one-time-use
 * options and persists the payload to the offline cache.
 */
export const generateQRCode = (pet: Pet, options: QRCodeOptions = {}): Promise<string> =>
  generatePetQRCode(pet, options);

/**
 * Decode a raw QR string into its typed payload without running the full
 * validation pipeline. Throws a descriptive error on malformed input.
 *
 * Use {@link scanQRCode} / {@link validateQRCode} when you also need checksum,
 * expiry, revocation, and one-time-use enforcement.
 */
export const decodeQRPayload = (qrData: string): PetQRData => parseQRCodeData(qrData);

// ─── Backend integration ──────────────────────────────────────────────────────

/** Server-issued QR record for a pet. */
export interface RemoteQRData {
  /** Encoded QR payload string, ready to render. */
  qrData: string;
  /** Unix ms timestamp after which the code is invalid. */
  expiresAt?: number;
  /** Server-side revocation / usage token. */
  token?: string;
}

/**
 * Fetch a server-issued QR code for a pet from the backend. Falls back to the
 * offline cache when the request fails so scanning still works offline.
 *
 * @returns the encoded QR payload string, or `null` if none is available.
 */
export const fetchPetQRCode = async (petId: string): Promise<string | null> => {
  if (!PET_ID_REGEX.test(petId)) {
    throw new Error('fetchPetQRCode failed: invalid pet ID format');
  }

  try {
    const response = await apiClient.get<{ data: RemoteQRData }>(
      `/pets/${encodeURIComponent(petId)}/qr`,
    );
    const remote = response.data?.data;
    if (remote?.qrData) {
      await cacheQRPayload(petId, remote.qrData);
      return remote.qrData;
    }
  } catch {
    // Network / server error — fall back to any cached payload below.
  }

  // Offline fallback: only serve a payload that passed local revocation/expiry
  // checks, so a revoked or expired tag is never presented as valid emergency
  // data when the network is unavailable.
  const offline = await getOfflineQRCodeInfo(petId);
  return offline.status === 'verified' ? offline.payload : null;
};

/**
 * Register a locally-generated QR token with the backend so it can be revoked
 * or usage-tracked server-side. Best-effort — never throws.
 */
export const syncQRToken = async (petId: string, token: string): Promise<void> => {
  try {
    await apiClient.post(`/pets/${encodeURIComponent(petId)}/qr/tokens`, { token });
  } catch {
    // best-effort — server sync is optional; local token state remains valid.
  }
};
