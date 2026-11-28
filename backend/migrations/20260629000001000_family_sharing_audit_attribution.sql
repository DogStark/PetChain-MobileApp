-- Migration: 20260629000001_family_sharing_audit_attribution
-- Description: Attribute family-sharing (co-owner) actions in the audit trail
-- and track when each pet access grant was last used (#1398).
-- Complements 009_family_sharing.sql for databases where it is already applied.

-- up migration
ALTER TABLE IF EXISTS audit_trail
  ADD COLUMN IF NOT EXISTS acting_user_id UUID,
  ADD COLUMN IF NOT EXISTS on_behalf_of_user_id UUID;

CREATE INDEX IF NOT EXISTS idx_audit_trail_on_behalf_of
  ON audit_trail (on_behalf_of_user_id, created_at DESC);

ALTER TABLE IF EXISTS pet_access_permissions
  ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ;

ALTER TABLE IF EXISTS family_activity_feed
  ADD COLUMN IF NOT EXISTS acting_user_id UUID,
  ADD COLUMN IF NOT EXISTS on_behalf_of_user_id UUID,
  ADD COLUMN IF NOT EXISTS grant_id UUID;

CREATE INDEX IF NOT EXISTS idx_family_activity_feed_grant_id
  ON family_activity_feed (grant_id, created_at DESC);

-- down migration
DROP INDEX IF EXISTS idx_family_activity_feed_grant_id;
ALTER TABLE IF EXISTS family_activity_feed
  DROP COLUMN IF EXISTS grant_id,
  DROP COLUMN IF EXISTS on_behalf_of_user_id,
  DROP COLUMN IF EXISTS acting_user_id;
ALTER TABLE IF EXISTS pet_access_permissions
  DROP COLUMN IF EXISTS last_accessed_at;
DROP INDEX IF EXISTS idx_audit_trail_on_behalf_of;
ALTER TABLE IF EXISTS audit_trail
  DROP COLUMN IF EXISTS on_behalf_of_user_id,
  DROP COLUMN IF EXISTS acting_user_id;
