/**
 * Privacy-safe diagnostic export for support (issue #1035)
 *
 * Support needs actionable logs, but raw diagnostic bundles can contain
 * tokens, pet identifiers, URLs, or medical content. Before a bundle leaves
 * the device we:
 *   1. require explicit user confirmation,
 *   2. require a fresh step-up authentication (biometric / passcode),
 *   3. structurally redact secrets, IDs, health fields, and locations,
 *   4. stamp an expiry and delete the temp file after share or cancel.
 */

import * as FileSystem from 'expo-file-system';

export type AuthMethod = 'biometric' | 'passcode' | 'password';

export interface ExplicitConfirmation {
  /** Must be true — the user tapped Confirm on the disclosure dialog. */
  confirmed: true;
  confirmedAt: number;
}

export interface RecentAuthentication {
  method: AuthMethod;
  /** When the step-up succeeded (epoch ms). */
  authenticatedAt: number;
}

/** Confirmation / auth are only accepted if they happened within this window. */
export const RECENT_AUTH_MAX_AGE_MS = 2 * 60 * 1000;

/** Default lifetime of a diagnostic bundle on disk. */
export const DEFAULT_BUNDLE_TTL_MS = 15 * 60 * 1000;

export const REDACTED = '[redacted]';

export class ConfirmationRequiredError extends Error {
  readonly code = 'CONFIRMATION_REQUIRED';
  constructor(message = 'Explicit user confirmation is required before exporting diagnostics') {
    super(message);
    this.name = 'ConfirmationRequiredError';
  }
}

export class RecentAuthRequiredError extends Error {
  readonly code = 'RECENT_AUTH_REQUIRED';
  constructor(message = 'A fresh authentication is required before exporting diagnostics') {
    super(message);
    this.name = 'RecentAuthRequiredError';
  }
}

export class BundleExpiredError extends Error {
  readonly code = 'BUNDLE_EXPIRED';
  constructor(message = 'This diagnostic bundle has expired') {
    super(message);
    this.name = 'BundleExpiredError';
  }
}

/** Structural sensitive-key patterns for diagnostic payloads. */
const SENSITIVE_KEY_PATTERNS = [
  // Secrets / auth
  'token',
  'secret',
  'password',
  'apikey',
  'api_key',
  'authorization',
  'bearer',
  'session',
  'cookie',
  'credential',
  'privatekey',
  'mnemonic',
  'seed',
  // Identifiers
  'petid',
  'pet_id',
  'userid',
  'user_id',
  'ownerid',
  'owner_id',
  'patientid',
  'email',
  'phone',
  'ssn',
  // Health / medical
  'health',
  'medical',
  'diagnosis',
  'treatment',
  'prescription',
  'medication',
  'vitals',
  'blood',
  'symptom',
  'condition',
  // Location
  'latitude',
  'longitude',
  'coordinates',
  'geolocation',
  'latlng',
  'address',
  'location',
  'gps',
  // Wallet
  'wallet',
  'publickey',
  'privatekey',
  'secretkey',
  'mnemonic',
];

/** Value patterns that look like secrets / URLs with credentials / pet IDs. */
const SECRET_VALUE_RE =
  /(?:Bearer\s+[A-Za-z0-9\-._~+/=]+|ghp_[A-Za-z0-9]{20,}|sk_live_[A-Za-z0-9]+|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/gi;
const URL_WITH_CREDS_RE = /https?:\/\/[^\s/:]+:[^\s/@]+@[^\s]+/gi;
const PET_ID_VALUE_RE = /\bpet[_-]?[0-9a-f]{8,}\b/gi;

export function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9_]/g, '');
  return SENSITIVE_KEY_PATTERNS.some(
    (pattern) => normalized.includes(pattern.replace(/[^a-z0-9_]/g, '')),
  );
}

function redactStringValue(value: string): string {
  let out = value.replace(SECRET_VALUE_RE, REDACTED);
  out = out.replace(URL_WITH_CREDS_RE, REDACTED);
  out = out.replace(PET_ID_VALUE_RE, REDACTED);
  return out;
}

/**
 * Recursively redact sensitive fields and in-string secrets from a diagnostic
 * log object. Structure (keys / nesting) is preserved so support can still
 * reason about event shape.
 */
