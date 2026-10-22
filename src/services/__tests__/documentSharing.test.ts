import {
  ExportExpiredError,
  STEP_UP_MAX_AGE_MS,
  StepUpRequiredError,
  assertExportUsable,
  buildShareAuditEntry,
  buildWatermark,
  createExportGrant,
  isExportExpired,
} from '../documentSharing';

const T0 = Date.parse('2026-08-26T12:00:00Z');
const freshStepUp = { method: 'biometric' as const, confirmedAt: T0 - 1_000 };

describe('documentSharing (issue #965)', () => {
  it('characterizes the bug: sharing without a fresh step-up is refused', () => {
    expect(() =>
      createExportGrant({ documentId: 'doc-1', actorId: 'user-1', stepUp: undefined as never, now: T0 }),
    ).toThrow(StepUpRequiredError);

    const stale = { method: 'passcode' as const, confirmedAt: T0 - STEP_UP_MAX_AGE_MS - 1 };
    expect(() =>
      createExportGrant({ documentId: 'doc-1', actorId: 'user-1', stepUp: stale, now: T0 }),
    ).toThrow(StepUpRequiredError);
  });

  it('mints an expiring grant with a watermark when step-up is fresh', () => {
    const grant = createExportGrant({
      documentId: 'doc-1',
      actorId: 'user-1',
      stepUp: freshStepUp,
      now: T0,
      ttlMs: 60_000,
      generateToken: () => 'tok-abc',
    });
    expect(grant).toMatchObject({ documentId: 'doc-1', token: 'tok-abc', expiresAt: T0 + 60_000 });
    expect(grant.watermark).toContain('user-1');
    expect(grant.watermark).not.toContain('tok-abc');
  });

  it('expires the grant after its TTL', () => {
    const grant = createExportGrant({
      documentId: 'doc-1',
      actorId: 'user-1',
      stepUp: freshStepUp,
      now: T0,
      ttlMs: 1_000,
      generateToken: () => 'tok-abc',
    });
    expect(isExportExpired(grant, T0 + 500)).toBe(false);
    expect(isExportExpired(grant, T0 + 1_000)).toBe(true);
    expect(() => assertExportUsable(grant, T0 + 2_000)).toThrow(ExportExpiredError);
  });

  it('audit entry carries no raw token and no document contents', () => {
    const grant = createExportGrant({
      documentId: 'doc-1',
      actorId: 'user-1',
      stepUp: freshStepUp,
      now: T0,
      generateToken: () => 'super-secret-token',
    });
    const entry = buildShareAuditEntry(grant, 'biometric');
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain('super-secret-token');
    expect(entry.tokenFingerprint).toMatch(/^[0-9a-f]+$/);
    expect(entry.event).toBe('document.shared');
  });

  it('watermark is deterministic and PHI-free', () => {
    expect(buildWatermark('user-1', T0)).toBe(
      'PetChain • shared by user-1 • 2026-08-26 12:00 UTC • confidential',
    );
  });
});
