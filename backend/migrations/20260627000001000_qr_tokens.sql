-- Migration: 20260627000001_qr_tokens
-- Description: QR code expiry, one-time-use and revocation support

-- up migration
CREATE TABLE IF NOT EXISTS qr_tokens (
  token TEXT PRIMARY KEY,
  pet_id UUID NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ,
  one_time_use BOOLEAN NOT NULL DEFAULT FALSE,
  usage_count INTEGER NOT NULL DEFAULT 0,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qr_tokens_pet_id ON qr_tokens(pet_id);
CREATE INDEX IF NOT EXISTS idx_qr_tokens_owner_id ON qr_tokens(owner_id);

-- down migration
DROP INDEX IF EXISTS idx_qr_tokens_owner_id;
DROP INDEX IF EXISTS idx_qr_tokens_pet_id;
DROP TABLE IF EXISTS qr_tokens;
