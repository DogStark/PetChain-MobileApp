/**
 * #958 — dose logging must be idempotent across offline-queue replay and
 * notification actions. Characterises the old duplicate behaviour, then locks
 * in the conflict-safe path.
 */

// In-memory stand-in for the encrypted SQLite dose-log store.
const store: any[] = [];

jest.mock('../localDB', () => ({
  getAllMedications: jest.fn(async () => []),
  upsertMedication: jest.fn(async () => {}),
  deleteMedicationById: jest.fn(async () => {}),
  getDoseLogs: jest.fn(async () => [...store]),
  addDoseLog: jest.fn(async (log: any) => {
    const idx = store.findIndex((l) => l.id === log.id);
    if (idx >= 0) store[idx] = log;
    else store.push(log);
  }),
}));

import {
  scheduledDoseId,
  isDoseAlreadyLogged,
  logDose,
  logDoseIdempotent,
  getDoseLogs,
  type DoseLog,
} from '../medicationService';

const SCHEDULED_FOR = '2026-03-01T08:00:00.000Z';

const baseLog = (overrides: Partial<DoseLog> = {}): DoseLog => ({
  id: `log-${Math.random().toString(36).slice(2)}`,
  medicationId: 'med-1',
  takenAt: '2026-03-01T08:03:12.000Z',
  scheduledFor: SCHEDULED_FOR,
  ...overrides,
});

beforeEach(() => {
  store.length = 0;
  jest.clearAllMocks();
});

describe('scheduledDoseId', () => {
  it('is stable for the same medication + scheduled instant', () => {
    expect(scheduledDoseId('med-1', SCHEDULED_FOR)).toBe(
      scheduledDoseId('med-1', new Date(SCHEDULED_FOR)),
    );
  });

  it('ignores sub-minute clock skew between entry points', () => {
    expect(scheduledDoseId('med-1', '2026-03-01T08:00:05.000Z')).toBe(
      scheduledDoseId('med-1', '2026-03-01T08:00:59.999Z'),
    );
  });

  it('differs by medication and by dose time', () => {
    expect(scheduledDoseId('med-1', SCHEDULED_FOR)).not.toBe(
      scheduledDoseId('med-2', SCHEDULED_FOR),
    );
    expect(scheduledDoseId('med-1', SCHEDULED_FOR)).not.toBe(
      scheduledDoseId('med-1', '2026-03-01T20:00:00.000Z'),
    );
  });

  it('throws on an invalid timestamp', () => {
    expect(() => scheduledDoseId('med-1', 'not-a-date')).toThrow();
  });
});

describe('current behaviour: plain logDose double-counts', () => {
  it('writes two records when the same dose is marked from two entry points', async () => {
    await logDose(baseLog({ id: 'from-notification' }));
    await logDose(baseLog({ id: 'from-offline-replay' }));
    expect(await getDoseLogs()).toHaveLength(2);
  });
});

describe('logDoseIdempotent', () => {
  it('writes the dose once and reports later attempts as duplicates', async () => {
    const first = await logDoseIdempotent(baseLog({ id: 'from-notification' }));
    expect(first.duplicate).toBe(false);

    const replay = await logDoseIdempotent(baseLog({ id: 'from-offline-replay' }));
    expect(replay.duplicate).toBe(true);
    expect(replay.log.id).toBe('from-notification'); // authoritative record

    expect(await getDoseLogs()).toHaveLength(1);
  });

  it('stamps a stable scheduledDoseId on the stored log', async () => {
    const { log } = await logDoseIdempotent(baseLog());
    expect(log.scheduledDoseId).toBe(scheduledDoseId('med-1', SCHEDULED_FOR));
  });

  it('dedupes even when only takenAt is available (no scheduledFor)', async () => {
    await logDoseIdempotent(baseLog({ id: 'a', scheduledFor: undefined, takenAt: '2026-03-01T08:00:10.000Z' }));
    const dup = await logDoseIdempotent(
      baseLog({ id: 'b', scheduledFor: undefined, takenAt: '2026-03-01T08:00:40.000Z' }),
    );
    expect(dup.duplicate).toBe(true);
    expect(await getDoseLogs()).toHaveLength(1);
  });

  it('still records genuinely different doses', async () => {
    await logDoseIdempotent(baseLog({ id: 'morning' }));
    const evening = await logDoseIdempotent(
      baseLog({ id: 'evening', scheduledFor: '2026-03-01T20:00:00.000Z' }),
    );
    expect(evening.duplicate).toBe(false);
    expect(await getDoseLogs()).toHaveLength(2);
  });
});

describe('isDoseAlreadyLogged', () => {
  it('matches on scheduled-dose identity across differing log ids', () => {
    const existing = [baseLog({ id: 'x', scheduledDoseId: scheduledDoseId('med-1', SCHEDULED_FOR) })];
    expect(isDoseAlreadyLogged(baseLog({ id: 'y' }), existing)).toBe(true);
    expect(isDoseAlreadyLogged(baseLog({ id: 'z', medicationId: 'med-2' }), existing)).toBe(false);
  });
});
