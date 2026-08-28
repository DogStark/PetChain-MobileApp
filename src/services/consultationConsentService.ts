/**
 * Telemedicine consent (Issue #969)
 *
 * A video consultation can reach the camera, the microphone, the screen, and
 * files on the device, and the session may be recorded into the pet's medical
 * record. Each of those is a separate disclosure, so each is consented to
 * separately and recorded separately.
 *
 * What this module guarantees:
 *
 *  - **Versioned.** Every record carries `policyVersion`. When the wording of
 *    the consent prompt changes, bump {@link CONSENT_POLICY_VERSION} — consent
 *    to the old wording is then no longer consent to the new one, and
 *    `hasCurrentConsent` reports the participant as needing to be re-asked.
 *  - **Attributed.** Every record names the participant and their role. The
 *    previous implementation posted an empty body, so the backend could not
 *    tell who had consented.
 *  - **Two-sided.** A denial is recorded as explicitly as a grant. Previously
 *    only "I Consent" was sent, so a decline was indistinguishable from a user
 *    who never answered — and nothing downstream could prove recording was
 *    refused.
 *  - **Auditable.** Records are timestamped and posted through `apiClient`, so
 *    they carry the caller's auth headers.
 *
 * No personal or clinical content is stored here — only the decision itself.
 */

import apiClient from './apiClient';
import { logError } from '../utils/errorLogger';

/**
 * Version of the consent wording presented to participants.
 *
 * Bump this whenever the prompt's meaning changes. Records written under an
 * older version no longer satisfy {@link hasCurrentConsent}.
 */
export const CONSENT_POLICY_VERSION = '2026-08-25.v1';

/** A capability that requires its own, separately recorded consent. */
export type ConsentScope =
  /** Live camera feed to the other participant. */
  | 'camera'
  /** Live microphone feed to the other participant. */
  | 'microphone'
  /** Persisting the session into the pet's medical record. */
  | 'recording'
  /** Sharing the device screen, which may expose unrelated documents. */
  | 'screen_share'
  /** Uploading files or images during the call. */
  | 'file_upload';

export type ConsentDecision = 'granted' | 'denied';

export interface ConsentRecord {
  consultationId: string;
  participantId: string;
  participantRole: 'OWNER' | 'VET';
  scope: ConsentScope;
  decision: ConsentDecision;
  /** Wording version the participant actually saw. */
  policyVersion: string;
  /** ISO-8601 timestamp of the decision. */
  recordedAt: string;
}

/**
 * In-memory record of this session's decisions.
 *
 * Deliberately not persisted: consent is per-consultation and must be asked
 * again next time. Keyed by `${consultationId}:${participantId}:${scope}`.
 */
const sessionConsents = new Map<string, ConsentRecord>();

function key(consultationId: string, participantId: string, scope: ConsentScope): string {
  return `${consultationId}:${participantId}:${scope}`;
}

/**
 * Record a consent decision and report it to the backend.
 *
 * The local record is written first and unconditionally, so a network failure
 * can never cause the UI to treat a denial as "not yet asked" and re-prompt —
 * or worse, proceed. Backend reporting is best-effort and logged on failure.
 */
export async function recordConsent(input: {
  consultationId: string;
  participantId: string;
  participantRole: 'OWNER' | 'VET';
  scope: ConsentScope;
  decision: ConsentDecision;
}): Promise<ConsentRecord> {
  const record: ConsentRecord = {
    ...input,
    policyVersion: CONSENT_POLICY_VERSION,
    recordedAt: new Date().toISOString(),
  };

  sessionConsents.set(key(input.consultationId, input.participantId, input.scope), record);

  try {
    await apiClient.post(`/consultations/${encodeURIComponent(input.consultationId)}/consent`, {
      participantId: record.participantId,
      participantRole: record.participantRole,
      scope: record.scope,
      decision: record.decision,
      policyVersion: record.policyVersion,
      recordedAt: record.recordedAt,
    });
  } catch (err) {
    // The decision still stands locally. Surfacing the failure matters because
    // an unrecorded grant means the recording has no server-side authority.
    logError(err instanceof Error ? err : new Error(String(err)), {
      service: 'consultationConsentService',
      action: 'recordConsent',
      scope: record.scope,
      decision: record.decision,
    });
  }

  return record;
}

/** The decision for `scope`, or `undefined` if the participant was never asked. */
export function getConsent(
  consultationId: string,
  participantId: string,
  scope: ConsentScope,
): ConsentRecord | undefined {
  return sessionConsents.get(key(consultationId, participantId, scope));
}

/**
 * True only when the participant granted `scope` under the *current* policy
 * version. An unanswered prompt, a denial, or a grant under superseded wording
 * all return false.
 */
export function hasCurrentConsent(
  consultationId: string,
  participantId: string,
  scope: ConsentScope,
): boolean {
  const record = getConsent(consultationId, participantId, scope);
  return (
    record != null &&
    record.decision === 'granted' &&
    record.policyVersion === CONSENT_POLICY_VERSION
  );
}

/** Drop this consultation's decisions — call when the call ends. */
export function clearConsents(consultationId: string): void {
  for (const mapKey of Array.from(sessionConsents.keys())) {
    if (mapKey.startsWith(`${consultationId}:`)) sessionConsents.delete(mapKey);
  }
}

/** Test-only: reset all in-memory state. */
export function __resetConsentsForTest(): void {
  sessionConsents.clear();
}

const consultationConsentService = {
  CONSENT_POLICY_VERSION,
  recordConsent,
  getConsent,
  hasCurrentConsent,
  clearConsents,
};

export default consultationConsentService;
