import type { SQLiteDatabase } from 'expo-sqlite';

import { computeMigrationChecksum } from '../sqliteMigrationRunner';
import type { SqliteMigration } from '../sqliteMigrationRunner';

const UP_SQL = `ALTER TABLE medications ADD COLUMN prescriber_info TEXT`;
const UP_SQL2 = `ALTER TABLE medications ADD COLUMN pharmacy_info TEXT`;

const migration: SqliteMigration = {
  version: '20260101000002',
  description: 'Add prescriber_info and pharmacy_info columns to medications',
  checksum: computeMigrationChecksum('20260101000002', UP_SQL + UP_SQL2),

  async up(db: SQLiteDatabase) {
    // SQLite ALTER TABLE only supports ADD COLUMN — use IF NOT EXISTS guard via try/catch
    try {
      await db.execAsync(UP_SQL);
    } catch {
      // Column already exists — idempotent
    }
    try {
      await db.execAsync(UP_SQL2);
    } catch {
      // Column already exists — idempotent
    }
  },

  async down(db: SQLiteDatabase) {
    // SQLite does not support DROP COLUMN before 3.35.0; recreate table without columns
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS medications_backup AS SELECT id, data FROM medications;
      DROP TABLE medications;
      ALTER TABLE medications_backup RENAME TO medications;
    `);
  },
};

export default migration;
