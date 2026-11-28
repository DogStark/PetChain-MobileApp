jest.mock('expo-file-system', () => ({
  cacheDirectory: '/mock/cache/',
  EncodingType: { UTF8: 'utf8' },
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  shareAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../apiClient', () => ({
  resilientRequest: jest.fn(),
}));

jest.mock('../localDB', () => ({
  getAllSoapDrafts: jest.fn(),
  queryAll: jest.fn(),
}));

jest.mock('../syncEngine', () => ({
  __esModule: true,
  default: { initialize: jest.fn().mockResolvedValue(undefined) },
}));

import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { resilientRequest } from '../apiClient';
import { getAllSoapDrafts, queryAll } from '../localDB';
import {
  exportLocalDrafts,
  getLocalDraftExportPermission,
  getLocalDraftSummary,
  LocalDraftExportError,
  validateDraftExportPassphrase,
} from '../localDraftExportService';

const mockRequest = resilientRequest as jest.MockedFunction<typeof resilientRequest>;
const mockGetDrafts = getAllSoapDrafts as jest.MockedFunction<typeof getAllSoapDrafts>;
const mockQueryAll = queryAll as jest.MockedFunction<typeof queryAll>;

const draft = {
  petId: 'pet-1',
  vetId: 'vet-1',
  subjective: 'private note',
  objective: '',
  assessment: '',
  plan: '',
  savedAt: '2026-10-22T09:00:00.000Z',
};

const pendingChange = {
  id: 'pet:pet-1',
  entity_type: 'pet',
  entity_id: 'pet-1',
  action: 'update',
  payload: JSON.stringify({ id: 'pet-1', name: 'Buddy' }),
  updated_at: '2026-10-22T09:01:00.000Z',
  sync_version: 1,
  attempts: 0,
};

describe('localDraftExportService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequest.mockResolvedValue({ data: { data: { canExport: true } } } as never);
    mockGetDrafts.mockResolvedValue([draft]);
    mockQueryAll.mockResolvedValue([pendingChange] as never);
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(true);
    (Sharing.shareAsync as jest.Mock).mockResolvedValue(undefined);
  });

  it('exports the latest local drafts and pending work as an encrypted shareable file', async () => {
    const summary = await exportLocalDrafts('correct horse battery staple');
    const write = FileSystem.writeAsStringAsync as jest.Mock;
    const encryptedFile = JSON.parse(write.mock.calls[0][1] as string);

    expect(summary).toMatchObject({ clinicalNoteDraftCount: 1, pendingChangeCount: 1 });
    expect(encryptedFile).toMatchObject({
      format: 'petchain-local-drafts',
      algorithm: 'AES-256-CBC+HMAC-SHA256',
      keyDerivation: 'PBKDF2-SHA256',
      iterations: 150_000,
    });
    expect(JSON.stringify(encryptedFile)).not.toContain('private note');
    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      expect.stringContaining('petchain-local-drafts-'),
      expect.objectContaining({ mimeType: 'application/json' }),
    );
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
      expect.stringContaining('petchain-local-drafts-'),
      { idempotent: true },
    );
  });

  it('does not export when the server denies permission', async () => {
    mockRequest.mockResolvedValueOnce({ data: { data: { canExport: false } } } as never);

    await expect(getLocalDraftExportPermission()).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    expect(mockGetDrafts).not.toHaveBeenCalled();
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });

  it('rechecks permission immediately before export and refuses a stale grant', async () => {
    mockRequest
      .mockResolvedValueOnce({ data: { data: { canExport: true } } } as never)
      .mockRejectedValueOnce({ response: { status: 403 } });

    await getLocalDraftExportPermission();
    await expect(exportLocalDrafts('correct horse battery staple')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(mockGetDrafts).not.toHaveBeenCalled();
  });

  it('reads local state again and refuses to export after drafts have been cleared', async () => {
    await getLocalDraftSummary();
    mockGetDrafts.mockResolvedValueOnce([]);
    mockQueryAll.mockResolvedValueOnce([] as never);

    await expect(exportLocalDrafts('correct horse battery staple')).rejects.toMatchObject({
      code: 'NO_DRAFTS',
    });
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });

  it('supports retrying permission checks after a transient network failure', async () => {
    mockRequest
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ data: { data: { canExport: true } } } as never);

    await expect(getLocalDraftExportPermission()).rejects.toMatchObject({
      code: 'PERMISSION_UNCONFIRMED',
    });
    await expect(getLocalDraftExportPermission()).resolves.toBeUndefined();
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('enforces passphrase length boundaries', () => {
    expect(() => validateDraftExportPassphrase('short pass')).toThrow(LocalDraftExportError);
    expect(() => validateDraftExportPassphrase('a'.repeat(257))).toThrow(LocalDraftExportError);
    expect(() => validateDraftExportPassphrase('a'.repeat(12))).not.toThrow();
    expect(() => validateDraftExportPassphrase('a'.repeat(256))).not.toThrow();
  });
});
