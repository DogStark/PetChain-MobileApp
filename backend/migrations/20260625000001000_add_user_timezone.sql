-- Migration: 20260625000001_add_user_timezone
-- Description: Add timezone column to users table for locale-aware notification scheduling

-- up migration
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'UTC';

-- down migration
ALTER TABLE users DROP COLUMN IF EXISTS timezone;
