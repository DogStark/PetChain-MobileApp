-- Migration: 20260629000002_data_retention
-- Description: Inactive-account data retention policy (#1400).
--   * retention_warning_sent_at   — when the inactivity warning email was sent
--   * deleted_at                  — soft-delete timestamp (account hidden/disabled)
--   * retention_soft_deleted_at   — soft-deleted by the retention policy; starts
--                                   the recovery window before permanent purge

-- up migration
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retention_warning_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retention_soft_deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_last_login_at ON users (last_login_at);
CREATE INDEX IF NOT EXISTS idx_users_retention_soft_deleted_at
  ON users (retention_soft_deleted_at)
  WHERE retention_soft_deleted_at IS NOT NULL;

-- down migration
DROP INDEX IF EXISTS idx_users_retention_soft_deleted_at;
DROP INDEX IF EXISTS idx_users_last_login_at;
ALTER TABLE users
  DROP COLUMN IF EXISTS retention_soft_deleted_at,
  DROP COLUMN IF EXISTS retention_warning_sent_at,
  DROP COLUMN IF EXISTS deleted_at;
