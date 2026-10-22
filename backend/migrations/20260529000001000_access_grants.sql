-- Migration: 20260529000001_access_grants
-- Description: RBAC-based veterinary sharing system — access_grants table

-- up migration
CREATE TABLE IF NOT EXISTS access_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grantee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pet_id UUID NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('vet-read', 'vet-write', 'emergency-contact')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT no_self_grant CHECK (owner_id <> grantee_id)
);

CREATE INDEX IF NOT EXISTS idx_access_grants_owner_id ON access_grants(owner_id);
CREATE INDEX IF NOT EXISTS idx_access_grants_grantee_id ON access_grants(grantee_id);
CREATE INDEX IF NOT EXISTS idx_access_grants_pet_id ON access_grants(pet_id);
CREATE INDEX IF NOT EXISTS idx_access_grants_token_hash ON access_grants(token_hash);

CREATE TRIGGER update_access_grants_updated_at
  BEFORE UPDATE ON access_grants
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Enhance audit_logs with actor_email and outcome columns (idempotent)
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS actor_email TEXT,
  ADD COLUMN IF NOT EXISTS role TEXT,
  ADD COLUMN IF NOT EXISTS outcome TEXT NOT NULL DEFAULT 'success';

-- down migration
DROP TRIGGER IF EXISTS update_access_grants_updated_at ON access_grants;
DROP INDEX IF EXISTS idx_access_grants_token_hash;
DROP INDEX IF EXISTS idx_access_grants_pet_id;
DROP INDEX IF EXISTS idx_access_grants_grantee_id;
DROP INDEX IF EXISTS idx_access_grants_owner_id;
DROP TABLE IF EXISTS access_grants;
