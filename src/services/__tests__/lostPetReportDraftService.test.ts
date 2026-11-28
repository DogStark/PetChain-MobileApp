/**
 * Tests for lostPetReportDraftService (Issue #1150)
 *
 * Coverage:
 *  - main flow: create, save offline, review, consent, submit (online + queued)
 *  - draft persists across restart (reload from storage)
 *  - submit and share blocked without consent; editing after consent resets it
 *  - permission denied; stale/offline permission blocks submit; re-check unblocks
 *  - offline submit is queued via syncEngine and not duplicated
 *  - boundaries: lastSeenAt in future rejected, empty details, very long details,
 *    missing location
 *  - privacy: shared payload excludes sensitive fields by default
 */

// ─── Module-level mocks (must be before any imports) ─────────────────────────

const mockGetItem = jest.fn<Promise<string | null>, [string]>();
const mockSetItem = jest.fn<Promise<void>, [string, string]>();
const mockRemoveItem = jest.fn<Promise<void>, [string]>();
const mockApiGet = jest.fn();
const mockApiPost = jest.fn();
const mockMarkDirty = jest.fn();
const mockLogError = jest.fn();

jest.mock('../localDB', () => ({
  getItem: (...args: [string]) => mockGetItem(...args),
  setItem: (...args: [string, string]) => mockSetItem(...args),
  removeItem: (...args: [string]) => mockRemoveItem(...args),
}));

jest.mock('../apiClient', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
  },
}));

jest.mock('../syncEngine', () => ({
  syncEngine: {
    markDirty: (...args: unknown[]) => mockMarkDirty(...args),
  },
}));

jest.mock('../../utils/errorLogger', () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {
  checkReportPermission,
  loadDraft,
  saveDraft,
  createAndSaveDraft,
  discardDraft,
  markAsReviewed,
  recordConsent,
  submitDraft,
  buildSharePayloadChecked,
  __clearPermissionCacheForTest,
} from '../lostPetReportDraftService';

import {
  createLostPetReportDraft,
  validateDraft,
  withConsent,
  withConsentReset,
  hasCurrentConsent,
  buildSharePayload,
  DRAFT_CONSENT_POLICY_VERSION,
  MAX_DISTINGUISHING_DETAILS_LENGTH,
  type LostPetReportDraft,
} from '../../models/LostPetReportDraft';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PET_ID = 'pet-abc-123';

function makeDraft(overrides: Partial<LostPetReportDraft> = {}): LostPetReportDraft {
  return createLostPetReportDraft(PET_ID, {
    lastSeenAt: new Date(Date.now() - 60_000).toISOString(), // 1 min ago
    approximateLocation: { text: 'Near Oak St & 3rd Ave' },
    distinguishingDetails: 'Black Lab, red collar, name tag "Max"',
    ...overrides,
  });
}

function makeReviewedDraft(overrides: Partial<LostPetReportDraft> = {}): LostPetReportDraft {
  return { ...makeDraft(overrides), status: 'reviewed' };
}

function makeConsentedDraft(scope: 'submit' | 'share' | 'both' = 'submit'): LostPetReportDraft {
  let d = makeReviewedDraft();
  if (scope === 'submit' || scope === 'both') d = withConsent(d, 'submit');
  if (scope === 'share' || scope === 'both') d = withConsent(d, 'share');
  return d;
}

const GRANTED_PERMISSION = {
  status: 'granted' as const,
  confirmedAt: new Date().toISOString(),
};

const DENIED_PERMISSION = {
  status: 'denied' as const,
  confirmedAt: new Date().toISOString(),
  reason: 'You do not have permission to report this pet as lost.',
};

const OFFLINE_PERMISSION = {
  status: 'offline' as const,
  confirmedAt: new Date(Date.now() - 3_600_000).toISOString(), // 1 hr ago
  reason: 'Your device is offline.',
};

const ERROR_PERMISSION = {
  status: 'error' as const,
  confirmedAt: null,
  reason: 'Unable to verify permission.',
};

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockGetItem.mockResolvedValue(null);
  mockSetItem.mockResolvedValue(undefined);
  mockRemoveItem.mockResolvedValue(undefined);
  mockMarkDirty.mockResolvedValue({ id: `lostPetReport:${PET_ID}` });
});

