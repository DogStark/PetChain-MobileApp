import {
  clearAccountUploadMetadata,
  getUploadMetadata,
  hashChunks,
  resumeUpload,
  saveUploadMetadata,
  UploadChunk,
  UploadMetadata,
} from '../src/utils/attachmentUploadResume';

function makeChunks(count: number, size: number): UploadChunk[] {
  return Array.from({ length: count }, (_, index) => ({
    index,
    data: Buffer.alloc(size, index + 1),
  }));
}

function makeMetadata(overrides: Partial<UploadMetadata> = {}): UploadMetadata {
  return {
    accountId: 'account-1',
    recordId: 'record-1',
    attachmentId: 'attachment-1',
    totalChunks: 3,
    chunkSize: 4,
    confirmedOffset: 0,
    completedChunks: [],
    quarantinedChunks: [],
    retryCount: 0,
    maxRetries: 3,
    status: 'pending',
    ...overrides,
  };
}

describe('attachmentUploadResume', () => {
  afterEach(() => {
    clearAccountUploadMetadata('account-1');
    clearAccountUploadMetadata('account-2');
  });

  it('resumes from the server-confirmed offset after interruption', async () => {
    const chunks = makeChunks(3, 4);
    const metadata = makeMetadata();
    const uploaded: number[] = [];
    const server = {
      getConfirmedOffset: jest.fn().mockResolvedValue(4),
      uploadChunk: jest.fn(async (_id: string, index: number) => {
        uploaded.push(index);
      }),
      finalize: jest.fn().mockResolvedValue(undefined),
    };

    const result = await resumeUpload(metadata, chunks, server);

    expect(uploaded).toEqual([1, 2]);
    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
  });

  it('does not mark uploaded when the final hash mismatches', async () => {
    const chunks = makeChunks(3, 4);
    const metadata = makeMetadata({ expectedHash: 'deadbeef' });
    const server = {
      getConfirmedOffset: jest.fn().mockResolvedValue(0),
      uploadChunk: jest.fn().mockResolvedValue(undefined),
      finalize: jest.fn().mockResolvedValue(undefined),
    };

    const result = await resumeUpload(metadata, chunks, server);

    expect(result.success).toBe(false);
    expect(result.status).toBe('failed');
    expect(server.finalize).not.toHaveBeenCalled();
  });

  it('quarantines failed chunks and bounds retries', async () => {
    const chunks = makeChunks(3, 4);
    const metadata = makeMetadata({ maxRetries: 1 });
    const server = {
      getConfirmedOffset: jest.fn().mockResolvedValue(0),
      uploadChunk: jest.fn().mockRejectedValue(new Error('network')),
      finalize: jest.fn().mockResolvedValue(undefined),
    };

    const result = await resumeUpload(metadata, chunks, server);

    expect(result.success).toBe(false);
    expect(result.retryCount).toBe(1);
    expect(metadata.quarantinedChunks).toContain(0);
  });

  it('isolates pending metadata per account on logout', () => {
    saveUploadMetadata(makeMetadata({ accountId: 'account-1' }));
    saveUploadMetadata(makeMetadata({ accountId: 'account-2', attachmentId: 'attachment-2' }));

    clearAccountUploadMetadata('account-1');

    expect(getUploadMetadata('account-1', 'attachment-1')).toBeUndefined();
    expect(getUploadMetadata('account-2', 'attachment-2')).toBeDefined();
  });

  it('hashes completed objects deterministically', () => {
    const chunks = makeChunks(2, 4);
    expect(hashChunks(chunks)).toBe(hashChunks(chunks));
  });
});
