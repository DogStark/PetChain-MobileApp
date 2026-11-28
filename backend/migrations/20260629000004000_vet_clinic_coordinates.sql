-- Migration: 20260629000004_vet_clinic_coordinates
-- Description: Geocoded latitude/longitude for vet clinics (#1396).
-- Addresses are geocoded on clinic create/update; existing clinics are
-- backfilled with backend/scripts/backfillVetCoordinates.ts.

-- up migration
ALTER TABLE IF EXISTS vets
  ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;

ALTER TABLE IF EXISTS vet_profiles
  ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;

DO $$
BEGIN
  IF to_regclass('public.vets') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_vets_lat_lng ON vets (lat, lng);
  END IF;
  IF to_regclass('public.vet_profiles') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_vet_profiles_lat_lng ON vet_profiles (lat, lng);
  END IF;
END $$;

-- down migration
DROP INDEX IF EXISTS idx_vet_profiles_lat_lng;
DROP INDEX IF EXISTS idx_vets_lat_lng;
ALTER TABLE IF EXISTS vet_profiles
  DROP COLUMN IF EXISTS lng,
  DROP COLUMN IF EXISTS lat;
ALTER TABLE IF EXISTS vets
  DROP COLUMN IF EXISTS lng,
  DROP COLUMN IF EXISTS lat;
