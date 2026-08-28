-- Pet insurance integration

CREATE TABLE IF NOT EXISTS insurance_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,  -- 'trupanion' | 'nationwide' | 'mock'
  policy_number TEXT NOT NULL,
  pet_id UUID REFERENCES pets(id),
  coverage_limit NUMERIC(10,2),
  deductible NUMERIC(10,2),
  premium NUMERIC(10,2),
  status TEXT NOT NULL DEFAULT 'active',
  expires_at DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS insurance_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id UUID NOT NULL REFERENCES insurance_policies(id),
  user_id UUID NOT NULL REFERENCES users(id),
  pet_id UUID REFERENCES pets(id),
  amount NUMERIC(10,2) NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted',  -- 'submitted' | 'under_review' | 'approved' | 'denied'
  attachment_urls TEXT[] DEFAULT '{}',
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claims_user ON insurance_claims(user_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_claims_policy ON insurance_claims(policy_id);

CREATE TRIGGER update_insurance_claims_updated_at
  BEFORE UPDATE ON insurance_claims
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
