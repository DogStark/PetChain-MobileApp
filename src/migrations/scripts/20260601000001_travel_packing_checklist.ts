import type { SQLiteMigration } from '../types';

/**
 * Migration: travel_packing_checklist
 *
 * Creates the `travel_packing_checklists` table used to persist per-trip
 * packing checklist progress locally. The serialized checklist JSON is stored
 * in the `payload` column so template edits (adding/removing categories or
 * items) do not require schema changes.
 *
 * Sync metadata (`sync_status`, `updated_at`) supports safe, server-confirmed
 * synchronization while preserving offline behavior.
 */
const migration: SQLiteMigration = {
  version: '20260601000001',
  name: 'travel_packing_checklist',

  async up(db): Promise<void> {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS travel_packing_checklists (
        id TEXT PRIMARY KEY,
        pet_id TEXT NOT NULL,
        trip_id TEXT NOT NULL,
        trip_name TEXT,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        UNIQUE (pet_id, trip_id)
      );
    `);

    await db.execute(`
      CREATE INDEX IF NOT EXISTS idx_travel_packing_checklists_pet_trip
        ON travel_packing_checklists (pet_id, trip_id);
    `);
  },

  async down(db): Promise<void> {
    await db.execute(`
      DROP INDEX IF EXISTS idx_travel_packing_checklists_pet_trip;
    `);

    await db.execute(`
      DROP TABLE IF EXISTS travel_packing_checklists;
    `);
  },
};

export default migration;