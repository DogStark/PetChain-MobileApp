import * as Crypto from 'expo-crypto';

import { executeSql, queryAll } from './localDB';
import { getCurrentAccountId } from './authService';

const RETENTION_DAYS = 365;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

export type LocalAuditAction = 'EXPORT' | 'REMOVE_LOCAL';
export type LocalAuditResult = 'success' | 'failure';

export interface LocalAuditEvent {
  id: string;
  account_id: string;
  action: LocalAuditAction;
  occurred_at: string;
  record_digest: string;
  result: LocalAuditResult;
}

export interface PreparedLocalAuditEvent {
  id: string;
  accountId: string;
  action: LocalAuditAction;
  occurredAt: string;
  recordDigest: string;
  result: LocalAuditResult;
}

async function ensureAuditSchema(): Promise<void> {
  await executeSql(`
    CREATE TABLE IF NOT EXISTS local_audit_events (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL,
      action TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      record_digest TEXT NOT NULL,
      result TEXT NOT NULL CHECK (result IN ('success', 'failure'))
    )
  `);
  await executeSql(
    `CREATE INDEX IF NOT EXISTS idx_local_audit_account_time
     ON local_audit_events (account_id, occurred_at DESC)`,
  );
}

export async function prepareLocalAuditEvent(input: {
  action: LocalAuditAction;
  recordReference: string;
  result: LocalAuditResult;
}): Promise<PreparedLocalAuditEvent | null> {
  const accountId = await getCurrentAccountId();
  if (!accountId) return null;

  await ensureAuditSchema();
  const occurredAt = new Date().toISOString();
  const recordDigest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${accountId}:${input.recordReference}`,
  );
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    accountId,
    action: input.action,
    occurredAt,
    recordDigest,
    result: input.result,
  };
}

export async function insertPreparedLocalAuditEvent(
  event: PreparedLocalAuditEvent,
): Promise<void> {
  await executeSql(
    `INSERT INTO local_audit_events
      (id, account_id, action, occurred_at, record_digest, result)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [event.id, event.accountId, event.action, event.occurredAt, event.recordDigest, event.result],
  );
}

export async function recordLocalAuditEvent(input: {
  action: LocalAuditAction;
  recordReference: string;
  result: LocalAuditResult;
}): Promise<void> {
  const event = await prepareLocalAuditEvent(input);
  if (!event) return;

  await executeSql('DELETE FROM local_audit_events WHERE occurred_at < ?', [
    new Date(Date.now() - RETENTION_MS).toISOString(),
  ]);
  await insertPreparedLocalAuditEvent(event);
}

export async function getLocalAuditEvents(): Promise<LocalAuditEvent[]> {
  const accountId = await getCurrentAccountId();
  if (!accountId) return [];
  await ensureAuditSchema();
  return queryAll<LocalAuditEvent>(
    `SELECT id, account_id, action, occurred_at, record_digest, result
     FROM local_audit_events WHERE account_id = ? ORDER BY occurred_at DESC`,
    [accountId],
  );
}

function escapeCsv(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export async function exportLocalAuditCsv(): Promise<string> {
  const events = await getLocalAuditEvents();
  const rows = [
    ['timestamp', 'action', 'record_digest', 'result'],
    ...events.map((event) => [event.occurred_at, event.action, event.record_digest, event.result]),
  ];
  return rows.map((row) => row.map(escapeCsv).join(',')).join('\n');
}