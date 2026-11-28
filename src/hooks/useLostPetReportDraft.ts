/**
 * useLostPetReportDraft (Issue #1150)
 *
 * React hook that manages the full lifecycle of a LostPetReportDraft for a
 * single pet:
 *
 *  - Loads (or creates) the draft on mount.
 *  - Auto-saves on every field change, resetting consent when core fields
 *    change after consent has been given.
 *  - Exposes imperative methods for review, consent, submit, and share.
 *  - Checks server-confirmed permission on mount and re-checks when the
 *    device comes back online.
 *  - Re-checks permission automatically when network connectivity is restored
 *    (using useNetworkStatus).
 *
 * The hook never passes draft data to analytics or diagnostic services.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import useNetworkStatus from './useNetworkStatus';
import {
  checkReportPermission,
  loadDraft,
  saveDraft,
  createAndSaveDraft,
  markAsReviewed,
  recordConsent,
  submitDraft,
  buildSharePayloadChecked,
  type ReportPermission,
  type SubmitResult,
} from '../services/lostPetReportDraftService';
import {
  type LostPetReportDraft,
  type DraftConsentScope,
  type SharePayloadOptions,
  type LostPetReportSharePayload,
  validateDraft,
  type DraftValidationError,
} from '../models/LostPetReportDraft';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface UseLostPetReportDraftResult {
  /** The current draft, or null while loading. */
  draft: LostPetReportDraft | null;
  /** True during initial load or async operations. */
  loading: boolean;
  /** Error message from the most recent failed operation. */
  error: string | null;
  /** Validation errors from the most recent validateDraft() call. */
  validationErrors: DraftValidationError[];
  /** Server-confirmed permission result (null until first check completes). */
  permission: ReportPermission | null;
  /** True while a permission check is in flight. */
  permissionLoading: boolean;

  /**
   * Persist a partial update to the draft. Automatically resets consent when
   * core fields (lastSeenAt, approximateLocation, distinguishingDetails)
   * change after consent has been granted.
   */
  updateDraft: (patch: Partial<LostPetReportDraft>) => Promise<void>;

  /** Advance status to 'reviewed'. */
  reviewDraft: () => Promise<void>;

  /** Record explicit consent for a scope (requires reviewed status). */
  consentTo: (scope: DraftConsentScope) => Promise<void>;

  /** Submit the draft (queued offline-first). */
  submit: () => Promise<SubmitResult>;

  /** Build the share payload (consent + permission checked). */
  buildShare: (opts?: SharePayloadOptions) => Promise<LostPetReportSharePayload>;

  /** Re-run the server permission check manually. */
  recheckPermission: () => Promise<void>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Manages a LostPetReportDraft for the given petId.
 *
 * @param petId - The pet this report is about.
 */
