/**
 * Guarded medical-document sharing (issue #965)
 *
 * The OS share sheet can hand a file to any app the user picks, beyond
 * PetChain's authorization boundary. Before a document leaves the vault we:
 *   1. require a fresh step-up confirmation (biometric / passcode),
 *   2. mint a short-lived, single-purpose export grant that expires,
 *   3. stamp a visible watermark and write an audit entry.
 *
 * Nothing here logs the document's contents, the patient's identity or the
 * raw grant token — only opaque ids, a hash and timestamps.
 */

export type StepUpMethod = 'biometric' | 'passcode' | 'password';

export interface StepUpConfirmation {
  method: StepUpMethod;
  /** When the step-up succeeded (epoch ms). */
  confirmedAt: number;
}

/** Step-up is only accepted if it happened within this window. */
export const STEP_UP_MAX_AGE_MS = 2 * 60 * 1000;

/** Default lifetime of an export grant. */
export const DEFAULT_EXPORT_TTL_MS = 10 * 60 * 1000;

export class StepUpRequiredError extends Error {
  readonly code = 'STEP_UP_REQUIRED';
  constructor(message = 'A fresh identity confirmation is required before sharing') {
    super(message);
    this.name = 'StepUpRequiredError';
  }
}

export class ExportExpiredError extends Error {
  readonly code = 'EXPORT_EXPIRED';
  constructor(message = 'This export link has expired') {
    super(message);
    this.name = 'ExportExpiredError';
  }
}

export interface ExportGrantInput {
  documentId: string;
  /** Opaque id of the user performing the share. */
  actorId: string;
  stepUp: StepUpConfirmation;
  ttlMs?: number;
  now?: number;
  /** Injectable token generator (tests). */
  generateToken?: () => string;
}

export interface ExportGrant {
  exportId: string;
  /** Opaque bearer token for the expiring export endpoint. */
  token: string;
  documentId: string;
  actorId: string;
  issuedAt: number;
  expiresAt: number;
  /** Text to overlay on rendered pages. Contains no PHI. */
  watermark: string;
}

export interface ShareAuditEntry {
  event: 'document.shared';
  exportId: string;
  documentId: string;
  actorId: string;
  stepUpMethod: StepUpMethod;
  issuedAt: number;
  expiresAt: number;
  /** Non-reversible fingerprint of the token, for correlation only. */
  tokenFingerprint: string;
}

function assertFreshStepUp(stepUp: StepUpConfirmation | undefined, now: number): asserts stepUp {
  if (
    !stepUp ||
    typeof stepUp.confirmedAt !== 'number' ||
    now - stepUp.confirmedAt > STEP_UP_MAX_AGE_MS ||
    stepUp.confirmedAt > now + 5_000
  ) {
    throw new StepUpRequiredError();
  }
}

/** djb2 — small non-cryptographic fingerprint, enough for log correlation. */
function fingerprint(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

function randomToken(): string {
  // Non-secret contexts fall back to Math.random; callers may inject a CSPRNG.
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID().replace(/-/g, '');
  return Array.from({ length: 4 }, () => Math.random().toString(16).slice(2, 10)).join('');
}

/**
 * Creates an expiring export grant for a document. Throws
 * {@link StepUpRequiredError} unless a recent step-up confirmation is supplied.
 */
export function createExportGrant(input: ExportGrantInput): ExportGrant {
  const now = input.now ?? Date.now();
  assertFreshStepUp(input.stepUp, now);

  const ttl = input.ttlMs ?? DEFAULT_EXPORT_TTL_MS;
  const token = (input.generateToken ?? randomToken)();
  const issuedAt = now;
  const expiresAt = now + ttl;

  return {
    exportId: fingerprint(`${input.documentId}:${issuedAt}:${token}`),
    token,
    documentId: input.documentId,
    actorId: input.actorId,
    issuedAt,
    expiresAt,
    watermark: buildWatermark(input.actorId, issuedAt),
  };
}

/** True once the grant is past its expiry. */
export function isExportExpired(grant: Pick<ExportGrant, 'expiresAt'>, now: number = Date.now()): boolean {
  return now >= grant.expiresAt;
}

/** Throws {@link ExportExpiredError} if the grant can no longer be used. */
export function assertExportUsable(grant: Pick<ExportGrant, 'expiresAt'>, now: number = Date.now()): void {
  if (isExportExpired(grant, now)) throw new ExportExpiredError();
}

/** Short, PHI-free watermark string. */
export function buildWatermark(actorId: string, issuedAt: number): string {
  const stamp = new Date(issuedAt).toISOString().slice(0, 16).replace('T', ' ');
  return `PetChain • shared by ${actorId} • ${stamp} UTC • confidential`;
}

/** Builds an audit entry that is safe to persist — no PHI, no raw token. */
export function buildShareAuditEntry(grant: ExportGrant, method: StepUpMethod): ShareAuditEntry {
  return {
    event: 'document.shared',
    exportId: grant.exportId,
    documentId: grant.documentId,
    actorId: grant.actorId,
    stepUpMethod: method,
    issuedAt: grant.issuedAt,
    expiresAt: grant.expiresAt,
    tokenFingerprint: fingerprint(grant.token),
  };
}
