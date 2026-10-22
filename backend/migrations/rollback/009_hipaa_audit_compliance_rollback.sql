-- Rollback for HIPAA Audit Compliance Migration
-- Removes views and composite indexes added for audit compliance

-- Drop views created in 009_hipaa_audit_compliance.sql
DROP VIEW IF EXISTS audit_logs_medical_record_access;
DROP VIEW IF EXISTS audit_logs_medical_record_mutations;

-- Drop composite indexes (individual column indexes left intact)
DROP INDEX IF EXISTS idx_audit_logs_actor_resource_action;
DROP INDEX IF EXISTS idx_audit_logs_resource_date;

-- Note: The audit_logs table itself is NOT dropped, nor are core columns removed
-- to preserve historical audit data. Only views and composite indexes are removed.