// ═════════════════════════════════════════════════════════════════════════════
// MODEL — validateDraft
// ═════════════════════════════════════════════════════════════════════════════

describe('validateDraft', () => {
  it('returns no errors for a valid draft', () => {
    expect(validateDraft(makeDraft())).toHaveLength(0);
  });

  it('rejects lastSeenAt in the future', () => {
    const draft = makeDraft({ lastSeenAt: new Date(Date.now() + 60_000).toISOString() });
    const errs = validateDraft(draft);
    expect(errs.some((e) => e.field === 'lastSeenAt')).toBe(true);
    expect(errs[0].message).toMatch(/future/i);
  });

  it('rejects an invalid (non-parseable) lastSeenAt', () => {
    const draft = makeDraft({ lastSeenAt: 'not-a-date' });
    const errs = validateDraft(draft);
    expect(errs.some((e) => e.field === 'lastSeenAt')).toBe(true);
  });

  it('rejects empty distinguishingDetails', () => {
    const draft = makeDraft({ distinguishingDetails: '   ' });
    const errs = validateDraft(draft);
    expect(errs.some((e) => e.field === 'distinguishingDetails')).toBe(true);
  });

  it('rejects distinguishingDetails exceeding max length', () => {
    const draft = makeDraft({
      distinguishingDetails: 'x'.repeat(MAX_DISTINGUISHING_DETAILS_LENGTH + 1),
    });
    const errs = validateDraft(draft);
    expect(errs.some((e) => e.field === 'distinguishingDetails')).toBe(true);
    expect(errs[0].message).toMatch(/2.000|2000/);
  });

  it('accepts distinguishingDetails at exactly max length', () => {
    const draft = makeDraft({
      distinguishingDetails: 'x'.repeat(MAX_DISTINGUISHING_DETAILS_LENGTH),
    });
    expect(validateDraft(draft)).toHaveLength(0);
  });

  it('rejects empty location text', () => {
    const draft = makeDraft({ approximateLocation: { text: '   ' } });
    const errs = validateDraft(draft);
    expect(errs.some((e) => e.field === 'approximateLocation.text')).toBe(true);
  });

  it('collects multiple errors at once', () => {
    const draft = makeDraft({
      lastSeenAt: new Date(Date.now() + 60_000).toISOString(),
      approximateLocation: { text: '' },
      distinguishingDetails: '',
    });
    expect(validateDraft(draft).length).toBeGreaterThanOrEqual(3);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// MODEL — consent helpers
// ═════════════════════════════════════════════════════════════════════════════

describe('consent model helpers', () => {
  it('hasCurrentConsent returns false before any consent', () => {
    expect(hasCurrentConsent(makeDraft(), 'submit')).toBe(false);
    expect(hasCurrentConsent(makeDraft(), 'share')).toBe(false);
  });

  it('hasCurrentConsent returns true after withConsent for the matching scope', () => {
    const d = withConsent(makeReviewedDraft(), 'submit');
    expect(hasCurrentConsent(d, 'submit')).toBe(true);
    expect(hasCurrentConsent(d, 'share')).toBe(false);
  });

  it('withConsentReset clears all consents and reverts status to draft', () => {
    const d = withConsentReset(makeConsentedDraft('both'));
    expect(d.consents).toHaveLength(0);
    expect(d.status).toBe('draft');
  });

  it('consent record carries the current policy version', () => {
    const d = withConsent(makeReviewedDraft(), 'share');
    const rec = d.consents.find((c) => c.scope === 'share');
    expect(rec?.policyVersion).toBe(DRAFT_CONSENT_POLICY_VERSION);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SERVICE — checkReportPermission
// ═════════════════════════════════════════════════════════════════════════════

describe('checkReportPermission', () => {
  it('returns granted when server responds canReport=true and caches result', async () => {
    mockApiGet.mockResolvedValueOnce({ data: { canReport: true } });

    const result = await checkReportPermission(PET_ID);

    expect(result.status).toBe('granted');
    expect(result.confirmedAt).not.toBeNull();
    // Should have written cache
    expect(mockSetItem).toHaveBeenCalledWith(
      expect.stringContaining('lost_pet_perm'),
      expect.stringContaining('"granted"'),
    );
  });

  it('returns denied when server responds canReport=false', async () => {
    mockApiGet.mockResolvedValueOnce({ data: { canReport: false } });

    const result = await checkReportPermission(PET_ID);

    expect(result.status).toBe('denied');
    expect(result.reason).toMatch(/permission/i);
  });

  it('returns offline with stale confirmedAt when network fails but cache exists', async () => {
    const cached = JSON.stringify({
      status: 'granted',
      confirmedAt: new Date(Date.now() - 3_600_000).toISOString(),
    });
    mockApiGet.mockRejectedValueOnce(new Error('Network error'));
    mockGetItem.mockResolvedValueOnce(cached);

    const result = await checkReportPermission(PET_ID);

    expect(result.status).toBe('offline');
    expect(result.confirmedAt).not.toBeNull();
    expect(result.reason).toMatch(/offline/i);
  });

  it('returns error when network fails and no cache exists', async () => {
    mockApiGet.mockRejectedValueOnce(new Error('Network error'));
    mockGetItem.mockResolvedValueOnce(null);

    const result = await checkReportPermission(PET_ID);

    expect(result.status).toBe('error');
    expect(result.confirmedAt).toBeNull();
    expect(mockLogError).toHaveBeenCalledTimes(1);
  });

  it('re-check online after stale offline returns granted and updates cache', async () => {
    // First call: offline
    mockApiGet.mockRejectedValueOnce(new Error('offline'));
    mockGetItem.mockResolvedValueOnce(
      JSON.stringify({ status: 'granted', confirmedAt: new Date(0).toISOString() }),
    );
    const offline = await checkReportPermission(PET_ID);
    expect(offline.status).toBe('offline');

    // Second call: back online
    mockApiGet.mockResolvedValueOnce({ data: { canReport: true } });
    const online = await checkReportPermission(PET_ID);
    expect(online.status).toBe('granted');
    expect(mockSetItem).toHaveBeenCalledWith(
      expect.stringContaining('lost_pet_perm'),
      expect.stringContaining('"granted"'),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SERVICE — draft persistence
// ═════════════════════════════════════════════════════════════════════════════

describe('draft persistence', () => {
  it('createAndSaveDraft stores a new draft and returns it', async () => {
    const draft = await createAndSaveDraft(PET_ID);

    expect(draft.petId).toBe(PET_ID);
    expect(draft.status).toBe('draft');
    expect(mockSetItem).toHaveBeenCalledWith(
      `lost_pet_draft:${PET_ID}`,
      expect.stringContaining('"draft"'),
    );
  });

  it('loadDraft returns null when nothing stored', async () => {
    mockGetItem.mockResolvedValueOnce(null);
    expect(await loadDraft(PET_ID)).toBeNull();
  });

  it('loadDraft returns persisted draft — survives restart', async () => {
    const original = makeDraft();
    mockGetItem.mockResolvedValueOnce(JSON.stringify(original));

    const loaded = await loadDraft(PET_ID);

    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(original.id);
    expect(loaded!.distinguishingDetails).toBe(original.distinguishingDetails);
  });

  it('loadDraft returns null on storage error without throwing', async () => {
    mockGetItem.mockRejectedValueOnce(new Error('storage failure'));
    expect(await loadDraft(PET_ID)).toBeNull();
    expect(mockLogError).toHaveBeenCalledTimes(1);
  });

  it('saveDraft persists updated fields', async () => {
    const draft = makeDraft();
    const updated = { ...draft, distinguishingDetails: 'White Husky, blue eyes' };

    const saved = await saveDraft(updated);

    expect(saved.distinguishingDetails).toBe('White Husky, blue eyes');
    expect(mockSetItem).toHaveBeenCalledWith(
      `lost_pet_draft:${PET_ID}`,
      expect.stringContaining('White Husky'),
    );
  });

  it('discardDraft removes the stored key', async () => {
    await discardDraft(PET_ID);
    expect(mockRemoveItem).toHaveBeenCalledWith(`lost_pet_draft:${PET_ID}`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SERVICE — editing after consent resets it
// ═════════════════════════════════════════════════════════════════════════════

describe('editing after consent resets consent', () => {
  it('changing lastSeenAt after submit consent resets all consents', async () => {
    const consented = makeConsentedDraft('submit');
    const edited = { ...consented, lastSeenAt: new Date(Date.now() - 120_000).toISOString() };

    const saved = await saveDraft(edited, consented);

    expect(saved.consents).toHaveLength(0);
    expect(saved.status).toBe('draft');
  });

  it('changing location text after consent resets all consents', async () => {
    const consented = makeConsentedDraft('both');
    const edited = {
      ...consented,
      approximateLocation: { text: 'Different street' },
    };

    const saved = await saveDraft(edited, consented);

    expect(saved.consents).toHaveLength(0);
  });

  it('changing distinguishingDetails after consent resets all consents', async () => {
    const consented = makeConsentedDraft('submit');
    const edited = { ...consented, distinguishingDetails: 'New details' };

    const saved = await saveDraft(edited, consented);

    expect(saved.consents).toHaveLength(0);
  });

  it('changing a non-core field does NOT reset consent', async () => {
    const consented = makeConsentedDraft('submit');
    // status is not a "core" field that should reset consent
    const edited = { ...consented, updatedAt: new Date().toISOString() };

    const saved = await saveDraft(edited, consented);

    // Consent should still be present (no core field changed)
    expect(saved.consents.length).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SERVICE — review step
// ═════════════════════════════════════════════════════════════════════════════

describe('markAsReviewed', () => {
  it('advances status from draft to reviewed', async () => {
    const draft = makeDraft();
    const reviewed = await markAsReviewed(draft);
    expect(reviewed.status).toBe('reviewed');
  });

  it('is a no-op if status is already reviewed or beyond', async () => {
    const draft = makeReviewedDraft();
    const result = await markAsReviewed(draft);
    expect(result.status).toBe('reviewed');
    // setItem is still called once to persist
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SERVICE — consent gate
// ═════════════════════════════════════════════════════════════════════════════

describe('recordConsent', () => {
  it('records submit consent on a reviewed draft', async () => {
    const reviewed = makeReviewedDraft();
    const consented = await recordConsent(reviewed, 'submit');
    expect(hasCurrentConsent(consented, 'submit')).toBe(true);
  });

  it('records share consent independently', async () => {
    const reviewed = makeReviewedDraft();
    const consented = await recordConsent(reviewed, 'share');
    expect(hasCurrentConsent(consented, 'share')).toBe(true);
    expect(hasCurrentConsent(consented, 'submit')).toBe(false);
  });

  it('throws when draft has not been reviewed yet', async () => {
    const draft = makeDraft(); // status='draft'
    await expect(recordConsent(draft, 'submit')).rejects.toThrow(/reviewed/i);
  });

  it('throws when validation fails (future lastSeenAt)', async () => {
    const draft = makeReviewedDraft({
      lastSeenAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await expect(recordConsent(draft, 'submit')).rejects.toThrow(/future/i);
  });

  it('submit is blocked without consent', async () => {
    const draft = makeReviewedDraft(); // no consent yet
    await expect(submitDraft(draft, GRANTED_PERMISSION)).rejects.toThrow(/consent/i);
  });

  it('share is blocked without consent', async () => {
    const draft = makeConsentedDraft('submit'); // only submit consented
    await expect(buildSharePayloadChecked(draft, GRANTED_PERMISSION)).rejects.toThrow(/consent/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SERVICE — submit (online path)
// ═════════════════════════════════════════════════════════════════════════════

describe('submitDraft — online', () => {
  it('main flow: POSTs to backend and returns queued=false on success', async () => {
    const draft = makeConsentedDraft('submit');
    mockApiPost.mockResolvedValueOnce({ data: { data: { id: 'report-server-id' } } });

    const result = await submitDraft(draft, GRANTED_PERMISSION);

    expect(result.queued).toBe(false);
    expect(result.reportId).toBe('report-server-id');
    // Draft status updated to submitted
    const persisted = JSON.parse(mockSetItem.mock.calls.at(-1)![1]) as LostPetReportDraft;
    expect(persisted.status).toBe('submitted');
  });

  it('sends Idempotency-Key header equal to draft.id', async () => {
    const draft = makeConsentedDraft('submit');
    mockApiPost.mockResolvedValueOnce({ data: { data: { id: 'r1' } } });

    await submitDraft(draft, GRANTED_PERMISSION);

    expect(mockApiPost).toHaveBeenCalledWith(
      expect.stringContaining('/lost-report/submit'),
      expect.objectContaining({ reportId: draft.id }),
      expect.objectContaining({ headers: { 'Idempotency-Key': draft.id } }),
    );
  });

  it('throws when permission is denied', async () => {
    const draft = makeConsentedDraft('submit');
    await expect(submitDraft(draft, DENIED_PERMISSION)).rejects.toThrow(/permission/i);
  });

  it('throws when permission is error', async () => {
    const draft = makeConsentedDraft('submit');
    await expect(submitDraft(draft, ERROR_PERMISSION)).rejects.toThrow(/verified/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SERVICE — submit (offline / queued path)
// ═════════════════════════════════════════════════════════════════════════════

describe('submitDraft — offline / queued', () => {
  it('queues via syncEngine when device is offline (permission=offline)', async () => {
    const draft = makeConsentedDraft('submit');

    const result = await submitDraft(draft, OFFLINE_PERMISSION);

    expect(result.queued).toBe(true);
    expect(mockMarkDirty).toHaveBeenCalledWith(
      'lostPetReport',
      draft.id,
      'create',
      expect.objectContaining({ reportId: draft.id }),
    );
    expect(result.message).toMatch(/reconnect/i);
  });

  it('queues via syncEngine when online submit POST fails', async () => {
    const draft = makeConsentedDraft('submit');
    mockApiPost.mockRejectedValueOnce(new Error('Network unreachable'));

    const result = await submitDraft(draft, GRANTED_PERMISSION);

    expect(result.queued).toBe(true);
    expect(mockMarkDirty).toHaveBeenCalledTimes(1);
  });

  it('does not duplicate: calling submit twice enqueues the same dirty_record key', async () => {
    const draft = makeConsentedDraft('submit');
    mockApiPost.mockRejectedValue(new Error('offline'));

    await submitDraft(draft, GRANTED_PERMISSION);
    // Reset and call again — syncEngine.markDirty uses INSERT OR REPLACE,
    // so the same draft.id produces the same key. We verify it's called with
    // identical arguments both times (no new id generated).
    const firstCall = mockMarkDirty.mock.calls[0];

    mockMarkDirty.mockClear();
    await submitDraft(draft, GRANTED_PERMISSION);
    const secondCall = mockMarkDirty.mock.calls[0];

    expect(firstCall[1]).toBe(secondCall[1]); // same entityId = draft.id
  });

  it('marks draft status as submitted even when queued', async () => {
    const draft = makeConsentedDraft('submit');
    mockApiPost.mockRejectedValueOnce(new Error('offline'));

    await submitDraft(draft, GRANTED_PERMISSION);

    const lastWrite = JSON.parse(mockSetItem.mock.calls.at(-1)![1]) as LostPetReportDraft;
    expect(lastWrite.status).toBe('submitted');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SERVICE — share payload / privacy
// ═════════════════════════════════════════════════════════════════════════════

describe('buildSharePayloadChecked — privacy', () => {
  it('excludes ownerContact and sensitivePetData by default', async () => {
    const draft = makeConsentedDraft('both');
    const payload = await buildSharePayloadChecked(draft, GRANTED_PERMISSION);

    expect(payload.ownerContact).toBeUndefined();
    expect(payload.sensitivePetData).toBeUndefined();
  });

  it('includes only approximate location (never exact coords) unless provided', async () => {
    const draft = makeConsentedDraft('both');
    const payload = await buildSharePayloadChecked(draft, GRANTED_PERMISSION);

    // roundedLat/Lng only appear if explicitly set — they are optional
    expect(payload.approximateLocation.text).toBeTruthy();
  });

  it('payload contains reportId, petId, lastSeenAt, approximateLocation, distinguishingDetails', async () => {
    const draft = makeConsentedDraft('both');
    const payload = await buildSharePayloadChecked(draft, GRANTED_PERMISSION);

    expect(payload.reportId).toBe(draft.id);
    expect(payload.petId).toBe(PET_ID);
    expect(payload.lastSeenAt).toBe(draft.lastSeenAt);
    expect(payload.approximateLocation.text).toBe(draft.approximateLocation.text);
    expect(payload.distinguishingDetails).toBe(draft.distinguishingDetails);
  });

  it('throws when share consent is missing', async () => {
    const draft = makeConsentedDraft('submit'); // only submit, not share
    await expect(buildSharePayloadChecked(draft, GRANTED_PERMISSION)).rejects.toThrow(/consent/i);
  });

  it('throws when permission is denied', async () => {
    const draft = makeConsentedDraft('both');
    await expect(buildSharePayloadChecked(draft, DENIED_PERMISSION)).rejects.toThrow(/permission/i);
  });

  it('throws when permission is error', async () => {
    const draft = makeConsentedDraft('both');
    await expect(buildSharePayloadChecked(draft, ERROR_PERMISSION)).rejects.toThrow(/verified/i);
  });

  it('offline permission does NOT block share (draft saved locally, share is user-initiated)', async () => {
    const draft = makeConsentedDraft('both');
    // offline permission should still allow share (same as submit-offline path)
    const payload = await buildSharePayloadChecked(draft, OFFLINE_PERMISSION);
    expect(payload.reportId).toBe(draft.id);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// MODEL — buildSharePayload (unit, no service layer)
// ═════════════════════════════════════════════════════════════════════════════

describe('buildSharePayload (model-level unit)', () => {
  it('never includes ownerContact unless opted in', () => {
    const draft = makeConsentedDraft('share');
    expect(buildSharePayload(draft).ownerContact).toBeUndefined();
    expect(buildSharePayload(draft, { includeOwnerContact: false }).ownerContact).toBeUndefined();
  });

  it('never includes sensitivePetData unless opted in', () => {
    const draft = makeConsentedDraft('share');
    expect(buildSharePayload(draft).sensitivePetData).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SERVICE — permission denied blocks submit end-to-end
// ═════════════════════════════════════════════════════════════════════════════

describe('permission denied / stale — end-to-end', () => {
  it('denied permission keeps the draft but blocks submit', async () => {
    const draft = makeConsentedDraft('submit');
    await expect(submitDraft(draft, DENIED_PERMISSION)).rejects.toThrow();
    // Draft was never removed — it stays for the owner to re-try
    expect(mockRemoveItem).not.toHaveBeenCalled();
  });

  it('offline permission keeps draft and queues when submit attempted', async () => {
    const draft = makeConsentedDraft('submit');
    const result = await submitDraft(draft, OFFLINE_PERMISSION);
    expect(result.queued).toBe(true);
    expect(mockMarkDirty).toHaveBeenCalledTimes(1);
  });

  it('after re-check online, granted permission allows submit', async () => {
    mockApiGet.mockResolvedValueOnce({ data: { canReport: true } });
    const fresh = await checkReportPermission(PET_ID);
    expect(fresh.status).toBe('granted');

    const draft = makeConsentedDraft('submit');
    mockApiPost.mockResolvedValueOnce({ data: { data: { id: 'r2' } } });
    const result = await submitDraft(draft, fresh);
    expect(result.queued).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SyncEntityType extension
// ═════════════════════════════════════════════════════════════════════════════

describe('syncEngine integration', () => {
  it('markDirty is called with entity type "lostPetReport"', async () => {
    const draft = makeConsentedDraft('submit');
    mockApiPost.mockRejectedValueOnce(new Error('offline'));

    await submitDraft(draft, GRANTED_PERMISSION);

    expect(mockMarkDirty).toHaveBeenCalledWith(
      'lostPetReport',
      expect.any(String),
      'create',
      expect.any(Object),
    );
  });
});
