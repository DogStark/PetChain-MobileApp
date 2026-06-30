-- Migration: 20260625000001_user_chat_public_key
-- Description: Add E2E encryption public key fields to users table for telemedicine chat (issue #578)

-- up migration
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS chat_public_key TEXT,
  ADD COLUMN IF NOT EXISTS chat_public_key_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN users.chat_public_key IS
  'Hex-encoded ECDH (P-256) public key used for E2E-encrypted telemedicine chat. Set per device; updated on key rotation.';

COMMENT ON COLUMN users.chat_public_key_updated_at IS
  'Timestamp of the most recent chat key upload (device change or key rotation).';

-- down migration
ALTER TABLE users
  DROP COLUMN IF EXISTS chat_public_key,
  DROP COLUMN IF EXISTS chat_public_key_updated_at;
