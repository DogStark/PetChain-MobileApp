-- Migration 004: Schema Enhancements
-- Adds missing columns, indexes, and constraints to align SQL schema with TypeScript models.

-- ─── schema_migrations version tracking ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  applied_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── users: add auth_provider ─────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'local'
    CHECK (auth_provider IN ('local', 'google', 'apple'));

-- ─── pets: add weight, gender, color ─────────────────────────────────────────
ALTER TABLE pets
  ADD COLUMN IF NOT EXISTS weight       NUMERIC(6, 2),
  ADD COLUMN IF NOT EXISTS gender       TEXT CHECK (gender IN ('male', 'female')),
  ADD COLUMN IF NOT EXISTS color        TEXT,
  ADD COLUMN IF NOT EXISTS qr_code      TEXT;

-- ─── medical_records: add blockchain fields + rich data ───────────────────────
ALTER TABLE medical_records
  ADD COLUMN IF NOT EXISTS diagnosis_details  JSONB,
  ADD COLUMN IF NOT EXISTS treatment_details  JSONB,
  ADD COLUMN IF NOT EXISTS prescriptions      JSONB,
  ADD COLUMN IF NOT EXISTS vaccinations       JSONB,
  ADD COLUMN IF NOT EXISTS documents          JSONB,
  ADD COLUMN IF NOT EXISTS blockchain_tx_hash TEXT,
  ADD COLUMN IF NOT EXISTS is_blockchain_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS blockchain_verified_at TIMESTAMPTZ;

-- ─── medications: add status, instructions, duration_days ────────────────────
ALTER TABLE medications
  ADD COLUMN IF NOT EXISTS status        TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'completed', 'discontinued')),
  ADD COLUMN IF NOT EXISTS instructions  TEXT,
  ADD COLUMN IF NOT EXISTS duration_days INTEGER;

-- Update existing rows: derive active boolean → status
UPDATE medications SET status = CASE WHEN active THEN 'active' ELSE 'completed' END
  WHERE status = 'active' AND active IS NOT NULL;

-- ─── appointments: align enum values ─────────────────────────────────────────
-- Widen type/status columns to accept the full enum set from the TypeScript model.
-- Existing CHECK constraints are dropped and re-added with the full value sets.
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_type_check;

ALTER TABLE appointments
  ADD CONSTRAINT appointments_status_check
    CHECK (status IN ('PENDING','CONFIRMED','CANCELLED','COMPLETED','NO_SHOW','RESCHEDULED')),
  ADD CONSTRAINT appointments_type_check
    CHECK (type IN (
      'ROUTINE_CHECKUP','VACCINATION','SURGERY','DENTAL','GROOMING',
      'EMERGENCY','FOLLOW_UP','DIAGNOSTIC','SPECIALIST_REFERRAL','NUTRITION_CONSULTATION'
    ));

-- ─── Performance indexes ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pets_owner_id          ON pets(owner_id);
CREATE INDEX IF NOT EXISTS idx_medical_records_pet_id ON medical_records(pet_id);
CREATE INDEX IF NOT EXISTS idx_medical_records_vet_id ON medical_records(vet_id);
CREATE INDEX IF NOT EXISTS idx_appointments_pet_id    ON appointments(pet_id);
CREATE INDEX IF NOT EXISTS idx_appointments_vet_id    ON appointments(vet_id);
CREATE INDEX IF NOT EXISTS idx_appointments_date      ON appointments(date);
CREATE INDEX IF NOT EXISTS idx_medications_pet_id     ON medications(pet_id);
CREATE INDEX IF NOT EXISTS idx_medications_status     ON medications(status);

-- ─── Record this migration ────────────────────────────────────────────────────
INSERT INTO schema_migrations (version, name)
  VALUES (4, '004_schema_enhancements')
  ON CONFLICT (version) DO NOTHING;
