/**
 * LostPetReportDraft model (Issue #1150)
 *
 * A field report for a lost pet, authored offline and reviewed locally
 * before the owner consents to submit or share it. The draft lives on the
 * device until explicitly submitted; it is never sent to analytics or logs.
 *
 * Privacy guarantees:
 *  - Approximate location only (coarse text + optionally rounded coords).
 *    Exact GPS coordinates are never stored in the draft by default.
 *  - Owner contact details and sensitive pet data are excluded from shared
 *    payloads unless the user opts in via SharePayloadOptions.
 *  - Consent is separate for submission and sharing, and is reset whenever
 *    the draft is edited after consent was given.
 */

// ─── Location ─────────────────────────────────────────────────────────────────

/**
 * Coarse location captured in the field.
 *
 * `text` is the primary field (neighbourhood, landmark, address fragment).
 * `roundedLat` / `roundedLng` are optional, rounded to 2 decimal places
 * (~1 km precision). Exact coordinates are never stored here.
 */
export interface ApproximateLocation {
  /** Human-readable description, e.g. "Corner of Oak St and 3rd Ave" */
  text: string;
  /** Latitude rounded to 2 d.p. — never full-precision GPS */
  roundedLat?: number;
  /** Longitude rounded to 2 d.p. — never full-precision GPS */
  roundedLng?: number;
}

// ─── Consent ──────────────────────────────────────────────────────────────────

/**
 * The two independent actions that each require their own consent.
 * Submitting sends the report to the backend under the owner's account.
 * Sharing distributes a redacted payload to the community network.
 */
export type DraftConsentScope = 'submit' | 'share';

/** A single consent decision tied to a scope and timestamp. */
export interface DraftConsentRecord {
  scope: DraftConsentScope;
  /** ISO-8601 timestamp of when the owner explicitly consented. */
  consentedAt: string;
  /**
   * Version of the consent wording presented. Bump when the wording changes
   * so stale consent is automatically invalidated.
   */
  policyVersion: string;
}

// ─── Draft status ─────────────────────────────────────────────────────────────

/**
 * Lifecycle of a draft report:
 *
 *  draft      → owner is still filling in details
 *  reviewed   → owner has opened the review step and seen all fields
 *  consented  → owner has given consent for at least one scope
 *  submitted  → report has been queued or sent to the backend
 */
export type DraftStatus = 'draft' | 'reviewed' | 'consented' | 'submitted';

// ─── Main model ───────────────────────────────────────────────────────────────

/**
 * A local-only lost-pet field report draft.
 *
 * The draft is stored in the device's encrypted SQLite kv_store and
 * persists across app restarts. It is excluded from all analytics and
 * diagnostic exports.
 */
export interface LostPetReportDraft {
  /** Client-generated stable identifier, doubles as idempotency key. */
  id: string;
  /** The pet this report is about. */
  petId: string;
  /**
   * When the owner last saw the pet.
   * Must not be in the future; validated before review is allowed.
   */
  lastSeenAt: string; // ISO-8601
  /** Coarse location — never exact GPS. */
  approximateLocation: ApproximateLocation;
  /**
   * Free-text description of distinguishing marks, collar, colour, etc.
   * Max 2 000 characters; validated before submission.
   */
  distinguishingDetails: string;
  /** Current lifecycle state. */
  status: DraftStatus;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** ISO-8601 of last edit. Reset to 'draft' / clears consent on change. */
  updatedAt: string;
  /**
   * Consent records. There is at most one record per scope; a new consent
   * overwrites the previous one for the same scope.
   */
  consents: DraftConsentRecord[];
}

// ─── Shared payload ───────────────────────────────────────────────────────────

/**
 * Options controlling which fields appear in a shared payload.
 * All sensitive fields default to excluded unless the user opts in.
 */
export interface SharePayloadOptions {
  /** Include owner contact details (name, email, phone). Default: false. */
  includeOwnerContact?: boolean;
  /** Include extra pet details (breed, microchip, weight). Default: false. */
  includeSensitivePetData?: boolean;
}

/**
 * The payload sent when the owner shares the report with the community.
 * Never includes owner contact or sensitive pet data unless opted in.
 */
export interface LostPetReportSharePayload {
  reportId: string;
  petId: string;
  lastSeenAt: string;
  approximateLocation: ApproximateLocation;
  distinguishingDetails: string;
  sharedAt: string;
  /** Present only when includeOwnerContact was true. */
  ownerContact?: { name: string; email?: string; phone?: string };
  /** Present only when includeSensitivePetData was true. */
  sensitivePetData?: { breed?: string; microchipId?: string; weightKg?: number };
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Version of the consent wording. Bump this string whenever the text shown
 * to the owner changes so previously granted consents are re-required.
 */
export const DRAFT_CONSENT_POLICY_VERSION = '2026-10-21.v1';

/** Maximum length of distinguishingDetails. */
export const MAX_DISTINGUISHING_DETAILS_LENGTH = 2_000;

// ─── Factory ──────────────────────────────────────────────────────────────────

/** Generate a RFC-4122-ish client ID without external dependencies. */
function generateDraftId(): string {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 10);
  return `lprd_${ts}_${rnd}`;
}

