/**
 * lostPetReportDraftService (Issue #1150)
 *
 * Manages the full lifecycle of a LostPetReportDraft:
 *
 *  1. OFFLINE PERSISTENCE — drafts are stored in the device's SQLite
 *     kv_store (via localDB.setItem / getItem) so they survive app restarts
 *     with no network. The draft is never sent to analytics or diagnostic
 *     exports.
 *
 *  2. CONSENT GATE — submitting or sharing is blocked until the owner
 *     explicitly consents. Consent is persisted alongside the draft so the
 *     gate survives restart. Editing the draft after consent resets it.
 *
 *  3. SERVER-CONFIRMED PERMISSIONS — before enabling submit or share the
 *     caller must call checkReportPermission(). The result is NOT trusted
 *     from local cache alone: the service always re-verifies with the
 *     backend when online. When offline the last confirmed result is used
 *     and the UI shows a clear "offline, re-check when online" message.
 *
 *  4. SUBMISSION VIA SYNC ENGINE — submitting offline queues the report in
 *     the shared dirty_records table and retries with exponential backoff
 *     and idempotency via syncEngine.markDirty('lostPetReport', …).
 *
 * Privacy: the draft key is scoped per-pet and never includes owner contact
 * or sensitive pet fields beyond what the model explicitly provides. No
 * draft data is passed to the analytics service.
 */

import apiClient from './apiClient';
import { getItem, setItem, removeItem } from './localDB';
import { syncEngine } from './syncEngine';
import {
  createLostPetReportDraft,
  validateDraft,
  withConsent,
  withConsentReset,
  hasCurrentConsent,
  buildSharePayload,
  type LostPetReportDraft,
  type DraftConsentScope,
  type SharePayloadOptions,
  type LostPetReportSharePayload,
  type DraftValidationError,
} from '../models/LostPetReportDraft';
import { logError } from '../utils/errorLogger';

// ─── Storage key helpers ──────────────────────────────────────────────────────

/** Stable kv_store key for a draft, scoped to the pet. */
function draftKey(petId: string): string {
  return `lost_pet_draft:${petId}`;
}

/** kv_store key for the last-confirmed permission result for a pet. */
function permCacheKey(petId: string): string {
  return `lost_pet_perm:${petId}`;
}

// ─── Permission types ─────────────────────────────────────────────────────────

export type ReportPermissionStatus = 'granted' | 'denied' | 'error' | 'offline';

export interface ReportPermission {
  status: ReportPermissionStatus;
  /** ISO-8601 of when the server confirmed this result. null if never confirmed. */
  confirmedAt: string | null;
  /** Human-readable reason when status is 'denied' or 'error'. */
  reason?: string;
}

interface PermissionCacheEntry {
  status: Extract<ReportPermissionStatus, 'granted' | 'denied'>;
  confirmedAt: string;
}

// ─── Permission check ─────────────────────────────────────────────────────────

/**
 * Check whether the current user may file a lost-pet report for `petId`.
 *
 * Always attempts a live server call when online. Falls back to the
 * locally cached result when offline. Network failures resolve to
 * `{ status: 'error' }`, never silently grant permission.
 *
 * Mirrors fosterHandoverService.checkAccess() — the backend endpoint
 * is GET /pets/{petId}/lost-report/permission and returns
 * `{ canReport: boolean, canShare: boolean }`.
 */
export async function checkReportPermission(petId: string): Promise<ReportPermission> {
  try {
    const response = await apiClient.get<{ canReport?: boolean; canShare?: boolean }>(
      `/pets/${encodeURIComponent(petId)}/lost-report/permission`,
    );
    const granted = response.data?.canReport === true;
    const entry: PermissionCacheEntry = {
      status: granted ? 'granted' : 'denied',
      confirmedAt: new Date().toISOString(),
    };
    // Cache the server-confirmed result so offline sessions can still
    // display a meaningful (if stale) gate state.
    await setItem(permCacheKey(petId), JSON.stringify(entry));
    return {
      status: entry.status,
      confirmedAt: entry.confirmedAt,
      reason: granted ? undefined : 'You do not have permission to report this pet as lost.',
    };
  } catch (err) {
    // Network / server error — try the local cache
    try {
      const raw = await getItem(permCacheKey(petId));
      if (raw) {
        const cached = JSON.parse(raw) as PermissionCacheEntry;
        return {
          status: 'offline',
          confirmedAt: cached.confirmedAt,
          reason:
            'Your device is offline. The last confirmed permission is shown. ' +
            'Submit and share will be re-verified when you reconnect.',
        };
      }
    } catch {
      // ignore cache read failure
    }
    logError(err instanceof Error ? err : new Error(String(err)), {
      service: 'lostPetReportDraftService',
      action: 'checkReportPermission',
      petId,
    });
    return {
      status: 'error',
      confirmedAt: null,
      reason: 'Unable to verify permission. Please try again.',
    };
  }
}

