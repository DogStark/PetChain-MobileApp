-- Migration 005: Community Posts, Health Metrics, Emergency Contacts, Sync Queue
-- Adds tables for entities present in routes/models but missing from the schema.

-- ─── health_metrics ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS health_metrics (
  id          UUID PRIMARY KEY,
  pet_id      UUID NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  metric_type TEXT NOT NULL,   -- e.g. 'weight', 'temperature', 'heart_rate'
  value       NUMERIC(10, 4) NOT NULL,
  unit        TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_metrics_pet_id     ON health_metrics(pet_id);
CREATE INDEX IF NOT EXISTS idx_health_metrics_recorded_at ON health_metrics(recorded_at DESC);

-- ─── community_posts ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS community_posts (
  id          UUID PRIMARY KEY,
  author_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  tags        TEXT[],
  image_url   TEXT,
  likes_count INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_community_posts_author_id ON community_posts(author_id);
CREATE INDEX IF NOT EXISTS idx_community_posts_created_at ON community_posts(created_at DESC);

CREATE TRIGGER update_community_posts_updated_at
  BEFORE UPDATE ON community_posts
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ─── emergency_contacts ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS emergency_contacts (
  id           UUID PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  phone        TEXT NOT NULL,
  relationship TEXT,
  is_primary   BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_emergency_contacts_user_id ON emergency_contacts(user_id);

CREATE TRIGGER update_emergency_contacts_updated_at
  BEFORE UPDATE ON emergency_contacts
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ─── sync_queue ───────────────────────────────────────────────────────────────
-- Tracks offline mutations that need to be synced to the server.
CREATE TABLE IF NOT EXISTS sync_queue (
  id            UUID PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type   TEXT NOT NULL,   -- 'pet', 'medical_record', 'appointment', etc.
  entity_id     UUID NOT NULL,
  operation     TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
  payload       JSONB,
  status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_user_id ON sync_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_sync_queue_status  ON sync_queue(status);

CREATE TRIGGER update_sync_queue_updated_at
  BEFORE UPDATE ON sync_queue
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ─── Record this migration ────────────────────────────────────────────────────
INSERT INTO schema_migrations (version, name)
  VALUES (5, '005_community_and_health_metrics')
  ON CONFLICT (version) DO NOTHING;
