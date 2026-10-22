/**
 * Tests for backup and restore scripts
 */

import { execFile } from 'child_process';
import { createReadStream } from 'fs';
import { unlink, writeFile, mkdir } from 'fs/promises';
import os from 'os';
import path from 'path';

// ─── Mock child_process ───────────────────────────────────────────────────────

jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

const mockExecFile = execFile as jest.MockedFunction<typeof execFile>;

// ─── Mock fs streams ──────────────────────────────────────────────────────────

jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...actual,
    createReadStream: jest.fn(),
    createWriteStream: jest.fn(),
    statSync: jest.fn().mockReturnValue({ size: 1024 }),
  };
});

const _mockCreateReadStream = createReadStream as jest.MockedFunction<typeof createReadStream>;

// ─── Mock @aws-sdk/client-s3 ─────────────────────────────────────────────────

const mockSend = jest.fn();
jest.mock(
  '@aws-sdk/client-s3',
  () => ({
    S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
    PutObjectCommand: jest.fn().mockImplementation((input) => ({ _type: 'PutObject', ...input })),
    GetObjectCommand: jest.fn().mockImplementation((input) => ({ _type: 'GetObject', ...input })),
    HeadObjectCommand: jest.fn().mockImplementation((input) => ({ _type: 'HeadObject', ...input })),
    ListObjectsV2Command: jest
      .fn()
      .mockImplementation((input) => ({ _type: 'ListObjectsV2', ...input })),
    DeleteObjectCommand: jest
      .fn()
      .mockImplementation((input) => ({ _type: 'DeleteObject', ...input })),
  }),
  { virtual: true },
);

// ─── Mock logger ──────────────────────────────────────────────────────────────

jest.mock('../utils/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAsyncBody(data: Buffer) {
  return { transformToByteArray: async () => new Uint8Array(data) };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('backup utilities', () => {
  let _tmpDir: string;

  beforeAll(async () => {
    _tmpDir = await import('fs/promises').then(() => os.tmpdir());
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BACKUP_S3_BUCKET = 'test-bucket';
    process.env.BACKUP_S3_REGION = 'us-east-1';
    process.env.BACKUP_S3_PREFIX = 'backups';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
  });

  // ── sha256Buffer ────────────────────────────────────────────────────────────

  describe('sha256Buffer', () => {
    it('returns consistent hex digest', async () => {
      const { sha256Buffer } = await import('./backup');
      const buf = Buffer.from('hello world');
      const hash = sha256Buffer(buf);
      expect(hash).toHaveLength(64);
      expect(sha256Buffer(buf)).toBe(hash); // deterministic
    });

    it('produces different hashes for different inputs', async () => {
      const { sha256Buffer } = await import('./backup');
      expect(sha256Buffer(Buffer.from('a'))).not.toBe(sha256Buffer(Buffer.from('b')));
    });
  });

  // ── sha256File ──────────────────────────────────────────────────────────────

  describe('sha256File', () => {
    it('hashes a real temp file', async () => {
      const { sha256File } = await import('./backup');
      const filePath = path.join(os.tmpdir(), `test-hash-${Date.now()}.txt`);
      await writeFile(filePath, 'petchain backup test');
      const hash = await sha256File(filePath);
      expect(hash).toHaveLength(64);
      await unlink(filePath);
    });
  });

  // ── dumpDatabase ────────────────────────────────────────────────────────────

  describe('dumpDatabase', () => {
    it('calls pg_dump with correct arguments', async () => {
      mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
        if (cb) cb(null, '', '');
        return {} as ReturnType<typeof execFile>;
      });

      const { dumpDatabase } = await import('./backup');
      await dumpDatabase('/tmp/test.dump');

      expect(mockExecFile).toHaveBeenCalledWith(
        'pg_dump',
        expect.arrayContaining(['--format=custom', '--compress=9', '--host=localhost']),
        expect.objectContaining({ env: expect.objectContaining({ PGPASSWORD: 'pass' }) }),
        expect.any(Function),
      );
    });

    it('rejects when pg_dump fails', async () => {
      mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
        if (cb) cb(new Error('pg_dump not found'), '', '');
        return {} as ReturnType<typeof execFile>;
      });

      const { dumpDatabase } = await import('./backup');
      await expect(dumpDatabase('/tmp/test.dump')).rejects.toThrow('pg_dump not found');
    });
  });

  // ── S3 upload + verify ──────────────────────────────────────────────────────

  describe('verifyBackup', () => {
    it('returns true when checksums match', async () => {
      const { sha256Buffer, verifyBackup } = await import('./backup');
      const data = Buffer.from('backup content');
      const checksum = sha256Buffer(data);

      mockSend.mockResolvedValue({ Body: makeAsyncBody(data) });

      const result = await verifyBackup('backups/db/test.dump.gz', checksum);
      expect(result).toBe(true);
    });

    it('returns false when checksums differ', async () => {
      const { verifyBackup } = await import('./backup');
      mockSend.mockResolvedValue({ Body: makeAsyncBody(Buffer.from('tampered')) });

      const result = await verifyBackup('backups/db/test.dump.gz', 'deadbeef'.repeat(8));
      expect(result).toBe(false);
    });
  });

  // ── enforceRetention ────────────────────────────────────────────────────────

  describe('enforceRetention', () => {
    it('deletes objects older than retention period', async () => {
      const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000); // 40 days ago
      const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago

      mockSend
        .mockResolvedValueOnce({
          Contents: [
            { Key: 'backups/db/old.dump.gz', LastModified: old },
            { Key: 'backups/db/recent.dump.gz', LastModified: recent },
          ],
        })
        .mockResolvedValue({}); // delete calls

      process.env.BACKUP_RETENTION_DAYS = '30';
      const { enforceRetention } = await import('./backup');
      const deleted = await enforceRetention('backups/db/');

      expect(deleted).toBe(1);
      expect(mockSend).toHaveBeenCalledTimes(2); // list + 1 delete
    });
  });

  // ── sendAlert ───────────────────────────────────────────────────────────────

  describe('sendAlert', () => {
    it('suppresses alert when PAGERDUTY_ROUTING_KEY is not set', async () => {
      delete process.env.PAGERDUTY_ROUTING_KEY;
      const { sendAlert } = await import('./backup');
      // Should not throw
      await expect(sendAlert('test alert', {})).resolves.toBeUndefined();
    });
  });
});

