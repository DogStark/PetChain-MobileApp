/**
 * Telemedicine consent tests  (Issue #969)
 *
 * The old flow posted an empty body to `/consent` and only did so when the
 * user tapped "I Consent". A decline was therefore indistinguishable from a
 * user who never answered, and the backend could not tell *who* had consented
 * or to *what wording*.
 */

jest.mock('../../utils/errorLogger', () => ({ logError: jest.fn() }));

const mockApiPost = jest.fn();
jest.mock('../apiClient', () => ({
  __esModule: true,
  default: { post: (...args: unknown[]) => mockApiPost(...args) },
}));

import {
  CONSENT_POLICY_VERSION,
  __resetConsentsForTest,
  clearConsents,
  getConsent,
  hasCurrentConsent,
  recordConsent,
} from '../consultationConsentService';

const BASE = {
  consultationId: 'consult-1',
  participantId: 'user-1',
  participantRole: 'OWNER' as const,
};

beforeEach(() => {
  jest.clearAllMocks();
  __resetConsentsForTest();
  mockApiPost.mockResolvedValue({ data: {} });
});

// ─── Attribution and versioning ──────────────────────────────────────────────

describe('recording a decision', () => {
  it('reports who consented, to what, and under which policy version', async () => {
    await recordConsent({ ...BASE, scope: 'recording', decision: 'granted' });

    expect(mockApiPost).toHaveBeenCalledTimes(1);
    const [url, body] = mockApiPost.mock.calls[0];
    expect(url).toBe('/consultations/consult-1/consent');
    expect(body).toMatchObject({
      participantId: 'user-1',
      participantRole: 'OWNER',
      scope: 'recording',
      decision: 'granted',
      policyVersion: CONSENT_POLICY_VERSION,
    });
    expect(typeof body.recordedAt).toBe('string');
    expect(Number.isNaN(Date.parse(body.recordedAt))).toBe(false);
  });

  it('records a denial as explicitly as a grant', async () => {
    await recordConsent({ ...BASE, scope: 'recording', decision: 'denied' });

    expect(mockApiPost).toHaveBeenCalledTimes(1);
    expect(mockApiPost.mock.calls[0][1]).toMatchObject({ decision: 'denied' });
    expect(getConsent(BASE.consultationId, BASE.participantId, 'recording')?.decision).toBe(
      'denied',
    );
  });

  it('escapes the consultation id in the URL', async () => {
    await recordConsent({
      ...BASE,
      consultationId: 'a/b?c',
      scope: 'camera',
      decision: 'granted',
    });

    expect(mockApiPost.mock.calls[0][0]).toBe('/consultations/a%2Fb%3Fc/consent');
  });

  it('keeps the decision locally even when the backend call fails', async () => {
    mockApiPost.mockRejectedValue(new Error('offline'));

    await expect(
      recordConsent({ ...BASE, scope: 'recording', decision: 'denied' }),
    ).resolves.toMatchObject({ decision: 'denied' });

    // A network failure must not make a denial look like "never asked" — that
    // would re-prompt the user, or worse, be read as permission.
    expect(hasCurrentConsent(BASE.consultationId, BASE.participantId, 'recording')).toBe(false);
    expect(getConsent(BASE.consultationId, BASE.participantId, 'recording')).toBeDefined();
  });
});

// ─── Per-scope isolation ─────────────────────────────────────────────────────

describe('scopes are independent', () => {
  it('does not treat camera consent as recording consent', async () => {
    await recordConsent({ ...BASE, scope: 'camera', decision: 'granted' });

    expect(hasCurrentConsent(BASE.consultationId, BASE.participantId, 'camera')).toBe(true);
    expect(hasCurrentConsent(BASE.consultationId, BASE.participantId, 'recording')).toBe(false);
    expect(hasCurrentConsent(BASE.consultationId, BASE.participantId, 'screen_share')).toBe(false);
  });

  it('keeps participants separate', async () => {
    await recordConsent({ ...BASE, scope: 'recording', decision: 'granted' });

    expect(hasCurrentConsent(BASE.consultationId, 'someone-else', 'recording')).toBe(false);
  });

  it('keeps consultations separate', async () => {
    await recordConsent({ ...BASE, scope: 'recording', decision: 'granted' });

    expect(hasCurrentConsent('another-consult', BASE.participantId, 'recording')).toBe(false);
  });
});

// ─── Version invalidation ────────────────────────────────────────────────────

describe('policy versioning', () => {
  it('treats consent under superseded wording as not given', async () => {
    await recordConsent({ ...BASE, scope: 'recording', decision: 'granted' });
    expect(hasCurrentConsent(BASE.consultationId, BASE.participantId, 'recording')).toBe(true);

    // Simulate the wording changing after the fact.
    const record = getConsent(BASE.consultationId, BASE.participantId, 'recording')!;
    record.policyVersion = 'older.version';

    expect(hasCurrentConsent(BASE.consultationId, BASE.participantId, 'recording')).toBe(false);
  });

  it('exposes a non-empty policy version', () => {
    expect(CONSENT_POLICY_VERSION).toEqual(expect.any(String));
    expect(CONSENT_POLICY_VERSION.length).toBeGreaterThan(0);
  });
});

// ─── Unanswered state ────────────────────────────────────────────────────────

describe('unanswered prompts', () => {
  it('reports no consent before the participant answers', () => {
    expect(getConsent(BASE.consultationId, BASE.participantId, 'recording')).toBeUndefined();
    expect(hasCurrentConsent(BASE.consultationId, BASE.participantId, 'recording')).toBe(false);
  });

  it('clears decisions when the consultation ends, so the next call re-asks', async () => {
    await recordConsent({ ...BASE, scope: 'recording', decision: 'granted' });
    await recordConsent({
      consultationId: 'other',
      participantId: 'user-1',
      participantRole: 'OWNER',
      scope: 'recording',
      decision: 'granted',
    });

    clearConsents(BASE.consultationId);

    expect(hasCurrentConsent(BASE.consultationId, BASE.participantId, 'recording')).toBe(false);
    // An unrelated consultation is untouched.
    expect(hasCurrentConsent('other', 'user-1', 'recording')).toBe(true);
  });

  it('overwrites an earlier decision when the participant changes their mind', async () => {
    await recordConsent({ ...BASE, scope: 'recording', decision: 'granted' });
    await recordConsent({ ...BASE, scope: 'recording', decision: 'denied' });

    expect(hasCurrentConsent(BASE.consultationId, BASE.participantId, 'recording')).toBe(false);
    // Both decisions reached the backend — the audit trail keeps the sequence.
    expect(mockApiPost).toHaveBeenCalledTimes(2);
  });
});
