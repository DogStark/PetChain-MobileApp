/**
 * Selective attachment download controls tests — Issue #1180
 */

const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItem: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
}));
jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///docs/',
  makeDirectoryAsync: jest.fn(async () => undefined),
  downloadAsync: jest.fn(async () => ({ status: 200 })),
  deleteAsync: jest.fn(async () => undefined),
}));
jest.mock('../api', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../../utils/networkMonitor', () => ({ networkMonitor: { isOnline: jest.fn() } }));

import * as FileSystem from 'expo-file-system';
import api from '../api';
import { networkMonitor } from '../../utils/networkMonitor';
import {
  describeOfflineAttachment,
  estimateStorage,
  getOfflineAttachments,
  keepAttachmentOffline,
  pruneOfflineAttachments,
  removeOfflineAttachment,
} from '../offlineAttachmentService';

const mockApi = api as unknown as { get: jest.Mock };
const online = networkMonitor.isOnline as jest.Mock;
const fs = FileSystem as unknown as { downloadAsync: jest.Mock; deleteAsync: jest.Mock };
const DAY = 24 * 60 * 60 * 1000;
const att = { id: 'att1', url: 'https://petchain.app/a', sizeBytes: 2048 };

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
  online.mockResolvedValue(true);
  mockApi.get.mockResolvedValue({ data: { canView: true } });
});

describe('offlineAttachmentService', () => {
  it('estimates storage for selected attachments', () => {
    expect(estimateStorage([{ sizeBytes: 1024 }, { sizeBytes: 1024 * 1024 }])).toEqual({
      totalBytes: 1049600,
      label: '1.0 MB',
    });
    expect(estimateStorage([]).label).toBe('0 B');
  });

  it('saves a selected attachment with expiry after server confirms access', async () => {
    const result = await keepAttachmentOffline('r1', att, 7 * DAY, 0);
    expect(result).toMatchObject({
      status: 'saved',
      item: { expiresAt: 7 * DAY, sizeBytes: 2048 },
    });
    expect(await getOfflineAttachments()).toHaveLength(1);
    if (result.status === 'saved') {
      expect(describeOfflineAttachment(result.item, 6 * DAY)).toBe(
        'Saved offline, 2.0 KB, expires in 1 day',
      );
    }
  });

  it('refuses to download when denied, offline, or on failure', async () => {
    mockApi.get.mockRejectedValue({ response: { status: 403 } });
    expect(await keepAttachmentOffline('r1', att)).toEqual({ status: 'denied' });
    online.mockResolvedValue(false);
    expect(await keepAttachmentOffline('r1', att)).toEqual({ status: 'offline' });
    online.mockResolvedValue(true);
    mockApi.get.mockResolvedValue({ data: { canView: true } });
    fs.downloadAsync.mockRejectedValueOnce(new Error('net'));
    expect(await keepAttachmentOffline('r1', att)).toEqual({ status: 'error' });
    expect(fs.downloadAsync).toHaveBeenCalledTimes(1);
    expect(await getOfflineAttachments()).toEqual([]);
  });

  it('removes cached files when access is revoked or the copy expires', async () => {
    await keepAttachmentOffline('r1', att, DAY, 0);
    await keepAttachmentOffline('r2', { ...att, id: 'att2' }, 10 * DAY, 0);
    await keepAttachmentOffline('r3', { ...att, id: 'att3' }, 10 * DAY, 0);
    mockApi.get.mockImplementation(async (url: string) => {
      if (url.includes('r2')) throw { response: { status: 403 } };
      return { data: { canView: true } };
    });

    expect(await pruneOfflineAttachments(2 * DAY)).toEqual(['att1', 'att2']);
    expect(fs.deleteAsync).toHaveBeenCalledTimes(2);
    expect((await getOfflineAttachments()).map((a) => a.attachmentId)).toEqual(['att3']);
  });

  it('keeps unexpired copies offline and supports manual removal', async () => {
    await keepAttachmentOffline('r1', att, DAY, 0);
    online.mockResolvedValue(false);
    expect(await pruneOfflineAttachments(DAY / 2)).toEqual([]);
    await removeOfflineAttachment('att1');
    expect(fs.deleteAsync).toHaveBeenCalledWith(expect.stringContaining('att1'), {
      idempotent: true,
    });
    expect(await getOfflineAttachments()).toEqual([]);
  });
});
