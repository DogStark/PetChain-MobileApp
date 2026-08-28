import {
  NoteConcurrencyError,
  appendAmendment,
  assertUpdatable,
  buildAmendment,
  detectConflicts,
  type SoapBody,
  type VersionedNote,
} from '../clinicalNoteConcurrency';

const base: SoapBody = {
  subjective: 'Owner reports limping',
  objective: 'Left hind favouring',
  assessment: 'Soft-tissue strain',
  plan: 'Rest 5 days',
};

const server = (over: Partial<VersionedNote> = {}): VersionedNote => ({
  id: 'note-1',
  version: 1,
  updatedAt: '2026-08-26T10:00:00Z',
  updatedBy: 'vet-a',
  ...base,
  ...over,
});

describe('clinicalNoteConcurrency (issue #967)', () => {
  it('characterizes the bug: without a version check a stale write would overwrite newer text', () => {
    // Clinician B started from v1, server is now v2 with a different assessment.
    const latest = server({ version: 2, assessment: 'Suspected fracture', updatedBy: 'vet-a' });
    const mine: SoapBody = { ...base, assessment: 'Just a sprain' };
    const conflicts = detectConflicts(base, mine, latest);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ field: 'assessment', theirs: 'Suspected fracture' });
  });

  it('assertUpdatable passes when the server has not advanced', () => {
    expect(() => assertUpdatable(1, server({ version: 1 }), { ...base }, base)).not.toThrow();
  });

  it('assertUpdatable passes for non-overlapping edits on a newer version', () => {
    const latest = server({ version: 2, objective: 'Left hind non-weight-bearing' });
    const mine: SoapBody = { ...base, plan: 'Rest 10 days, NSAIDs' };
    expect(() => assertUpdatable(1, latest, mine, base)).not.toThrow();
  });

  it('assertUpdatable throws NoteConcurrencyError on a genuine collision', () => {
    const latest = server({ version: 3, plan: 'Refer to surgery' });
    const mine: SoapBody = { ...base, plan: 'Rest 10 days' };
    try {
      assertUpdatable(1, latest, mine, base);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(NoteConcurrencyError);
      const e = err as NoteConcurrencyError;
      expect(e.code).toBe('VERSION_CONFLICT');
      expect(e.serverVersion).toBe(3);
      expect(e.conflicts[0].field).toBe('plan');
    }
  });

  it('buildAmendment keeps an immutable pre-change snapshot and bumps the version', () => {
    const prev = server({ version: 4 });
    const amendment = buildAmendment(prev, { ...base, plan: 'Rest 7 days' }, 'vet-b');
    expect(amendment.version).toBe(5);
    expect(amendment.baseVersion).toBe(4);
    expect(amendment.previous.plan).toBe('Rest 5 days');
    expect(() => {
      // @ts-expect-error frozen
      amendment.previous.plan = 'tampered';
    }).toThrow();
  });

  it('appendAmendment never mutates earlier history', () => {
    const prev = server({ version: 1 });
    const a1 = buildAmendment(prev, { ...base, plan: 'p2' }, 'vet-b');
    const history = appendAmendment([], a1);
    const a2 = buildAmendment({ ...prev, version: 2, plan: 'p2' }, { ...base, plan: 'p3' }, 'vet-c');
    const next = appendAmendment(history, a2);
    expect(history).toHaveLength(1);
    expect(next).toHaveLength(2);
    expect(() => {
      // @ts-expect-error frozen
      next.push(a1);
    }).toThrow();
  });
});
