import type { SQLiteDatabase } from 'expo-sqlite';

import { computeMigrationChecksum } from '../sqliteMigrationRunner';
import type { SqliteMigration } from '../sqliteMigrationRunner';

const UP_SQL = `
      CREATE TABLE IF NOT EXISTS health_thresholds (
        id TEXT PRIMARY KEY NOT NULL,
        pet_id TEXT NOT NULL,
        weight_min REAL,
        weight_max REAL,
        temperature_min REAL,
        temperature_max REAL,
        heart_rate_min INTEGER,
        heart_rate_max INTEGER,
        activity_min REAL,
        activity_max REAL,
        locked_by_vet INTEGER DEFAULT 0,
        updated_by TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `;

const migration: SqliteMigration = {
  version: '20260527000001',
  description: 'Create health_thresholds table',
  checksum: computeMigrationChecksum('20260527000001', UP_SQL),

  async up(db: SQLiteDatabase) {
    await db.execAsync(UP_SQL);
  },

  async down(db: SQLiteDatabase) {
    await db.execAsync(`DROP TABLE IF EXISTS health_thresholds`);
  },
};

export default migration;
