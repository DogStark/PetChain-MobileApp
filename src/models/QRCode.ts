/**
 * QR code model for pet identity tags.
 *
 * Two distinct concepts live here, and the difference matters:
 *
 * - {@link QRCode} — the *record* the app stores and renders for a pet tag.
 *   Timestamps are ISO 8601 strings, consistent with the other models in this
 *   directory (`Pet.ts`, `Appointment.ts`).
 * - {@link QRPayload} — the *encoded data* physically embedded in the QR
 *   image. Timestamps here are Unix milliseconds because that is the format
 *   already emitted by `services/qrCodeService.ts`; QR tags that have been
 *   printed and attached to collars carry that format, so changing it would
 *   invalidate every tag already in the field.
 *
 * Use `QRCode` for anything the app owns, and `QRPayload` only at the
 * encode/decode boundary.
 */

import type { Pet } from './Pet';

/** Current payload format emitted by the app. */
export const QR_FORMAT_VERSION = 2;

/** Expiry presets offered when generating a tag. */
export type QRExpiry = '1h' | '24h' | '7d' | 'never';

/** Core pet fields snapshotted into a tag so scans work offline. */
export type PetQRSnapshot = Pick<Pet, 'id' | 'name' | 'species' | 'breed' | 'microchipId'>;

// ---------------------------------------------------------------------------
// Encoded payload (wire format — Unix ms timestamps)
// ---------------------------------------------------------------------------

/** v1 payload — legacy, parse only. Retained for tags already in circulation. */
export interface QRPayloadV1 {
  version: 1;
  petId: string;
  deepLink: string;
  /** Unix ms timestamp the tag was generated. */
  generatedAt: number;
  checksum: string;
}

/** v2 payload — current format, offline-capable. */
export interface QRPayloadV2 {
  version: 2;
  petId: string;
  deepLink: string;
  /** Unix ms timestamp the tag was generated. */
  generatedAt: number;
  checksum: string;
  /** Snapshot of core pet fields for offline display. */
  pet: PetQRSnapshot;
  /** Unix ms timestamp after which the tag is invalid. Absent = never expires. */
  expiresAt?: number;
  /** When true, the tag is invalidated after its first successful scan. */
  oneTimeUse?: boolean;
  /** Unique token for server-side revocation and usage tracking. */
  token?: string;
}

/**
 * The data shape encoded into, and recovered from, a scanned QR code.
 * Discriminated on `version` so parsers can narrow safely.
 */
export type QRPayload = QRPayloadV1 | QRPayloadV2;

/** Narrows a payload to the current version. */
export const isCurrentQRPayload = (payload: QRPayload): payload is QRPayloadV2 =>
  payload.version === QR_FORMAT_VERSION;

// ---------------------------------------------------------------------------
// Stored record (app domain — ISO timestamps)
// ---------------------------------------------------------------------------

/** A pet identity QR code as tracked by the app. */
export interface QRCode {
  id: string;
  petId: string;
  /** The decoded payload embedded in this tag. */
  payload: QRPayload;
  /** ISO timestamp the tag was created. */
  createdAt: string;
  /** ISO timestamp the tag expires. Absent means it never expires. */
  expiresAt?: string;
  /** False once revoked, expired or consumed by a one-time scan. */
  isActive: boolean;
  /** Expiry preset chosen at generation time. */
  expiry?: QRExpiry;
  /** Server-side revocation token, mirrors `QRPayloadV2.token`. */
  token?: string;
  oneTimeUse?: boolean;
  /** Number of successful scans recorded against this tag. */
  scanCount?: number;
  /** ISO timestamp of the most recent successful scan. */
  lastScannedAt?: string;
  /** ISO timestamp the tag was explicitly revoked. */
  revokedAt?: string;
}

// ---------------------------------------------------------------------------
// Scan results
// ---------------------------------------------------------------------------

