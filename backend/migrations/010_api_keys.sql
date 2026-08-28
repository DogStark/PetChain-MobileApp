-- API keys for third-party integrations (hashes only; plaintext never stored)

CREATE TABLE IF NOT EXISTS api_keys (
  id                      UUID PRIMARY KEY,
  name                    TEXT NOT NULL,
  key_prefix              TEXT NOT NULL,
  key_hash                TEXT NOT NULL,
  scopes                  TEXT[] NOT NULL DEFAULT '{}',
  status                  TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'rotating', 'revoked')),
  created_by              TEXT NOT NULL,
  expires_at              TIMESTAMPTZ,
  rotated_from_id         UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  rotation_overlap_ends_at TIMESTAMPTZ,
  last_used_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at              TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_key_prefix ON api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_status ON api_keys(status);
CREATE INDEX IF NOT EXISTS idx_api_keys_created_by ON api_keys(created_by);

COMMENT ON TABLE api_keys IS 'Third-party API keys; key_hash is bcrypt of the full secret';
COMMENT ON COLUMN api_keys.key_prefix IS 'Lookup prefix (first segment of issued key)';

-- Per-endpoint usage analytics
CREATE TABLE IF NOT EXISTS api_key_usage (
  id           UUID PRIMARY KEY,
  api_key_id   UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  endpoint     TEXT NOT NULL,
  method       TEXT NOT NULL,
  status_code  INTEGER NOT NULL DEFAULT 200,
  called_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_key_usage_key_id ON api_key_usage(api_key_id);
CREATE INDEX IF NOT EXISTS idx_api_key_usage_endpoint ON api_key_usage(endpoint);
CREATE INDEX IF NOT EXISTS idx_api_key_usage_called_at ON api_key_usage(called_at DESC);