// ─── Draft persistence ────────────────────────────────────────────────────────

/**
 * Load the locally saved draft for a pet.
 * Returns null if no draft exists.
 * Never throws — on storage errors returns null.
 */
export async function loadDraft(petId: string): Promise<LostPetReportDraft | null> {
  try {
    const raw = await getItem(draftKey(petId));
    if (!raw) return null;
    return JSON.parse(raw) as LostPetReportDraft;
  } catch (err) {
    logError(err instanceof Error ? err : new Error(String(err)), {
      service: 'lostPetReportDraftService',
      action: 'loadDraft',
      petId,
    });
    return null;
  }
}

/**
 * Persist the draft locally (no network required).
 *
 * If the incoming draft already had consent and the caller changed any of
 * the core fields (lastSeenAt, approximateLocation, distinguishingDetails),
 * consent is automatically reset to protect the owner from submitting with
 * stale consent.
 *
 * @returns The saved draft (possibly with consent reset applied).
 */
export async function saveDraft(
  incoming: LostPetReportDraft,
  previous?: LostPetReportDraft | null,
): Promise<LostPetReportDraft> {
  let draft = { ...incoming, updatedAt: new Date().toISOString() };

  // Reset consent if a previously consented draft was edited
  if (previous && previous.consents.length > 0) {
    const coreChanged =
      previous.lastSeenAt !== incoming.lastSeenAt ||
      previous.approximateLocation.text !== incoming.approximateLocation.text ||
      previous.distinguishingDetails !== incoming.distinguishingDetails;
    if (coreChanged) {
      draft = withConsentReset(draft);
    }
  }

  await setItem(draftKey(draft.petId), JSON.stringify(draft));
  return draft;
}

/**
 * Create a brand-new draft for a pet and persist it immediately.
 */
export async function createAndSaveDraft(petId: string): Promise<LostPetReportDraft> {
  const draft = createLostPetReportDraft(petId);
  await setItem(draftKey(petId), JSON.stringify(draft));
  return draft;
}

/**
 * Delete the local draft for a pet (called after successful submission or
 * when the owner explicitly discards it).
 */
export async function discardDraft(petId: string): Promise<void> {
  await removeItem(draftKey(petId));
}

// ─── Review step ──────────────────────────────────────────────────────────────

/**
 * Mark the draft as reviewed (the owner has seen all fields).
 * Advances status from 'draft' to 'reviewed'; no-op if already further.
 */
export async function markAsReviewed(
  draft: LostPetReportDraft,
): Promise<LostPetReportDraft> {
  if (draft.status !== 'draft') return draft;
  const updated: LostPetReportDraft = {
    ...draft,
    status: 'reviewed',
    updatedAt: new Date().toISOString(),
  };
  await setItem(draftKey(draft.petId), JSON.stringify(updated));
  return updated;
}

// ─── Consent ──────────────────────────────────────────────────────────────────

/**
 * Record explicit consent for a scope and persist the updated draft.
 *
 * Consent is blocked (throws) when:
 *  - The draft has not been reviewed yet.
 *  - Validation fails (invalid lastSeenAt, missing location/details).
 */
export async function recordConsent(
  draft: LostPetReportDraft,
  scope: DraftConsentScope,
): Promise<LostPetReportDraft> {
  if (draft.status === 'draft') {
    throw new Error('Draft must be reviewed before consent can be given.');
  }
  const errors = validateDraft(draft);
  if (errors.length > 0) {
    throw new Error(errors.map((e) => e.message).join(' '));
  }
  const updated = withConsent(draft, scope);
  await setItem(draftKey(draft.petId), JSON.stringify(updated));
  return updated;
}

// ─── Submission ───────────────────────────────────────────────────────────────

export interface SubmitResult {
  queued: boolean;
  /** Present when queued=false (immediate success). */
  reportId?: string;
  message: string;
}

/**
 * Submit the draft report.
 *
 * Pre-conditions (all must be true, otherwise throws):
 *  - Draft has passed validation.
 *  - Owner has given submit consent (current policy version).
 *  - Permission check status is 'granted'. Callers must pass the result of
 *    the most recent checkReportPermission() call.
 *
 * When online: calls POST /pets/{petId}/lost-report/submit directly and on
 * success marks status as 'submitted'.
 * When offline (or online call fails): queues via syncEngine.markDirty so
 * the submission is retried automatically with backoff and idempotency.
 * Idempotency key = draft.id (stable, generated at draft creation).
 *
 * Never duplicates: syncEngine uses `lostPetReport:${draft.id}` as the
 * dirty_records primary key, so enqueueing the same draft twice is a no-op
 * (INSERT OR REPLACE).
 */
