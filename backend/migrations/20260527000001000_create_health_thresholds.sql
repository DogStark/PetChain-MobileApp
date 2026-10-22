-- Migration: 20260527000001_create_health_thresholds
-- Description: Health threshold configuration per pet

CREATE TABLE IF NOT EXISTS health_thresholds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pet_id UUID NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  weight_min NUMERIC,
  weight_max NUMERIC,
  temperature_min NUMERIC,
  temperature_max NUMERIC,
  heart_rate_min INTEGER,
  heart_rate_max INTEGER,
  activity_min NUMERIC,
  activity_max NUMERIC,
  locked_by_vet BOOLEAN DEFAULT FALSE,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER update_health_thresholds_updated_at BEFORE UPDATE ON health_thresholds FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- down migration
DROP TRIGGER IF EXISTS update_health_thresholds_updated_at ON health_thresholds;
DROP TABLE IF EXISTS health_thresholds;
