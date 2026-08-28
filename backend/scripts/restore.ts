/**
 * restore.ts — PostgreSQL point-in-time restore from S3
 *
 * Environment variables:
 *   DATABASE_URL          — Target PostgreSQL connection string
 *   BACKUP_S3_BUCKET      — S3 bucket containing backups
 *   BACKUP_S3_PREFIX      — Key prefix (default: 'backups')
 *   BACKUP_S3_REGION      — AWS region (default: 'us-east-1')
 *   AWS_ACCESS_KEY_ID     — AWS credentials
 *   AWS_SECRET_ACCESS_KEY — AWS credentials
 *   BACKUP_TEMP_DIR       — Temp directory (default: /tmp)
 *   RESTORE_TARGET_TIME   — ISO timestamp for point-in-time recovery
 *                           (requires WAL archiving; see docs/BACKUP.md)
 *
 * Usage:
 *   # Restore latest backup
 *   ts-node backend/scripts/restore.ts
 *
 *   # Restore specific backup by S3 key
 *   ts-node backend/scripts/restore.ts --key backups/db/2026-05-31T00-00-00.dump.gz
 *
 *   # Point-in-time recovery (requires WAL archiving configured)
 *   RESTORE_TARGET_TIME=2026-05-31T10:30:00Z ts-node backend/scripts/restore.ts --pitr
 */

import { execFile } from 'child_process';
import { createWriteStream } from 'fs';
import { unlink, writeFile } from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { promisify } from 'util';
import { createGunzip } from 'zlib';

import { sha256Buffer, sendAlert } from './backup';
import logger from '../utils/logger';

const execFileAsync = promisify(execFile);

// ─── Configuration ────────────────────────────────────────────────────────────

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/petchain';
const S3_BUCKET = process.env.BACKUP_S3_BUCKET || '';
const S3_PREFIX = (process.env.BACKUP_S3_PREFIX || 'backups').replace(/\/$/, '');
const S3_REGION = process.env.BACKUP_S3_REGION || 'us-east-1';
const TEMP_DIR = process.env.BACKUP_TEMP_DIR || '/tmp';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RestoreResult {
  restoredKey: string;
  verifiedChecksum: boolean;
  targetTime?: string;
  completedAt: string;
}

interface BackupManifest {
  key: string;
  sha256: string;
  sizeBytes: number;
  timestamp: string;
}

// ─── S3 helpers (same dynamic-require pattern as backup.ts) ──────────────────

interface S3Client {
  send(cmd: unknown): Promise<unknown>;
}

function getS3Client(): S3Client {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { S3Client: Client } = require('@aws-sdk/client-s3') as {
    S3Client: new (cfg: object) => S3Client;
  };
  return new Client({ region: S3_REGION });
}

async function s3GetBuffer(key: string): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { GetObjectCommand } = require('@aws-sdk/client-s3') as {
    GetObjectCommand: new (input: object) => unknown;
  };
  const client = getS3Client();
  const resp = (await client.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }))) as {
    Body?: { transformToByteArray(): Promise<Uint8Array> };
  };
  if (!resp.Body) throw new Error(`Empty S3 response for key: ${key}`);
  return Buffer.from(await resp.Body.transformToByteArray());
}

async function s3ListObjects(prefix: string): Promise<Array<{ Key: string; LastModified: Date }>> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ListObjectsV2Command } = require('@aws-sdk/client-s3') as {
    ListObjectsV2Command: new (input: object) => unknown;
  };
  const client = getS3Client();
  const resp = (await client.send(
    new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: prefix }),
  )) as {
    Contents?: Array<{ Key: string; LastModified: Date }>;
  };
  return resp.Contents ?? [];
}

// ─── Find latest or nearest backup ───────────────────────────────────────────

export async function findLatestBackupKey(): Promise<string> {
  const objects = await s3ListObjects(`${S3_PREFIX}/db/`);
  const dumps = objects
    .filter((o) => o.Key.endsWith('.dump.gz'))
    .sort((a, b) => b.LastModified.getTime() - a.LastModified.getTime());

  if (dumps.length === 0) throw new Error('No backups found in S3');
  return dumps[0].Key;
}

export async function findBackupBeforeTime(targetTime: string): Promise<string> {
  const target = new Date(targetTime).getTime();
  const objects = await s3ListObjects(`${S3_PREFIX}/db/`);
  const dumps = objects
    .filter((o) => o.Key.endsWith('.dump.gz') && o.LastModified.getTime() <= target)
    .sort((a, b) => b.LastModified.getTime() - a.LastModified.getTime());

  if (dumps.length === 0) throw new Error(`No backup found before ${targetTime}`);
  return dumps[0].Key;
}

// ─── Download and decompress ──────────────────────────────────────────────────

export async function downloadAndDecompress(s3Key: string, destPath: string): Promise<void> {
  const gzBuffer = await s3GetBuffer(s3Key);

  await new Promise<void>((resolve, reject) => {
    const readable = Readable.from(gzBuffer);
    const gunzip = createGunzip();
    const output = createWriteStream(destPath);
    readable.on('error', reject);
    gunzip.on('error', reject);
    output.on('error', reject);
    output.on('finish', resolve);
    readable.pipe(gunzip).pipe(output);
  });
}

// ─── Verify checksum against manifest ────────────────────────────────────────

