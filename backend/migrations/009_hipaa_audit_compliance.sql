-- HIPAA-Equivalent Audit Compliance Migration
-- Ensures audit_logs table has all required fields for access tracking
-- This migration is idempotent and safe to run on existing deployments

-- Verify audit_logs table exists with all required columns
-- If table doesn't exist, create it with full schema
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY,
  actor_id TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  meta JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure indexes exist for query performance
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_type ON audit_logs(resource_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_id ON audit_logs(resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- Composite index for common query patterns (user + resource + action)
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_resource_action 
  ON audit_logs(actor_id, resource_type, action, created_at DESC);

-- Composite index for compliance queries (resource + date range)
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_date 
  ON audit_logs(resource_type, resource_id, created_at DESC);

-- Add columns if they don't exist (for existing deployments)
-- These commands are no-op if columns already exist
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_agent TEXT;

-- Create audit logs view for easier querying of access events
CREATE OR REPLACE VIEW audit_logs_medical_record_access AS
SELECT 
  id,
  actor_id,
  actor_email,
  action,
  resource_id,
  meta,
  ip_address,
  user_agent,
  created_at
FROM audit_logs
WHERE resource_type = 'medical_record' 
  AND action = 'medical_record.accessed'
ORDER BY created_at DESC;

-- Create audit logs view for all mutations (complements READ tracking)
CREATE OR REPLACE VIEW audit_logs_medical_record_mutations AS
SELECT 
  id,
  actor_id,
  actor_email,
  action,
  resource_id,
  meta,
  ip_address,
  user_agent,
  created_at
FROM audit_logs
WHERE resource_type = 'medical_record' 
  AND action IN ('medical_record.created', 'medical_record.updated', 'medical_record.deleted')
ORDER BY created_at DESC;
