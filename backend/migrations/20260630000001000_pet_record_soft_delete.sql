-- Migration: 20260630000001_pet_record_soft_delete
-- Description: Soft-delete for pets and medical records (#1349).
--   * deleted_at — when the row was soft-deleted; NULL means active.
--   Rows are hard-purged by the weekly purge job 30 days after deletion.

-- up migration
ALTER TABLE pets
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE medical_records
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_pets_deleted_at
  ON pets (deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_medical_records_deleted_at
  ON medical_records (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- down migration
DROP INDEX IF EXISTS idx_medical_records_deleted_at;
DROP INDEX IF EXISTS idx_pets_deleted_at;
ALTER TABLE medical_records DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE pets DROP COLUMN IF EXISTS deleted_at;
