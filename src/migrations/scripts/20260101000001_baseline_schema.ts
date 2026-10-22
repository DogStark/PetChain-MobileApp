import type { SQLiteDatabase } from 'expo-sqlite';

import { computeMigrationChecksum } from '../sqliteMigrationRunner';
import type { SqliteMigration } from '../sqliteMigrationRunner';

const UP_SQL = `
      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS medications (
        id TEXT PRIMARY KEY NOT NULL,
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS dose_logs (
        id TEXT PRIMARY KEY NOT NULL,
        medication_id TEXT,
        taken_at TEXT,
        skipped INTEGER,
        notes TEXT,
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS health_metrics (
        id TEXT PRIMARY KEY NOT NULL,
        pet_id TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        data TEXT NOT NULL
      );
    `;

const migration: SqliteMigration = {
  version: '20260101000001',
  description: 'Baseline schema — kv_store, medications, dose_logs, health_metrics',
  checksum: computeMigrationChecksum('20260101000001', UP_SQL),

  async up(db: SQLiteDatabase) {
    await db.execAsync(UP_SQL);
  },

  async down(db: SQLiteDatabase) {
    await db.execAsync(`
      DROP TABLE IF EXISTS health_metrics;
      DROP TABLE IF EXISTS dose_logs;
      DROP TABLE IF EXISTS medications;
      DROP TABLE IF EXISTS kv_store;
    `);
  },
};

export default migration;