export function useLostPetReportDraft(petId: string): UseLostPetReportDraftResult {
  const [draft, setDraft] = useState<LostPetReportDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<DraftValidationError[]>([]);
  const [permission, setPermission] = useState<ReportPermission | null>(null);
  const [permissionLoading, setPermissionLoading] = useState(false);

  const { isOnline } = useNetworkStatus();
  const isMounted = useRef(true);
  const prevIsOnline = useRef(isOnline);
  // Keep a ref to the previous draft so saveDraft can compare core fields.
  const prevDraftRef = useRef<LostPetReportDraft | null>(null);

  // ── Initial load ──────────────────────────────────────────────────────────

  useEffect(() => {
    isMounted.current = true;
    let cancelled = false;

    const init = async () => {
      setLoading(true);
      try {
        let loaded = await loadDraft(petId);
        if (!loaded) {
          loaded = await createAndSaveDraft(petId);
        }
        if (!cancelled && isMounted.current) {
          prevDraftRef.current = loaded;
          setDraft(loaded);
        }
      } catch (err) {
        if (!cancelled && isMounted.current) {
          setError(err instanceof Error ? err.message : 'Failed to load draft.');
        }
      } finally {
        if (!cancelled && isMounted.current) setLoading(false);
      }
    };

    void init();
    return () => {
      cancelled = true;
      isMounted.current = false;
    };
  }, [petId]);

  // ── Permission check on mount ─────────────────────────────────────────────

  const recheckPermission = useCallback(async () => {
    if (!isMounted.current) return;
    setPermissionLoading(true);
    try {
      const result = await checkReportPermission(petId);
      if (isMounted.current) setPermission(result);
    } catch (err) {
      if (isMounted.current) {
        setError(err instanceof Error ? err.message : 'Permission check failed.');
      }
    } finally {
      if (isMounted.current) setPermissionLoading(false);
    }
  }, [petId]);

  useEffect(() => {
    void recheckPermission();
  }, [recheckPermission]);

  // ── Re-check permission when coming back online ───────────────────────────

  useEffect(() => {
    const cameOnline = !prevIsOnline.current && isOnline;
    prevIsOnline.current = isOnline;
    if (cameOnline) {
      void recheckPermission();
    }
  }, [isOnline, recheckPermission]);

  // ── updateDraft ───────────────────────────────────────────────────────────

  const updateDraft = useCallback(
    async (patch: Partial<LostPetReportDraft>) => {
      if (!draft) return;
      setError(null);
      try {
        const merged: LostPetReportDraft = { ...draft, ...patch };
        const saved = await saveDraft(merged, prevDraftRef.current);
        if (isMounted.current) {
          prevDraftRef.current = saved;
          setDraft(saved);
          setValidationErrors(validateDraft(saved));
        }
      } catch (err) {
        if (isMounted.current) {
          setError(err instanceof Error ? err.message : 'Failed to save draft.');
        }
      }
    },
    [draft],
  );

  // ── reviewDraft ───────────────────────────────────────────────────────────

  const reviewDraft = useCallback(async () => {
    if (!draft) return;
    setError(null);
    // Validate before advancing
    const errs = validateDraft(draft);
    setValidationErrors(errs);
    if (errs.length > 0) {
      setError(errs[0].message);
      return;
    }
    try {
      const updated = await markAsReviewed(draft);
      if (isMounted.current) {
        prevDraftRef.current = updated;
        setDraft(updated);
      }
    } catch (err) {
      if (isMounted.current) {
        setError(err instanceof Error ? err.message : 'Failed to mark draft as reviewed.');
      }
    }
  }, [draft]);

  // ── consentTo ─────────────────────────────────────────────────────────────

  const consentTo = useCallback(
    async (scope: DraftConsentScope) => {
      if (!draft) return;
      setError(null);
      try {
        const updated = await recordConsent(draft, scope);
        if (isMounted.current) {
          prevDraftRef.current = updated;
          setDraft(updated);
        }
      } catch (err) {
        if (isMounted.current) {
          setError(err instanceof Error ? err.message : 'Failed to record consent.');
        }
      }
    },
    [draft],
  );

  // ── submit ────────────────────────────────────────────────────────────────

  const submit = useCallback(async (): Promise<SubmitResult> => {
    if (!draft) throw new Error('No draft to submit.');
    if (!permission) throw new Error('Permission has not been checked yet.');
    setError(null);
    try {
      const result = await submitDraft(draft, permission);
      if (isMounted.current) {
        const reloaded = await loadDraft(petId);
        if (reloaded && isMounted.current) {
          prevDraftRef.current = reloaded;
          setDraft(reloaded);
        }
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Submission failed.';
      if (isMounted.current) setError(message);
      throw new Error(message);
    }
  }, [draft, permission, petId]);

  // ── buildShare ────────────────────────────────────────────────────────────

  const buildShare = useCallback(
    async (opts: SharePayloadOptions = {}): Promise<LostPetReportSharePayload> => {
      if (!draft) throw new Error('No draft to share.');
      if (!permission) throw new Error('Permission has not been checked yet.');
      setError(null);
      try {
        return await buildSharePayloadChecked(draft, permission, opts);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to build share payload.';
        if (isMounted.current) setError(message);
        throw new Error(message);
      }
    },
    [draft, permission],
  );

  return {
    draft,
    loading,
    error,
    validationErrors,
    permission,
    permissionLoading,
    updateDraft,
    reviewDraft,
    consentTo,
    submit,
    buildShare,
    recheckPermission,
  };
}

export default useLostPetReportDraft;
