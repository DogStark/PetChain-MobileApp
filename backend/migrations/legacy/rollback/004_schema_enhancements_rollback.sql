-- Rollback 004: Schema Enhancements

-- ─── Remove indexes ───────────────────────────────────────────────────────────
DROP INDEX IF EXISTS idx_medications_status;
DROP INDEX IF EXISTS idx_medications_pet_id;
DROP INDEX IF EXISTS idx_appointments_date;
DROP INDEX IF EXISTS idx_appointments_vet_id;
DROP INDEX IF EXISTS idx_appointments_pet_id;
DROP INDEX IF EXISTS idx_medical_records_vet_id;
DROP INDEX IF EXISTS idx_medical_records_pet_id;
DROP INDEX IF EXISTS idx_pets_owner_id;

-- ─── Revert appointments constraints ─────────────────────────────────────────
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_type_check;

-- ─── Revert medications columns ───────────────────────────────────────────────
ALTER TABLE medications
  DROP COLUMN IF EXISTS duration_days,
  DROP COLUMN IF EXISTS instructions,
  DROP COLUMN IF EXISTS status;

-- ─── Revert medical_records columns ──────────────────────────────────────────
ALTER TABLE medical_records
  DROP COLUMN IF EXISTS blockchain_verified_at,
  DROP COLUMN IF EXISTS is_blockchain_verified,
  DROP COLUMN IF EXISTS blockchain_tx_hash,
  DROP COLUMN IF EXISTS documents,
  DROP COLUMN IF EXISTS vaccinations,
  DROP COLUMN IF EXISTS prescriptions,
  DROP COLUMN IF EXISTS treatment_details,
  DROP COLUMN IF EXISTS diagnosis_details;

-- ─── Revert pets columns ──────────────────────────────────────────────────────
ALTER TABLE pets
  DROP COLUMN IF EXISTS qr_code,
  DROP COLUMN IF EXISTS color,
  DROP COLUMN IF EXISTS gender,
  DROP COLUMN IF EXISTS weight;

-- ─── Revert users columns ─────────────────────────────────────────────────────
ALTER TABLE users DROP COLUMN IF EXISTS auth_provider;

-- ─── Remove version tracking ──────────────────────────────────────────────────
DELETE FROM schema_migrations WHERE version = 4;
DROP TABLE IF EXISTS schema_migrations;
