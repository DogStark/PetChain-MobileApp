-- Migration: 20260625000002_push_receipts
-- Description: Create push_notification_receipts table for delivery receipt tracking

-- up migration
CREATE TABLE IF NOT EXISTS push_notification_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receipt_id TEXT,
  token TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  topic TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_code TEXT,
  error_message TEXT,
  is_critical BOOLEAN DEFAULT FALSE,
  sms_fallback_attempted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  checked_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_push_receipts_status ON push_notification_receipts(status);
CREATE INDEX IF NOT EXISTS idx_push_receipts_user_id ON push_notification_receipts(user_id);
CREATE INDEX IF NOT EXISTS idx_push_receipts_created_at ON push_notification_receipts(created_at);

-- down migration
DROP TABLE IF EXISTS push_notification_receipts;