// ─── Restore tests ────────────────────────────────────────────────────────────

describe('restore utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BACKUP_S3_BUCKET = 'test-bucket';
    process.env.BACKUP_S3_REGION = 'us-east-1';
    process.env.BACKUP_S3_PREFIX = 'backups';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
  });

  describe('findLatestBackupKey', () => {
    it('returns the most recent dump key', async () => {
      mockSend.mockResolvedValue({
        Contents: [
          { Key: 'backups/db/2026-05-30.dump.gz', LastModified: new Date('2026-05-30') },
          { Key: 'backups/db/2026-05-31.dump.gz', LastModified: new Date('2026-05-31') },
          { Key: 'backups/db/2026-05-31.manifest.json', LastModified: new Date('2026-05-31') },
        ],
      });

      const { findLatestBackupKey } = await import('./restore');
      const key = await findLatestBackupKey();
      expect(key).toBe('backups/db/2026-05-31.dump.gz');
    });

    it('throws when no backups exist', async () => {
      mockSend.mockResolvedValue({ Contents: [] });
      const { findLatestBackupKey } = await import('./restore');
      await expect(findLatestBackupKey()).rejects.toThrow('No backups found');
    });
  });

  describe('findBackupBeforeTime', () => {
    it('returns the latest backup before the target time', async () => {
      mockSend.mockResolvedValue({
        Contents: [
          { Key: 'backups/db/2026-05-29.dump.gz', LastModified: new Date('2026-05-29T00:00:00Z') },
          { Key: 'backups/db/2026-05-31.dump.gz', LastModified: new Date('2026-05-31T12:00:00Z') },
        ],
      });

      const { findBackupBeforeTime } = await import('./restore');
      const key = await findBackupBeforeTime('2026-05-30T00:00:00Z');
      expect(key).toBe('backups/db/2026-05-29.dump.gz');
    });
  });

  describe('verifyFromManifest', () => {
    it('returns true when checksum matches manifest', async () => {
      const { sha256Buffer } = await import('./backup');
      const data = Buffer.from('backup data');
      const checksum = sha256Buffer(data);
      const manifest = JSON.stringify({
        key: 'test.dump.gz',
        sha256: checksum,
        sizeBytes: data.length,
        timestamp: '',
      });

      mockSend.mockResolvedValue({ Body: makeAsyncBody(Buffer.from(manifest)) });

      const { verifyFromManifest } = await import('./restore');
      const result = await verifyFromManifest('backups/db/test.dump.gz', data);
      expect(result).toBe(true);
    });

    it('returns false when checksum does not match', async () => {
      const manifest = JSON.stringify({
        key: 'test.dump.gz',
        sha256: 'wrong'.repeat(12) + 'abcd',
        sizeBytes: 0,
        timestamp: '',
      });
      mockSend.mockResolvedValue({ Body: makeAsyncBody(Buffer.from(manifest)) });

      const { verifyFromManifest } = await import('./restore');
      const result = await verifyFromManifest(
        'backups/db/test.dump.gz',
        Buffer.from('actual data'),
      );
      expect(result).toBe(false);
    });

    it('returns true (non-fatal) when manifest is missing', async () => {
      mockSend.mockRejectedValue(new Error('NoSuchKey'));
      const { verifyFromManifest } = await import('./restore');
      const result = await verifyFromManifest('backups/db/old.dump.gz', Buffer.from('data'));
      expect(result).toBe(true);
    });
  });

  describe('writePitrRecoveryConfig', () => {
    it('writes recovery config files', async () => {
      const tmpDir = path.join(os.tmpdir(), `pitr-test-${Date.now()}`);
      await mkdir(tmpDir, { recursive: true });

      const { writePitrRecoveryConfig } = await import('./restore');
      await writePitrRecoveryConfig('2026-05-31T10:30:00Z', tmpDir);

      const { readFile } = await import('fs/promises');
      const config = await readFile(path.join(tmpDir, 'postgresql.auto.conf'), 'utf8');
      expect(config).toContain('recovery_target_time');
      expect(config).toContain('2026-05-31T10:30:00Z');

      const signal = await readFile(path.join(tmpDir, 'recovery.signal'), 'utf8');
      expect(signal).toBe('');
    });
  });
});
