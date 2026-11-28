/**
 * Sync retry service tests — Issue #1178
 *
 * Focuses on the privacy guarantee (no payload leaves the service), the
 * sanitisation of error text, retry snapshot handling, and each server outcome
 * exposed by the retry detail view.
 */

jest.mock('../syncEngine', () => ({
  __esModule: true,
  default: {
    listRetryRecords: jest.fn(),
    getRetryLimit: jest.fn(),
    retryRecord: jest.fn(),
  },
}));

jest.mock('../../utils/networkMonitor', () => ({
  networkMonitor: {
    isOnline: jest.fn(),
  },
}));

import syncEngine from '../syncEngine';
import { networkMonitor } from '../../utils/networkMonitor';
import {
  formatRecordReference,
  loadSyncRetryDetails,
  retrySyncDetail,
  sanitizeSyncErrorMessage,
  type SyncRetryDetail,
} from '../syncRetryService';

const engine = syncEngine as unknown as {
  listRetryRecords: jest.Mock;
  getRetryLimit: jest.Mock;
  retryRecord: jest.Mock;
};
const monitor = networkMonitor as unknown as { isOnline: jest.Mock };

const baseRecord = {
  id: 'pet:pet_1234567890',
  entityType: 'pet' as const,
  entityId: 'pet_1234567890',
  action: 'update' as const,
  updatedAt: '2026-10-22T06:00:00.000Z',
  syncVersion: 3,
  attempts: 2,
  lastError: 'Request failed with status code 503',
};

const baseDetail: SyncRetryDetail = {
  recordId: baseRecord.id,
  entityType: 'pet',
  recordReference: 'pet_12…7890',
  action: 'update',
  retryCount: 2,
  maxRetries: 5,
  exhausted: false,
  lastError: baseRecord.lastError,
  hasErrorDetail: true,
  queuedAt: baseRecord.updatedAt,
  syncVersion: 3,
};

beforeEach(() => {
  jest.clearAllMocks();
  engine.getRetryLimit.mockReturnValue(5);
  engine.listRetryRecords.mockResolvedValue([baseRecord]);
  monitor.isOnline.mockResolvedValue(true);
});

describe('sanitizeSyncErrorMessage', () => {
  it('never echoes JSON payload contents', () => {
    const message = sanitizeSyncErrorMessage(
      'Server rejected {"petName":"Milo","notes":"seizure at 3am"}',
    );

    expect(message).not.toContain('Milo');
    expect(message).not.toContain('seizure');
    expect(message).toContain('[details hidden]');
  });

  it('collapses control characters and bounds the message length', () => {
    const message = sanitizeSyncErrorMessage(`line one\n\tline two ${'x'.repeat(400)}`);

    expect(message).not.toMatch(/[\n\t]/);
    expect(message.length).toBe(180);
    expect(message.endsWith('…')).toBe(true);
  });

  it('falls back when no error detail was recorded', () => {
    expect(sanitizeSyncErrorMessage(null)).toBe('No error details were recorded.');
    expect(sanitizeSyncErrorMessage('   ')).toBe('No error details were recorded.');
  });
});

describe('formatRecordReference', () => {
  it('shortens long ids but keeps short ids and empty ids readable', () => {
    expect(formatRecordReference('pet_1234567890')).toBe('pet_12…7890');
    expect(formatRecordReference('pet-1')).toBe('pet-1');
    expect(formatRecordReference('')).toBe('Unknown record');
  });
});

describe('loadSyncRetryDetails', () => {
  it('returns only retry metadata and reports offline state', async () => {
    monitor.isOnline.mockResolvedValue(false);
    // A payload on the raw record must never reach the view model.
    engine.listRetryRecords.mockResolvedValue([
      { ...baseRecord, payload: { name: 'Milo', notes: 'private medical content' } },
    ]);

    const result = await loadSyncRetryDetails();

    expect(result.isOffline).toBe(true);
    expect(result.details).toHaveLength(1);
    expect(result.details[0]).toMatchObject({
      recordId: baseRecord.id,
      entityType: 'pet',
      action: 'update',
      retryCount: 2,
      maxRetries: 5,
      exhausted: false,
      lastError: baseRecord.lastError,
      hasErrorDetail: true,
      recordReference: 'pet_12…7890',
    });
    expect('payload' in result.details[0]).toBe(false);
    expect(JSON.stringify(result.details)).not.toContain('Milo');
    expect(JSON.stringify(result.details)).not.toContain('private medical content');
  });

  it('narrows to a single queue record and flags the exhausted boundary', async () => {
    engine.listRetryRecords.mockResolvedValue([
      { ...baseRecord, id: 'pet:pet_1', entityId: 'pet_1', attempts: 5 },
      { ...baseRecord, id: 'medication:med_1', entityType: 'medication', entityId: 'med_1' },
    ]);

    const result = await loadSyncRetryDetails('pet:pet_1');

    expect(result.details).toHaveLength(1);
    expect(result.details[0].exhausted).toBe(true);
    expect(result.details[0].retryCount).toBe(5);
  });
});

describe('retrySyncDetail', () => {
  it('passes the viewed snapshot so a changed record is refused as stale', async () => {
    engine.retryRecord.mockResolvedValue({ type: 'stale', current: baseRecord });

    const result = await retrySyncDetail(baseDetail);

    expect(result.outcome).toBe('stale');
    expect(engine.retryRecord).toHaveBeenCalledWith(baseRecord.id, {
      attempts: baseDetail.retryCount,
      syncVersion: baseDetail.syncVersion,
    });
  });

  it('maps a server denial without exposing the raw response', async () => {
    engine.retryRecord.mockResolvedValue({
      type: 'permission-denied',
      current: baseRecord,
      message: 'Request failed with status code 403',
    });

    const result = await retrySyncDetail(baseDetail);

    expect(result).toEqual({
      outcome: 'permission-denied',
      message: 'The server denied permission to retry this change.',
    });
  });

  it('maps offline and failed outcomes, sanitising the failure message', async () => {
    engine.retryRecord.mockResolvedValueOnce({ type: 'offline' });
    expect(await retrySyncDetail(baseDetail)).toEqual({ outcome: 'offline' });

    engine.retryRecord.mockResolvedValueOnce({
      type: 'failed',
      current: baseRecord,
      message: 'Server rejected {"name":"Milo"}',
    });
    const failed = await retrySyncDetail(baseDetail);

    if (failed.outcome !== 'failed') throw new Error('expected a failed retry outcome');
    expect(failed.message).not.toContain('Milo');
    expect(failed.message).toContain('[details hidden]');
  });

  it('maps a completed retry', async () => {
    engine.retryRecord.mockResolvedValue({ type: 'completed' });
    await expect(retrySyncDetail(baseDetail)).resolves.toEqual({ outcome: 'completed' });
  });
});
