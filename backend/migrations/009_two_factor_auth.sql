-- Migration: Add TOTP-based 2FA fields to users table

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS two_factor_enabled      BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS two_factor_secret        TEXT,          -- encrypted TOTP secret
  ADD COLUMN IF NOT EXISTS two_factor_backup_codes  TEXT[],        -- bcrypt-hashed backup codes
  ADD COLUMN IF NOT EXISTS two_factor_pending_secret TEXT,         -- secret during setup (pre-confirm)
  ADD COLUMN IF NOT EXISTS recovery_token           TEXT,          -- bcrypt-hashed recovery token
  ADD COLUMN IF NOT EXISTS recovery_token_expires_at TIMESTAMPTZ; -- expiry for recovery token

-- Index to speed up recovery-by-email lookups
CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email));

COMMENT ON COLUMN users.two_factor_enabled       IS 'Whether TOTP 2FA is active for this account';
COMMENT ON COLUMN users.two_factor_secret        IS 'TOTP secret (store encrypted at rest)';
COMMENT ON COLUMN users.two_factor_backup_codes  IS 'Array of bcrypt-hashed single-use backup codes';
COMMENT ON COLUMN users.recovery_token           IS 'bcrypt-hashed account-recovery token';
COMMENT ON COLUMN users.recovery_token_expires_at IS 'Expiry timestamp for the recovery token';
