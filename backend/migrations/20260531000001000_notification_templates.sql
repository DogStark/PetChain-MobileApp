-- Migration: 20260531000001_notification_templates
-- Description: Localized notification template storage

-- up migration
CREATE TABLE IF NOT EXISTS notification_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT NOT NULL,
  locale      TEXT NOT NULL DEFAULT 'en',
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (key, locale)
);

CREATE INDEX IF NOT EXISTS idx_notification_templates_key_locale
  ON notification_templates (key, locale);

CREATE TRIGGER update_notification_templates_updated_at
  BEFORE UPDATE ON notification_templates
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- down migration
DROP TRIGGER IF EXISTS update_notification_templates_updated_at ON notification_templates;
DROP INDEX IF EXISTS idx_notification_templates_key_locale;
DROP TABLE IF EXISTS notification_templates;
