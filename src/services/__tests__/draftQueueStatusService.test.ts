/**
 * Offline draft queue status tests — Issue #1181
 */

const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItem: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
}));

import {
  clearCompletedDrafts,
  describeDraft,
  enqueueDraft,
  getDraftQueueByFeature,
  recordSyncResult,
  resolveConflict,
} from '../draftQueueStatusService';

beforeEach(() => mockStore.clear());

describe('draftQueueStatusService', () => {
  it('groups drafts by feature with status counts and timestamps', async () => {
    await enqueueDraft('a', 'Notes', 1000);
    await enqueueDraft('b', 'Notes', 2000);
    await enqueueDraft('c', 'Vaccines', 3000);
    await recordSyncResult('a', 'success', 5000);
    await recordSyncResult('b', 'failed', 6000);

    const groups = await getDraftQueueByFeature();
    expect(groups.map((g) => g.feature)).toEqual(['Notes', 'Vaccines']);
    expect(groups[0].counts).toEqual({ pending: 0, retrying: 1, blocked: 0, completed: 1 });
    expect(groups[0].drafts[0]).toMatchObject({
      id: 'b',
      status: 'retrying',
      updatedAt: 6000,
      attempts: 1,
    });
  });

  it('blocks on conflict or revoked access and requires explicit action', async () => {
    await enqueueDraft('a', 'Notes', 0);
    await enqueueDraft('b', 'Notes', 0);
    await recordSyncResult('a', { httpStatus: 409 }, 10);
    await recordSyncResult('b', { httpStatus: 403 }, 10);
    const [group] = await getDraftQueueByFeature();
    expect(group.counts.blocked).toBe(2);

    expect(await resolveConflict('b', 'keep_mine')).toBeNull();
    expect(await resolveConflict('a', 'keep_mine', 20)).toMatchObject({ status: 'pending' });
    await recordSyncResult('a', { httpStatus: 409 }, 30);
    await resolveConflict('a', 'discard', 40);
    const [after] = await getDraftQueueByFeature();
    expect(after.drafts.map((d) => d.id)).toEqual(['b']);
  });

  it('clears completed drafts and describes rows for screen readers', async () => {
    await enqueueDraft('a', 'Notes', 0);
    await recordSyncResult('a', 'success', 0);
    expect(await recordSyncResult('missing', 'success')).toBeNull();
    await clearCompletedDrafts();
    expect(await getDraftQueueByFeature()).toEqual([]);

    expect(
      describeDraft(
        {
          id: 'x',
          feature: 'Notes',
          status: 'blocked',
          blockedReason: 'conflict',
          createdAt: 0,
          updatedAt: 0,
          attempts: 1,
        },
        60000,
      ),
    ).toBe('Notes draft blocked, conflict needs your decision, updated 1 minute ago');
  });

  it('tolerates corrupt storage', async () => {
    mockStore.set('draftQueueStatus:v1', '{bad');
    expect(await getDraftQueueByFeature()).toEqual([]);
  });
});