/** Why a scan failed. */
export enum QRScanErrorCode {
  /** Not a PetChain QR code, or not parseable at all. */
  MALFORMED = 'MALFORMED',
  /** Payload version is newer than this app build understands. */
  UNSUPPORTED_VERSION = 'UNSUPPORTED_VERSION',
  /** Checksum did not match — payload was tampered with or corrupted. */
  INVALID_CHECKSUM = 'INVALID_CHECKSUM',
  /** Tag is past its `expiresAt`. */
  EXPIRED = 'EXPIRED',
  /** Tag was revoked by the owner. */
  REVOKED = 'REVOKED',
  /** One-time tag that has already been scanned. */
  ALREADY_USED = 'ALREADY_USED',
  /** Tag could not be verified because the device is offline. */
  NETWORK_ERROR = 'NETWORK_ERROR',
}

export interface QRScanSuccess {
  valid: true;
  petId: string;
  payload: QRPayload;
  /** Payload format version that was decoded. */
  version: number;
  /** Pet snapshot embedded in the tag, when the format carries one (v2+). */
  pet?: PetQRSnapshot;
  /** In-app route to open for this pet. */
  deepLink: string;
}

export interface QRScanFailure {
  valid: false;
  code: QRScanErrorCode;
  /** Human-readable reason, safe to surface to the user. */
  message: string;
  /** Populated when the pet could be identified despite the scan failing. */
  petId?: string;
  /** Payload version, when it was parseable. */
  version?: number;
}

/**
 * Result of scanning a QR code — discriminated on `valid`, so a successful
 * scan is guaranteed to carry a `petId` and a failure is guaranteed to carry
 * an error code:
 *
 * ```ts
 * const result = scan(raw);
 * if (result.valid) {
 *   navigate(result.deepLink); // petId / payload available
 * } else {
 *   showError(result.message); // code available
 * }
 * ```
 */
export type QRScanResult = QRScanSuccess | QRScanFailure;

/** Builds a failed scan result. */
export const qrScanFailure = (
  code: QRScanErrorCode,
  message: string,
  extra: Pick<QRScanFailure, 'petId' | 'version'> = {},
): QRScanFailure => ({ valid: false, code, message, ...extra });

/**
 * Shape of the flat scan result currently returned by
 * `services/qrCodeService.ts`. Declared structurally rather than imported so
 * that this model stays free of service dependencies.
 */
export interface LegacyQRScanResult {
  valid: boolean;
  petId?: string;
  petData?: Partial<Pet>;
  version?: number;
  error?: string;
}

/**
 * Adapts the legacy flat scan result to the discriminated {@link QRScanResult},
 * so call sites can migrate incrementally without `qrCodeService` changing
 * first. Returns a failure when the legacy result lacks the fields a success
 * requires.
 */
export const fromLegacyScanResult = (
  legacy: LegacyQRScanResult,
  payload?: QRPayload,
): QRScanResult => {
  if (!legacy.valid || !legacy.petId || !payload) {
    return qrScanFailure(
      legacy.valid ? QRScanErrorCode.MALFORMED : QRScanErrorCode.INVALID_CHECKSUM,
      legacy.error || 'This QR code could not be verified.',
      { petId: legacy.petId, version: legacy.version },
    );
  }

  return {
    valid: true,
    petId: legacy.petId,
    payload,
    version: legacy.version ?? payload.version,
    pet: isCurrentQRPayload(payload) ? payload.pet : undefined,
    deepLink: payload.deepLink,
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True when a tag has passed its expiry. `now` is injectable for tests. */
export const isQRCodeExpired = (qrCode: QRCode, now: Date = new Date()): boolean =>
  Boolean(qrCode.expiresAt) && new Date(qrCode.expiresAt).getTime() <= now.getTime();

/** True when a tag is active and has not expired. */
export const isQRCodeUsable = (qrCode: QRCode, now: Date = new Date()): boolean =>
  qrCode.isActive && !isQRCodeExpired(qrCode, now);

/**
 * Factory that builds a QRCode from partial data, applying sensible defaults —
 * mirrors the `createPet` pattern in `Pet.ts`.
 */
export const createQRCode = (data: Partial<QRCode>): QRCode => ({
  id: data.id || '',
  petId: data.petId || '',
  payload: data.payload,
  createdAt: data.createdAt || new Date().toISOString(),
  expiresAt: data.expiresAt,
  isActive: data.isActive ?? true,
  expiry: data.expiry,
  token: data.token,
  oneTimeUse: data.oneTimeUse ?? false,
  scanCount: data.scanCount ?? 0,
  lastScannedAt: data.lastScannedAt,
  revokedAt: data.revokedAt,
});