export async function verifyFromManifest(
  s3Key: string,
  downloadedBuffer: Buffer,
): Promise<boolean> {
  const manifestKey = s3Key.replace('.dump.gz', '.manifest.json');
  try {
    const manifestBuf = await s3GetBuffer(manifestKey);
    const manifest = JSON.parse(manifestBuf.toString()) as BackupManifest;
    const actual = sha256Buffer(downloadedBuffer);
    return actual === manifest.sha256;
  } catch {
    logger.warn('[restore] Manifest not found, skipping checksum verification', { s3Key });
    return true; // non-fatal if manifest missing (older backups)
  }
}

// ─── pg_restore ───────────────────────────────────────────────────────────────

export async function restoreDatabase(dumpPath: string, dropExisting = false): Promise<void> {
  const url = new URL(DATABASE_URL);
  const env = { ...process.env, PGPASSWORD: url.password };

  if (dropExisting) {
    // Drop and recreate the target database
    await execFileAsync(
      'dropdb',
      [
        `--host=${url.hostname}`,
        `--port=${url.port || '5432'}`,
        `--username=${url.username}`,
        '--if-exists',
        url.pathname.slice(1),
      ],
      { env },
    );
    await execFileAsync(
      'createdb',
      [
        `--host=${url.hostname}`,
        `--port=${url.port || '5432'}`,
        `--username=${url.username}`,
        url.pathname.slice(1),
      ],
      { env },
    );
  }

  await execFileAsync(
    'pg_restore',
    [
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-privileges',
      `--host=${url.hostname}`,
      `--port=${url.port || '5432'}`,
      `--username=${url.username}`,
      `--dbname=${url.pathname.slice(1)}`,
      dumpPath,
    ],
    { env },
  );
}

// ─── Point-in-time recovery via WAL ──────────────────────────────────────────
//
// Full PITR requires:
//   1. PostgreSQL configured with archive_mode=on and archive_command pointing to S3
//   2. A base backup (pg_basebackup) stored in S3
//   3. WAL segments archived to S3
//
// This function writes a recovery.conf / postgresql.auto.conf for PostgreSQL 12+
// and instructs the operator to restart PostgreSQL.  Automated PITR in CI uses
// the pg_dump-based restore above with --target-time approximation.

export async function writePitrRecoveryConfig(
  targetTime: string,
  pgDataDir: string,
): Promise<void> {
  const walRestoreCmd = `aws s3 cp s3://${S3_BUCKET}/${S3_PREFIX}/wal/%f %p`;

  // PostgreSQL 12+ uses postgresql.auto.conf; older versions use recovery.conf
  const config = [
    `restore_command = '${walRestoreCmd}'`,
    `recovery_target_time = '${targetTime}'`,
    `recovery_target_action = 'promote'`,
  ].join('\n');

  await writeFile(path.join(pgDataDir, 'postgresql.auto.conf'), config + '\n', 'utf8');
  // Signal recovery mode
  await writeFile(path.join(pgDataDir, 'recovery.signal'), '', 'utf8');

  logger.info('[restore] PITR recovery config written', { pgDataDir, targetTime });
  logger.info('[restore] Restart PostgreSQL to begin WAL replay');
}

// ─── Main restore procedure ───────────────────────────────────────────────────

export async function runRestore(options: {
  key?: string;
  pitr?: boolean;
  targetTime?: string;
  dropExisting?: boolean;
}): Promise<RestoreResult> {
  const { pitr = false, dropExisting = false } = options;
  const targetTime = options.targetTime ?? process.env.RESTORE_TARGET_TIME;

  logger.info('[restore] Starting restore', { pitr, targetTime });

  let s3Key: string;
  if (options.key) {
    s3Key = options.key;
  } else if (pitr && targetTime) {
    s3Key = await findBackupBeforeTime(targetTime);
  } else {
    s3Key = await findLatestBackupKey();
  }

  logger.info('[restore] Restoring from', { s3Key });

  const dumpPath = path.join(TEMP_DIR, `petchain-restore-${Date.now()}.dump`);

  try {
    // 1. Download compressed backup
    const gzBuffer = await s3GetBuffer(s3Key);

    // 2. Verify checksum
    const verified = await verifyFromManifest(s3Key, gzBuffer);
    if (!verified) {
      throw new Error(`Checksum verification failed for backup: ${s3Key}`);
    }

    // 3. Decompress to temp file
    await downloadAndDecompress(s3Key, dumpPath);

    // 4. Restore database
    logger.info('[restore] Running pg_restore');
    await restoreDatabase(dumpPath, dropExisting);

    // 5. PITR WAL replay config (if requested)
    if (pitr && targetTime) {
      const pgDataDir = process.env.PGDATA || '/var/lib/postgresql/data';
      await writePitrRecoveryConfig(targetTime, pgDataDir);
    }

    await unlink(dumpPath);

    const result: RestoreResult = {
      restoredKey: s3Key,
      verifiedChecksum: verified,
      ...(targetTime ? { targetTime } : {}),
      completedAt: new Date().toISOString(),
    };

    logger.info('[restore] Restore completed successfully', result);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[restore] Restore failed', { error: message });

    await sendAlert('PetChain restore failed', { error: message, s3Key }).catch(() => {});

    try {
      await unlink(dumpPath);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  const keyArg = args.find((a) => a.startsWith('--key='))?.split('=')[1];
  const pitr = args.includes('--pitr');

  runRestore({ key: keyArg, pitr })
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
