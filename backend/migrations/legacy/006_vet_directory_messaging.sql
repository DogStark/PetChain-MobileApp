-- Vet directory and in-app messaging

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS vet_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  specialty TEXT NOT NULL DEFAULT 'General',
  credentials TEXT,
  accepted_insurance TEXT[] DEFAULT '{}',
  rating NUMERIC(3,2) DEFAULT 0,
  review_count INTEGER DEFAULT 0,
  available BOOLEAN DEFAULT TRUE,
  location GEOGRAPHY(POINT, 4326),
  address TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vet_profiles_location ON vet_profiles USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_vet_profiles_specialty ON vet_profiles(specialty);
CREATE INDEX IF NOT EXISTS idx_vet_profiles_available ON vet_profiles(available);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL,
  sender_id UUID NOT NULL REFERENCES users(id),
  recipient_id UUID NOT NULL REFERENCES users(id),
  content TEXT,
  attachment_url TEXT,
  attachment_type TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_id, read_at);

CREATE TRIGGER update_vet_profiles_updated_at
  BEFORE UPDATE ON vet_profiles
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
