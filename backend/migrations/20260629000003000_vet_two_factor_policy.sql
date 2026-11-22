-- Migration: 20260629000003_vet_two_factor_policy
-- Description: Mandatory 2FA for vet accounts (#1394). Records when each vet's
-- grace period started so enforcement begins after VET_2FA_GRACE_DAYS.
-- Complements 009_two_factor_auth.sql for databases where it is already applied.

-- up migration
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS two_factor_grace_started_at TIMESTAMPTZ;

COMMENT ON COLUMN users.two_factor_grace_started_at IS
  'When the vet 2FA enforcement grace period started (NULL = not started)';

-- down migration
ALTER TABLE users DROP COLUMN IF EXISTS two_factor_grace_started_at;