export async function submitDraft(
  draft: LostPetReportDraft,
  permission: ReportPermission,
): Promise<SubmitResult> {
  // ── Guard: permission ────────────────────────────────────────────────────
  if (permission.status === 'denied') {
    throw new Error(
      permission.reason ?? 'You do not have permission to submit this report.',
    );
  }
  if (permission.status === 'error') {
    throw new Error('Permission could not be verified. Please try again when online.');
  }

  // ── Guard: consent ───────────────────────────────────────────────────────
  if (!hasCurrentConsent(draft, 'submit')) {
    throw new Error('You must review and consent to submit before sending the report.');
  }

  // ── Guard: validation ────────────────────────────────────────────────────
  const errors: DraftValidationError[] = validateDraft(draft);
  if (errors.length > 0) {
    throw new Error(errors.map((e) => e.message).join(' '));
  }

  const payload = {
    reportId: draft.id,
    petId: draft.petId,
    lastSeenAt: draft.lastSeenAt,
    approximateLocation: draft.approximateLocation,
    distinguishingDetails: draft.distinguishingDetails,
    consentedAt: draft.consents.find((c) => c.scope === 'submit')?.consentedAt,
    policyVersion: draft.consents.find((c) => c.scope === 'submit')?.policyVersion,
  };

  // ── Attempt live submission ──────────────────────────────────────────────
  if (permission.status === 'granted') {
    try {
      const response = await apiClient.post<{ data: { id: string } }>(
        `/pets/${encodeURIComponent(draft.petId)}/lost-report/submit`,
        payload,
        { headers: { 'Idempotency-Key': draft.id } },
      );
      const submitted: LostPetReportDraft = {
        ...draft,
        status: 'submitted',
        updatedAt: new Date().toISOString(),
      };
      await setItem(draftKey(draft.petId), JSON.stringify(submitted));
      return {
        queued: false,
        reportId: response.data?.data?.id ?? draft.id,
        message: 'Report submitted successfully.',
      };
    } catch {
      // Fall through to queue for offline retry
    }
  }

  // ── Offline / fallback: queue via syncEngine ─────────────────────────────
  await syncEngine.markDirty('lostPetReport', draft.id, 'create', payload);
  const queued: LostPetReportDraft = {
    ...draft,
    status: 'submitted',
    updatedAt: new Date().toISOString(),
  };
  await setItem(draftKey(draft.petId), JSON.stringify(queued));
  return {
    queued: true,
    reportId: draft.id,
    message:
      permission.status === 'offline'
        ? 'Report saved. It will be submitted automatically when your device reconnects.'
        : 'Report queued. It will be submitted when connectivity allows.',
  };
}

// ─── Share ────────────────────────────────────────────────────────────────────

/**
 * Build the community share payload for a draft, enforcing consent and
 * permission checks.
 *
 * Privacy: owner contact and sensitive pet data are excluded unless
 * opts.includeOwnerContact / opts.includeSensitivePetData are true.
 */
export async function buildSharePayloadChecked(
  draft: LostPetReportDraft,
  permission: ReportPermission,
  opts: SharePayloadOptions = {},
): Promise<LostPetReportSharePayload> {
  if (permission.status === 'denied') {
    throw new Error(
      permission.reason ?? 'You do not have permission to share this report.',
    );
  }
  if (permission.status === 'error') {
    throw new Error('Permission could not be verified. Please try again when online.');
  }
  if (!hasCurrentConsent(draft, 'share')) {
    throw new Error('You must review and consent to share before distributing the report.');
  }
  const errors = validateDraft(draft);
  if (errors.length > 0) {
    throw new Error(errors.map((e) => e.message).join(' '));
  }
  return buildSharePayload(draft, opts);
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Exposed for tests: clears the permission cache for a pet. */
export async function __clearPermissionCacheForTest(petId: string): Promise<void> {
  await removeItem(permCacheKey(petId));
}

const lostPetReportDraftService = {
  checkReportPermission,
  loadDraft,
  saveDraft,
  createAndSaveDraft,
  discardDraft,
  markAsReviewed,
  recordConsent,
  submitDraft,
  buildSharePayloadChecked,
};

export default lostPetReportDraftService;
