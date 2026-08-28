-- Rollback for 006_audit_trail.sql

DROP TRIGGER IF EXISTS trg_audit_trail_no_delete ON audit_trail;
DROP TRIGGER IF EXISTS trg_audit_trail_no_update ON audit_trail;
DROP FUNCTION IF EXISTS audit_trail_immutable();
DROP TABLE IF EXISTS audit_trail;

