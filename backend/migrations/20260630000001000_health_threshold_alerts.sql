-- Migration: 20260630000001_health_threshold_alerts
-- Description: In-app alerts fired when a pet's vitals breach a user-configured
-- health threshold. The unique index enforces at most one alert per pet,
-- threshold metric and hour (deduplication for the evaluation job).

-- up migration
CREATE TABLE IF NOT EXISTS health_threshold_alerts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pet_id       UUID NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  owner_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  threshold_id UUID REFERENCES health_thresholds(id) ON DELETE SET NULL,
  metric       TEXT NOT NULL CHECK (metric IN ('weight', 'temperature', 'heart_rate', 'activity_level')),
  direction    TEXT NOT NULL CHECK (direction IN ('below_min', 'above_max')),
  value        NUMERIC(10, 4) NOT NULL,
  threshold_value NUMERIC(10, 4) NOT NULL,
  vital_id     UUID REFERENCES vitals(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  is_read      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_threshold_alerts_owner_created
  ON health_threshold_alerts(owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_health_threshold_alerts_pet_created
  ON health_threshold_alerts(pet_id, created_at DESC);

-- Deduplication: one alert per pet + metric + direction per hour.
CREATE UNIQUE INDEX IF NOT EXISTS idx_health_threshold_alerts_hourly_unique
  ON health_threshold_alerts(pet_id, metric, direction, date_trunc('hour', created_at));

-- down migration
DROP INDEX IF EXISTS idx_health_threshold_alerts_hourly_unique;
DROP INDEX IF EXISTS idx_health_threshold_alerts_pet_created;
DROP INDEX IF EXISTS idx_health_threshold_alerts_owner_created;
DROP TABLE IF EXISTS health_threshold_alerts;
