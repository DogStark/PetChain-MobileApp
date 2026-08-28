-- Migration: activity metrics and wearable provider/token storage
-- Creates tables for storing normalized activity metrics and provider tokens

CREATE TABLE IF NOT EXISTS wearable_providers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  key TEXT UNIQUE NOT NULL,
  config JSONB NOT NULL DEFAULT '{}' ,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wearable_tokens (
  id SERIAL PRIMARY KEY,
  pet_id TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  scope TEXT,
  expires_at TIMESTAMP WITH TIME ZONE,
  raw JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(provider_key, pet_id)
);

-- Time-series friendly activity table
CREATE TABLE IF NOT EXISTS activity_metrics (
  id BIGSERIAL PRIMARY KEY,
  pet_id TEXT NOT NULL,
  metric_type TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  unit TEXT,
  recorded_at TIMESTAMP WITH TIME ZONE NOT NULL,
  provider_key TEXT NOT NULL,
  provider_event_id TEXT,
  raw JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(provider_key, provider_event_id) -- prevents duplicate imports when provider_event_id is present
);

CREATE INDEX IF NOT EXISTS idx_activity_pet_time ON activity_metrics (pet_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_metric_time ON activity_metrics (metric_type, recorded_at DESC);
