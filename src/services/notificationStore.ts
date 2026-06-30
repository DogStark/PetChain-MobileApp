/**
 * SQLite-backed notification store.
 *
 * Single source of truth for all in-app notifications.
 * Uses the same petchain.db database as localDB.ts.
 */
import * as SQLite from 'expo-sqlite';

// ─── Types ────────────────────────────────────────────────────────────────────

export type NotificationCategory = 'medication' | 'appointment' | 'sos' | 'system';

export interface NavPayload {
  screen: string;
  params?: Record<string, unknown>;
}

export interface AppNotification {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: number; // Unix ms
  metadata?: Record<string, unknown>;
  navPayload?: NavPayload;
}

export type NotificationFilter = NotificationCategory | 'all';

// ─── DB setup ─────────────────────────────────────────────────────────────────

const db = SQLite.openDatabaseSync('petchain.db');

const SCHEMA_VERSION = 1;

async function ensureTable(): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS notifications (
      id          TEXT PRIMARY KEY NOT NULL,
      category    TEXT NOT NULL,
      title       TEXT NOT NULL,
      body        TEXT NOT NULL,
      is_read     INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL,
      metadata    TEXT,
      nav_payload TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_created_at
      ON notifications (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_category
      ON notifications (category);
    CREATE TABLE IF NOT EXISTS notification_meta (
      key   TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);

  // Record schema version
  await db.runAsync(
    `INSERT OR IGNORE INTO notification_meta (key, value) VALUES ('schema_version', ?)`,
    [String(SCHEMA_VERSION)],
  );
}

// Initialise on module load; errors are swallowed so the app doesn't crash.
const _ready = ensureTable().catch(() => {});

// ─── Change listeners ─────────────────────────────────────────────────────────

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeToNotificationChanges(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notifyListeners(): void {
  listeners.forEach((fn) => fn());
}

async function waitReady(): Promise<void> {
  await _ready;
}

// ─── Row ↔ AppNotification ────────────────────────────────────────────────────

interface Row {
  id: string;
  category: string;
  title: string;
  body: string;
  is_read: number;
  created_at: number;
  metadata: string | null;
  nav_payload: string | null;
}

function rowToNotification(row: Row): AppNotification {
  return {
    id: row.id,
    category: row.category as NotificationCategory,
    title: row.title,
    body: row.body,
    isRead: row.is_read === 1,
    createdAt: row.created_at,
    metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : undefined,
    navPayload: row.nav_payload ? (JSON.parse(row.nav_payload) as NavPayload) : undefined,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Add a notification. Silently ignores duplicates (same id).
 */
export async function addNotification(
  notification: Omit<AppNotification, 'isRead'> & { isRead?: boolean },
): Promise<void> {
  await waitReady();
  await db.runAsync(
    `INSERT OR IGNORE INTO notifications
       (id, category, title, body, is_read, created_at, metadata, nav_payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      notification.id,
      notification.category,
      notification.title,
      notification.body,
      notification.isRead ? 1 : 0,
      notification.createdAt,
      notification.metadata ? JSON.stringify(notification.metadata) : null,
      notification.navPayload ? JSON.stringify(notification.navPayload) : null,
    ],
  );
  notifyListeners();
}

/**
 * Fetch all notifications, newest first.
 * Optionally filter by category.
 */
export async function getNotifications(
  filter: NotificationFilter = 'all',
): Promise<AppNotification[]> {
  await waitReady();
  const rows =
    filter === 'all'
      ? await db.getAllAsync<Row>(`SELECT * FROM notifications ORDER BY created_at DESC`)
      : await db.getAllAsync<Row>(
          `SELECT * FROM notifications WHERE category = ? ORDER BY created_at DESC`,
          [filter],
        );
  return rows.map(rowToNotification);
}

/**
 * Count unread notifications (optionally filtered by category).
 */
export async function getUnreadCount(filter: NotificationFilter = 'all'): Promise<number> {
  await waitReady();
  const row =
    filter === 'all'
      ? await db.getFirstAsync<{ count: number }>(
          `SELECT COUNT(*) AS count FROM notifications WHERE is_read = 0`,
        )
      : await db.getFirstAsync<{ count: number }>(
          `SELECT COUNT(*) AS count FROM notifications WHERE is_read = 0 AND category = ?`,
          [filter],
        );
  return row?.count ?? 0;
}

/**
 * Mark a single notification as read.
 */
export async function markAsRead(id: string): Promise<void> {
  await waitReady();
  await db.runAsync(`UPDATE notifications SET is_read = 1 WHERE id = ?`, [id]);
  notifyListeners();
}

/**
 * Mark all notifications as read (optionally filtered by category).
 */
export async function markAllAsRead(filter: NotificationFilter = 'all'): Promise<void> {
  await waitReady();
  if (filter === 'all') {
    await db.runAsync(`UPDATE notifications SET is_read = 1`);
  } else {
    await db.runAsync(`UPDATE notifications SET is_read = 1 WHERE category = ?`, [filter]);
  }
  notifyListeners();
}

/**
 * Delete a single notification by id.
 */
export async function deleteNotification(id: string): Promise<void> {
  await waitReady();
  await db.runAsync(`DELETE FROM notifications WHERE id = ?`, [id]);
  notifyListeners();
}

/**
 * Delete all notifications (optionally filtered by category).
 */
export async function deleteAll(filter: NotificationFilter = 'all'): Promise<void> {
  await waitReady();
  if (filter === 'all') {
    await db.runAsync(`DELETE FROM notifications`);
  } else {
    await db.runAsync(`DELETE FROM notifications WHERE category = ?`, [filter]);
  }
  notifyListeners();
}

/**
 * Delete a batch of notifications by ids.
 */
export async function deleteMany(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await waitReady();
  const placeholders = ids.map(() => '?').join(',');
  await db.runAsync(`DELETE FROM notifications WHERE id IN (${placeholders})`, ids);
  notifyListeners();
}

/**
 * Mark a batch of notifications as read.
 */
export async function markManyAsRead(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await waitReady();
  const placeholders = ids.map(() => '?').join(',');
  await db.runAsync(`UPDATE notifications SET is_read = 1 WHERE id IN (${placeholders})`, ids);
  notifyListeners();
}

export default {
  addNotification,
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAll,
  deleteMany,
  markManyAsRead,
  subscribeToNotificationChanges,
};
