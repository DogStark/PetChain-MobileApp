-- Migration: 20260627000001_users_preferred_language
-- Description: Add preferred_language to users so notifications can be localized

-- up migration
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS preferred_language TEXT NOT NULL DEFAULT 'en';

-- down migration
ALTER TABLE users
  DROP COLUMN IF EXISTS preferred_language;
