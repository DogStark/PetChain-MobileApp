-- Referral program attribution and premium credit ledger.

CREATE TABLE IF NOT EXISTS referral_codes (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code        TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referrals (
  id                  UUID PRIMARY KEY,
  referrer_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referral_code       TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'converted', 'blocked')),
  signup_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  converted_at        TIMESTAMPTZ,
  blocked_at          TIMESTAMPTZ,
  block_reason        TEXT,
  first_record_id     UUID,
  device_fingerprint  TEXT,
  ip_hash             TEXT,
  user_agent_hash     TEXT,
  CONSTRAINT referrals_no_self_referral CHECK (referrer_user_id <> referred_user_id),
  CONSTRAINT referrals_one_attribution_per_user UNIQUE (referred_user_id)
);

CREATE TABLE IF NOT EXISTS referral_credits (
  id           UUID PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referral_id  UUID NOT NULL REFERENCES referrals(id) ON DELETE CASCADE,
  credit_type  TEXT NOT NULL DEFAULT 'premium_days'
                 CHECK (credit_type IN ('premium_days')),
  amount       INTEGER NOT NULL CHECK (amount > 0),
  status       TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'redeemed', 'expired', 'revoked')),
  awarded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ,
  CONSTRAINT referral_credits_one_credit_per_referral UNIQUE (referral_id)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status);
CREATE INDEX IF NOT EXISTS idx_referrals_device ON referrals(referrer_user_id, device_fingerprint);
CREATE INDEX IF NOT EXISTS idx_referrals_ip ON referrals(referrer_user_id, ip_hash);
CREATE INDEX IF NOT EXISTS idx_referral_credits_user ON referral_credits(user_id, status);

COMMENT ON TABLE referrals IS 'Referral signup attribution and conversion status';
COMMENT ON TABLE referral_credits IS 'Ledger of premium subscription credits earned from referrals';