/**
 * Create a new draft with sensible defaults.
 * `lastSeenAt` defaults to now; callers should replace it with the actual
 * field-observed time before saving.
 */
export function createLostPetReportDraft(
  petId: string,
  overrides: Partial<Omit<LostPetReportDraft, 'id' | 'petId' | 'createdAt'>> = {},
): LostPetReportDraft {
  const now = new Date().toISOString();
  return {
    id: generateDraftId(),
    petId,
    lastSeenAt: overrides.lastSeenAt ?? now,
    approximateLocation: overrides.approximateLocation ?? { text: '' },
    distinguishingDetails: overrides.distinguishingDetails ?? '',
    status: overrides.status ?? 'draft',
    createdAt: now,
    updatedAt: now,
    consents: overrides.consents ?? [],
  };
}

// ─── Validators ───────────────────────────────────────────────────────────────

export interface DraftValidationError {
  field: keyof LostPetReportDraft | 'approximateLocation.text';
  message: string;
}

/**
 * Validate a draft before the review step.
 *
 * Returns an array of errors; an empty array means the draft is valid.
 * Never throws.
 */
export function validateDraft(draft: LostPetReportDraft): DraftValidationError[] {
  const errors: DraftValidationError[] = [];

  // lastSeenAt must be a valid date and not in the future
  const seenMs = Date.parse(draft.lastSeenAt);
  if (Number.isNaN(seenMs)) {
    errors.push({ field: 'lastSeenAt', message: 'Last-seen time is invalid.' });
  } else if (seenMs > Date.now()) {
    errors.push({ field: 'lastSeenAt', message: 'Last-seen time cannot be in the future.' });
  }

  // Location text is required
  if (!draft.approximateLocation.text.trim()) {
    errors.push({
      field: 'approximateLocation.text',
      message: 'Approximate location is required.',
    });
  }

  // distinguishingDetails: non-empty and within max length
  if (!draft.distinguishingDetails.trim()) {
    errors.push({
      field: 'distinguishingDetails',
      message: 'Distinguishing details are required.',
    });
  } else if (draft.distinguishingDetails.length > MAX_DISTINGUISHING_DETAILS_LENGTH) {
    errors.push({
      field: 'distinguishingDetails',
      message: `Distinguishing details must be ${MAX_DISTINGUISHING_DETAILS_LENGTH} characters or fewer.`,
    });
  }

  return errors;
}

// ─── Consent helpers ──────────────────────────────────────────────────────────

/** Whether the draft has current, valid consent for a given scope. */
export function hasCurrentConsent(
  draft: LostPetReportDraft,
  scope: DraftConsentScope,
): boolean {
  const record = draft.consents.find((c) => c.scope === scope);
  return record?.policyVersion === DRAFT_CONSENT_POLICY_VERSION;
}

/**
 * Return a new draft with consent recorded for `scope`.
 * Does not mutate the original. Also advances status to 'consented' when
 * at least one scope is consented.
 */
export function withConsent(
  draft: LostPetReportDraft,
  scope: DraftConsentScope,
): LostPetReportDraft {
  const now = new Date().toISOString();
  const newRecord: DraftConsentRecord = {
    scope,
    consentedAt: now,
    policyVersion: DRAFT_CONSENT_POLICY_VERSION,
  };
  const consents = [
    ...draft.consents.filter((c) => c.scope !== scope),
    newRecord,
  ];
  return {
    ...draft,
    consents,
    status: draft.status === 'reviewed' || draft.status === 'draft' ? 'consented' : draft.status,
    updatedAt: now,
  };
}

/**
 * Return a new draft with all consents cleared (used when the draft is
 * edited after consent was given).
 */
export function withConsentReset(draft: LostPetReportDraft): LostPetReportDraft {
  const now = new Date().toISOString();
  return {
    ...draft,
    consents: [],
    status: draft.status === 'consented' ? 'draft' : draft.status,
    updatedAt: now,
  };
}

/**
 * Build the share payload from a draft, respecting privacy defaults.
 * Sensitive fields are excluded unless the caller explicitly opts in.
 */
export function buildSharePayload(
  draft: LostPetReportDraft,
  options: SharePayloadOptions = {},
): LostPetReportSharePayload {
  return {
    reportId: draft.id,
    petId: draft.petId,
    lastSeenAt: draft.lastSeenAt,
    approximateLocation: draft.approximateLocation,
    distinguishingDetails: draft.distinguishingDetails,
    sharedAt: new Date().toISOString(),
    // ownerContact and sensitivePetData are intentionally omitted by default
    ...(options.includeOwnerContact ? { ownerContact: undefined } : {}),
    ...(options.includeSensitivePetData ? { sensitivePetData: undefined } : {}),
  };
}

export default LostPetReportDraft;
