/**
 * backup.ts — Daily PostgreSQL + file backup to S3
 *
 * Environment variables:
 *   DATABASE_URL          — PostgreSQL connection string
 *   BACKUP_S3_BUCKET      — S3 bucket for backups
 *   BACKUP_S3_PREFIX      — Key prefix (default: 'backups')
 *   BACKUP_S3_REGION      — AWS region (default: 'us-east-1')
 *   AWS_ACCESS_KEY_ID     — AWS credentials (or use IAM role)
 *   AWS_SECRET_ACCESS_KEY — AWS credentials
 *   BACKUP_RETENTION_DAYS — Days to retain backups (default: 30)
 *   BACKUP_FILES_DIR      — Local user-files directory to back up incrementally
 *   PAGERDUTY_ROUTING_KEY — PagerDuty Events API v2 routing key for alerts
 *   BACKUP_TEMP_DIR       — Temp directory for dump files (default: /tmp)
 */

import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { createReadStream, createWriteStream, statSync } from 'fs';
import { unlink, readdir, stat } from 'fs/promises';
import https from 'https';
import path from 'path';
import { promisify } from 'util';
import { createGzip } from 'zlib';

import logger from '../utils/logger';

const execFileAsync = promisify(execFile);

// ─── Configuration ────────────────────────────────────────────────────────────

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/petchain';
const S3_BUCKET = process.env.BACKUP_S3_BUCKET || '';
const S3_PREFIX = (process.env.BACKUP_S3_PREFIX || 'backups').replace(/\/$/, '');
const S3_REGION = process.env.BACKUP_S3_REGION || 'us-east-1';
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS) || 30;
const FILES_DIR = process.env.BACKUP_FILES_DIR || '';
const TEMP_DIR = process.env.BACKUP_TEMP_DIR || '/tmp';
const PAGERDUTY_KEY = process.env.PAGERDUTY_ROUTING_KEY || '';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BackupResult {
  timestamp: string;
  dbKey: string;
  dbChecksum: string;
  dbSizeBytes: number;
  filesBackedUp: number;
  verified: boolean;
}

// ─── S3 client (dynamic require — @aws-sdk/client-s3 optional peer dep) ──────

interface S3Client {
  send(cmd: unknown): Promise<unknown>;
}

interface S3GetObjectOutput {
  Body?: { transformToByteArray(): Promise<Uint8Array> };
}

function getS3Client(): S3Client {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { S3Client: Client } = require('@aws-sdk/client-s3') as {
    S3Client: new (cfg: object) => S3Client;
  };
  return new Client({ region: S3_REGION });
}

async function s3PutObject(
  key: string,
  body: Buffer,
  contentType = 'application/octet-stream',
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PutObjectCommand } = require('@aws-sdk/client-s3') as {
    PutObjectCommand: new (input: object) => unknown;
  };
  const client = getS3Client();
  await client.send(
    new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: body, ContentType: contentType }),
  );
}

async function s3GetObject(key: string): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { GetObjectCommand } = require('@aws-sdk/client-s3') as {
    GetObjectCommand: new (input: object) => unknown;
  };
  const client = getS3Client();
  const resp = (await client.send(
    new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }),
  )) as S3GetObjectOutput;
  if (!resp.Body) throw new Error(`Empty S3 response for key: ${key}`);
  const bytes = await resp.Body.transformToByteArray();
  return Buffer.from(bytes);
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

async function s3DeleteObject(key: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DeleteObjectCommand } = require('@aws-sdk/client-s3') as {
    DeleteObjectCommand: new (input: object) => unknown;
  };
  const client = getS3Client();
  await client.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
}

// ─── Checksum ─────────────────────────────────────────────────────────────────

export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(filePath)
      .on('error', reject)
      .pipe(hash)
      .on('error', reject)
      .on('finish', () => resolve(hash.digest('hex')));
  });
}

export function sha256Buffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

// ─── PostgreSQL dump ──────────────────────────────────────────────────────────

export async function dumpDatabase(outPath: string): Promise<void> {
  const url = new URL(DATABASE_URL);
  const env = {
    ...process.env,
    PGPASSWORD: url.password,
  };

  await execFileAsync(
    'pg_dump',
    [
      '--format=custom',
      '--compress=9',
      `--host=${url.hostname}`,
      `--port=${url.port || '5432'}`,
      `--username=${url.username}`,
      `--dbname=${url.pathname.slice(1)}`,
      `--file=${outPath}`,
    ],
    { env },
  );
}

// ─── Compress file ────────────────────────────────────────────────────────────

export function gzipFile(src: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const input = createReadStream(src);
    const output = createWriteStream(dest);
    const gz = createGzip({ level: 9 });
    input.on('error', reject);
    output.on('error', reject);
    output.on('finish', resolve);
    input.pipe(gz).pipe(output);
  });
}

// ─── Incremental file backup ──────────────────────────────────────────────────

