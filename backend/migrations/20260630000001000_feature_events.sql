-- Migration: 20260630000001_feature_events
-- Description: Feature usage events backing the admin activity analytics
--   endpoint (GET /admin/analytics/activity, #1371).

-- up migration
CREATE TABLE IF NOT EXISTS feature_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  feature TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feature_events_occurred_at
  ON feature_events (occurred_at);

CREATE INDEX IF NOT EXISTS idx_feature_events_feature_occurred_at
  ON feature_events (feature, occurred_at);

CREATE INDEX IF NOT EXISTS idx_feature_events_user_occurred_at
  ON feature_events (user_id, occurred_at);

-- down migration
DROP INDEX IF EXISTS idx_feature_events_user_occurred_at;
DROP INDEX IF EXISTS idx_feature_events_feature_occurred_at;
DROP INDEX IF EXISTS idx_feature_events_occurred_at;
DROP TABLE IF EXISTS feature_events;
