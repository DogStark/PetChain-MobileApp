-- Audit Trail Schema for PetChain (append-only, immutable)

CREATE TABLE IF NOT EXISTS audit_trail (
  id UUID PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'DELETE')),
  before_data JSONB,
  after_data JSONB,
  changed_by UUID,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes to support fast history queries & exports
CREATE INDEX IF NOT EXISTS idx_audit_trail_entity ON audit_trail(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_trail_changed_by ON audit_trail(changed_by);
CREATE INDEX IF NOT EXISTS idx_audit_trail_created_at ON audit_trail(created_at DESC);

-- Enforce immutability: no UPDATE/DELETE allowed
CREATE OR REPLACE FUNCTION audit_trail_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_trail is append-only and immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_trail_no_update ON audit_trail;
CREATE TRIGGER trg_audit_trail_no_update
BEFORE UPDATE ON audit_trail
FOR EACH ROW EXECUTE PROCEDURE audit_trail_immutable();

DROP TRIGGER IF EXISTS trg_audit_trail_no_delete ON audit_trail;
CREATE TRIGGER trg_audit_trail_no_delete
BEFORE DELETE ON audit_trail
FOR EACH ROW EXECUTE PROCEDURE audit_trail_immutable();