async function listLocalFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      files.push(...(await listLocalFiles(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

export async function backupFiles(filesDir: string, s3Prefix: string): Promise<number> {
  if (!filesDir) return 0;

  let count = 0;
  const files = await listLocalFiles(filesDir);

  for (const filePath of files) {
    const relKey = path.relative(filesDir, filePath).replace(/\\/g, '/');
    const s3Key = `${s3Prefix}/${relKey}`;
    const localChecksum = await sha256File(filePath);

    // Check if S3 already has this version via checksum metadata
    let remoteChecksum = '';
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { HeadObjectCommand } = require('@aws-sdk/client-s3') as {
        HeadObjectCommand: new (input: object) => unknown;
      };
      const client = getS3Client();
      const head = (await client.send(
        new HeadObjectCommand({ Bucket: S3_BUCKET, Key: s3Key }),
      )) as {
        Metadata?: Record<string, string>;
      };
      remoteChecksum = head.Metadata?.['sha256'] ?? '';
    } catch {
      // Object doesn't exist yet — upload it
    }

    if (remoteChecksum === localChecksum) continue; // unchanged

    const fileBuffer = await import('fs/promises').then((fs) => fs.readFile(filePath));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PutObjectCommand } = require('@aws-sdk/client-s3') as {
      PutObjectCommand: new (input: object) => unknown;
    };
    const client = getS3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: s3Key,
        Body: fileBuffer,
        Metadata: { sha256: localChecksum },
      }),
    );
    count++;
  }

  return count;
}

// ─── Retention enforcement ────────────────────────────────────────────────────

export async function enforceRetention(prefix: string): Promise<number> {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const objects = await s3ListObjects(prefix);
  let deleted = 0;

  for (const obj of objects) {
    if (obj.LastModified.getTime() < cutoff) {
      await s3DeleteObject(obj.Key);
      deleted++;
    }
  }

  return deleted;
}

// ─── Verification ─────────────────────────────────────────────────────────────

export async function verifyBackup(s3Key: string, expectedChecksum: string): Promise<boolean> {
  const data = await s3GetObject(s3Key);
  const actual = sha256Buffer(data);
  return actual === expectedChecksum;
}

// ─── PagerDuty alert ──────────────────────────────────────────────────────────

export async function sendAlert(summary: string, details: Record<string, unknown>): Promise<void> {
  if (!PAGERDUTY_KEY) {
    logger.warn('[backup] PAGERDUTY_ROUTING_KEY not set — alert suppressed', { summary });
    return;
  }

  const payload = JSON.stringify({
    routing_key: PAGERDUTY_KEY,
    event_action: 'trigger',
    payload: {
      summary,
      severity: 'critical',
      source: 'petchain-backup',
      custom_details: details,
    },
  });

  await new Promise<void>((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'events.pagerduty.com',
        path: '/v2/enqueue',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        res.resume();
        res.on('end', resolve);
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ─── Retry helper ─────────────────────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 5000): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw lastErr;
}

// ─── Main backup procedure ────────────────────────────────────────────────────

export async function runBackup(): Promise<BackupResult> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dumpPath = path.join(TEMP_DIR, `petchain-${timestamp}.dump`);
  const gzPath = `${dumpPath}.gz`;

  logger.info('[backup] Starting backup', { timestamp });

  try {
    // 1. pg_dump
    logger.info('[backup] Running pg_dump');
    await withRetry(() => dumpDatabase(dumpPath));

    // 2. Compress
    await gzipFile(dumpPath, gzPath);
    await unlink(dumpPath);

    // 3. Checksum
    const checksum = await sha256File(gzPath);
    const sizeBytes = statSync(gzPath).size;

    // 4. Upload DB backup
    const dbKey = `${S3_PREFIX}/db/${timestamp}.dump.gz`;
    const gzBuffer = await import('fs/promises').then((fs) => fs.readFile(gzPath));
    await withRetry(() => s3PutObject(dbKey, gzBuffer));

    // 5. Upload checksum manifest
    const manifest = JSON.stringify({ key: dbKey, sha256: checksum, sizeBytes, timestamp });
    await s3PutObject(
      `${S3_PREFIX}/db/${timestamp}.manifest.json`,
      Buffer.from(manifest),
      'application/json',
    );

    // 6. Verify
    logger.info('[backup] Verifying backup integrity');
    const verified = await withRetry(() => verifyBackup(dbKey, checksum));
    if (!verified) {
      throw new Error(`Checksum mismatch after upload for key: ${dbKey}`);
    }

    // 7. Incremental file backup
    const filesPrefix = `${S3_PREFIX}/files`;
    const filesBackedUp = FILES_DIR
      ? await withRetry(() => backupFiles(FILES_DIR, filesPrefix))
      : 0;

    // 8. Retention
    const deleted = await enforceRetention(`${S3_PREFIX}/db/`);
    logger.info('[backup] Retention cleanup', { deleted });

    // 9. Cleanup temp
    await unlink(gzPath);

    const result: BackupResult = {
      timestamp,
      dbKey,
      dbChecksum: checksum,
      dbSizeBytes: sizeBytes,
      filesBackedUp,
      verified,
    };
    logger.info('[backup] Backup completed successfully', result);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[backup] Backup failed', { error: message });

    await sendAlert('PetChain backup failed', { error: message, timestamp }).catch(() => {});

    // Cleanup temp files on failure
    for (const p of [dumpPath, gzPath]) {
      try {
        await unlink(p);
      } catch {
        /* ignore */
      }
    }

    throw err;
  }
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (require.main === module) {
  runBackup()
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
