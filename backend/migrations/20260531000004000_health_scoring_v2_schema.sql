-- Create species_health_weights table to store ML-derived weights
CREATE TABLE IF NOT EXISTS species_health_weights (
  id VARCHAR(255) PRIMARY KEY,
  species VARCHAR(100) NOT NULL,
  breed VARCHAR(100),
  weights JSONB NOT NULL,
  data_points INTEGER DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create index for weight lookups
CREATE INDEX IF NOT EXISTS idx_shw_species_breed ON species_health_weights(species, breed);

-- Create health_factor_history table for storing individual factor scores over time
CREATE TABLE IF NOT EXISTS health_factor_history (
  id BIGSERIAL PRIMARY KEY,
  pet_id VARCHAR(255) NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  species VARCHAR(100) NOT NULL,
  breed VARCHAR(100),
  factor_name VARCHAR(100) NOT NULL,
  factor_value DECIMAL(5, 2) NOT NULL,
  recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for factor history queries
CREATE INDEX IF NOT EXISTS idx_hfh_pet_id ON health_factor_history(pet_id);
CREATE INDEX IF NOT EXISTS idx_hfh_species ON health_factor_history(species);
CREATE INDEX IF NOT EXISTS idx_hfh_factor ON health_factor_history(factor_name);
CREATE INDEX IF NOT EXISTS idx_hfh_recorded_at ON health_factor_history(recorded_at);

-- Create health_score_history table to track scores over time
CREATE TABLE IF NOT EXISTS health_score_history (
  id BIGSERIAL PRIMARY KEY,
  pet_id VARCHAR(255) NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  v1_score INTEGER,
  v2_score INTEGER,
  v2_explanation JSONB,
  confidence_min INTEGER,
  confidence_max INTEGER,
  calculated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for score history queries
CREATE INDEX IF NOT EXISTS idx_hsh_pet_id ON health_score_history(pet_id);
CREATE INDEX IF NOT EXISTS idx_hsh_calculated_at ON health_score_history(calculated_at);

-- Create health_score_comparison table for A/B testing
CREATE TABLE IF NOT EXISTS health_score_comparison (
  id VARCHAR(255) PRIMARY KEY,
  pet_id VARCHAR(255) NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  v1_score INTEGER NOT NULL,
  v2_score INTEGER NOT NULL,
  score_difference INTEGER,
  algorithm_preference VARCHAR(10),
  satisfaction_rating INTEGER,
  feedback TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create index for A/B testing queries
CREATE INDEX IF NOT EXISTS idx_hsc_user_id ON health_score_comparison(user_id);
CREATE INDEX IF NOT EXISTS idx_hsc_created_at ON health_score_comparison(created_at);
