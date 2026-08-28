-- Migration 009: Vitals time-series table
-- Stores weight, temperature, heart_rate, and activity_level as discrete rows
-- with efficient time-series indexing.

CREATE TABLE IF NOT EXISTS vitals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pet_id       UUID NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  vital_type   TEXT NOT NULL CHECK (vital_type IN ('weight', 'temperature', 'heart_rate', 'activity_level')),
  value        NUMERIC(10, 4) NOT NULL,
  unit         TEXT NOT NULL,
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Primary time-series index: per-pet ordered by time descending
CREATE INDEX IF NOT EXISTS idx_vitals_pet_time
  ON vitals(pet_id, recorded_at DESC);

-- Secondary index for filtering by type within a pet
CREATE INDEX IF NOT EXISTS idx_vitals_pet_type_time
  ON vitals(pet_id, vital_type, recorded_at DESC);

-- Record this migration
INSERT INTO schema_migrations (version, name)
  VALUES (9, '009_vitals_timeseries')
  ON CONFLICT (version) DO NOTHING;
