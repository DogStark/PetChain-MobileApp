-- Predictive health alerts generated from anonymized vitals ML predictions.

CREATE TABLE IF NOT EXISTS health_prediction_alerts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pet_id                UUID NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  owner_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  predicted_issue       TEXT NOT NULL,
  risk_score            NUMERIC(5, 4) NOT NULL CHECK (risk_score >= 0 AND risk_score <= 1),
  risk_level            TEXT NOT NULL CHECK (risk_level IN ('medium', 'high')),
  contributing_factors  TEXT[] NOT NULL DEFAULT '{}',
  model_version         TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dismissed')),
  feedback              TEXT CHECK (feedback IN ('helpful', 'not_helpful', 'already_known', 'false_alarm')),
  feedback_notes        TEXT,
  dismissed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_prediction_alerts_owner_status
  ON health_prediction_alerts(owner_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_health_prediction_alerts_pet_status
  ON health_prediction_alerts(pet_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_health_prediction_alerts_active_unique
  ON health_prediction_alerts(pet_id, predicted_issue)
  WHERE status = 'active';

COMMENT ON TABLE health_prediction_alerts IS
  'Predictive health alerts with explainability factors and dismissal feedback for model improvement';

INSERT INTO schema_migrations (version, name)
  VALUES (12, '012_predictive_health_alerts')
  ON CONFLICT (version) DO NOTHING;