export function redactDiagnosticPayload(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data === 'string') return redactStringValue(data);
  if (typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map((item) => redactDiagnosticPayload(item));

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      result[key] = REDACTED;
    } else if (typeof value === 'string') {
      result[key] = redactStringValue(value);
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactDiagnosticPayload(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export type DiagnosticLogKind = 'crash' | 'sync' | 'wallet' | 'sos' | 'other';

export interface DiagnosticLogEntry {
  kind: DiagnosticLogKind;
  timestamp: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface DiagnosticBundleMeta {
  bundleId: string;
  createdAt: number;
  expiresAt: number;
  logCount: number;
  redacted: true;
}

export interface DiagnosticBundle {
  meta: DiagnosticBundleMeta;
  app: { version?: string; platform?: string; env?: string };
  logs: DiagnosticLogEntry[];
}

export interface CreateDiagnosticBundleInput {
  logs: DiagnosticLogEntry[];
  confirmation: ExplicitConfirmation;
  auth: RecentAuthentication;
  ttlMs?: number;
  now?: number;
  app?: DiagnosticBundle['app'];
  generateId?: () => string;
}

function assertExplicitConfirmation(
  confirmation: ExplicitConfirmation | undefined,
  now: number,
): asserts confirmation is ExplicitConfirmation {
  if (
    !confirmation ||
    confirmation.confirmed !== true ||
    typeof confirmation.confirmedAt !== 'number' ||
    now - confirmation.confirmedAt > RECENT_AUTH_MAX_AGE_MS ||
    confirmation.confirmedAt > now + 5_000
  ) {
    throw new ConfirmationRequiredError();
  }
}

function assertRecentAuth(
  auth: RecentAuthentication | undefined,
  now: number,
): asserts auth is RecentAuthentication {
  if (
    !auth ||
    typeof auth.authenticatedAt !== 'number' ||
    now - auth.authenticatedAt > RECENT_AUTH_MAX_AGE_MS ||
    auth.authenticatedAt > now + 5_000
  ) {
    throw new RecentAuthRequiredError();
  }
}

function randomId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID().replace(/-/g, '');
  return Array.from({ length: 4 }, () => Math.random().toString(16).slice(2, 10)).join('');
}

/**
 * Build a redacted, expiring diagnostic bundle. Throws unless both explicit
 * confirmation and recent authentication are present and fresh.
 */
export function createDiagnosticBundle(input: CreateDiagnosticBundleInput): DiagnosticBundle {
  const now = input.now ?? Date.now();
  assertExplicitConfirmation(input.confirmation, now);
  assertRecentAuth(input.auth, now);

  const ttl = input.ttlMs ?? DEFAULT_BUNDLE_TTL_MS;
  const bundleId = (input.generateId ?? randomId)();

  const logs: DiagnosticLogEntry[] = input.logs.map((entry) => ({
    kind: entry.kind,
    timestamp: entry.timestamp,
    message: redactStringValue(entry.message),
    data: entry.data
      ? (redactDiagnosticPayload(entry.data) as Record<string, unknown>)
      : undefined,
  }));

  return {
    meta: {
      bundleId,
      createdAt: now,
      expiresAt: now + ttl,
      logCount: logs.length,
      redacted: true,
    },
    app: input.app ?? {},
    logs,
  };
}

export function isBundleExpired(
  bundle: Pick<DiagnosticBundle, 'meta'> | DiagnosticBundleMeta,
  now: number = Date.now(),
): boolean {
  const expiresAt = 'expiresAt' in bundle ? bundle.expiresAt : bundle.meta.expiresAt;
  return now >= expiresAt;
}

export function assertBundleUsable(
  bundle: Pick<DiagnosticBundle, 'meta'>,
  now: number = Date.now(),
): void {
  if (isBundleExpired(bundle, now)) throw new BundleExpiredError();
}

export function bundleFileName(bundleId: string): string {
  return `petchain-diagnostics-${bundleId}.json`;
}

export function bundleUri(bundleId: string): string {
  const base = FileSystem.cacheDirectory ?? '';
  return `${base}${bundleFileName(bundleId)}`;
}

/** Persist a bundle to the private cache directory. */
export async function writeDiagnosticBundle(bundle: DiagnosticBundle): Promise<string> {
  assertBundleUsable(bundle);
  const uri = bundleUri(bundle.meta.bundleId);
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(bundle, null, 2), {
    encoding: FileSystem.EncodingType.UTF8,
  });
  return uri;
}

/**
 * Delete the on-disk bundle. Idempotent — missing files do not throw.
 * Call after sharing completes or the user cancels.
 */
export async function deleteDiagnosticBundle(bundleIdOrUri: string): Promise<void> {
  const uri =
    bundleIdOrUri.startsWith('file:') || bundleIdOrUri.includes('/')
      ? bundleIdOrUri
      : bundleUri(bundleIdOrUri);
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // Best-effort cleanup — never surface to the user after share/cancel.
  }
}

/**
 * High-level helper: create → write → run share/cancel callback → always delete.
 * The share callback receives the file URI; returning false treats as cancel.
 */
export async function exportDiagnosticsForSupport(options: {
  logs: DiagnosticLogEntry[];
  confirmation: ExplicitConfirmation;
  auth: RecentAuthentication;
  app?: DiagnosticBundle['app'];
  ttlMs?: number;
  now?: number;
  share: (uri: string, bundle: DiagnosticBundle) => Promise<boolean>;
}): Promise<{ shared: boolean; bundleId: string }> {
  const bundle = createDiagnosticBundle({
    logs: options.logs,
    confirmation: options.confirmation,
    auth: options.auth,
    app: options.app,
    ttlMs: options.ttlMs,
    now: options.now,
  });
  const uri = await writeDiagnosticBundle(bundle);
  try {
    const shared = await options.share(uri, bundle);
    return { shared, bundleId: bundle.meta.bundleId };
  } finally {
    await deleteDiagnosticBundle(uri);
  }
}
