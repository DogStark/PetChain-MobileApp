-- Migration 009: Family Sharing with Role-Based Permissions
-- Adds tables for family groups, members, pet access, and activity feeds

-- ─── family_groups ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS family_groups (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_family_groups_owner_id ON family_groups(owner_id);

CREATE TRIGGER update_family_groups_updated_at
  BEFORE UPDATE ON family_groups
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ─── family_members ───────────────────────────────────────────────────────────
-- Tracks family membership with roles and invitation status
CREATE TABLE IF NOT EXISTS family_members (
  id UUID PRIMARY KEY,
  family_group_id UUID NOT NULL REFERENCES family_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'caregiver', 'viewer')),
  invited_by UUID REFERENCES users(id),
  invited_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(family_group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_family_members_family_group_id ON family_members(family_group_id);
CREATE INDEX IF NOT EXISTS idx_family_members_user_id ON family_members(user_id);
CREATE INDEX IF NOT EXISTS idx_family_members_status ON family_members(status);

CREATE TRIGGER update_family_members_updated_at
  BEFORE UPDATE ON family_members
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ─── pet_access_permissions ───────────────────────────────────────────────────
-- Tracks who has access to each pet and their permission level
CREATE TABLE IF NOT EXISTS pet_access_permissions (
  id UUID PRIMARY KEY,
  pet_id UUID NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_level TEXT NOT NULL CHECK (permission_level IN ('viewer', 'caregiver', 'admin')),
  granted_by UUID NOT NULL REFERENCES users(id),
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pet_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_pet_access_permissions_pet_id ON pet_access_permissions(pet_id);
CREATE INDEX IF NOT EXISTS idx_pet_access_permissions_user_id ON pet_access_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_pet_access_permissions_expires_at ON pet_access_permissions(expires_at);

CREATE TRIGGER update_pet_access_permissions_updated_at
  BEFORE UPDATE ON pet_access_permissions
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ─── family_activity_feed ─────────────────────────────────────────────────────
-- Tracks all changes made by family members for activity feed
CREATE TABLE IF NOT EXISTS family_activity_feed (
  id UUID PRIMARY KEY,
  family_group_id UUID NOT NULL REFERENCES family_groups(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,
  pet_id UUID REFERENCES pets(id) ON DELETE SET NULL,
  description TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_family_activity_feed_family_group_id ON family_activity_feed(family_group_id);
CREATE INDEX IF NOT EXISTS idx_family_activity_feed_actor_id ON family_activity_feed(actor_id);
CREATE INDEX IF NOT EXISTS idx_family_activity_feed_created_at ON family_activity_feed(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_family_activity_feed_pet_id ON family_activity_feed(pet_id);

-- ─── family_invitations ───────────────────────────────────────────────────────
-- Tracks pending invitations with secure tokens
CREATE TABLE IF NOT EXISTS family_invitations (
  id UUID PRIMARY KEY,
  family_group_id UUID NOT NULL REFERENCES family_groups(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL,
  invited_by UUID NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('admin', 'caregiver', 'viewer')),
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_by UUID REFERENCES users(id),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_family_invitations_family_group_id ON family_invitations(family_group_id);
CREATE INDEX IF NOT EXISTS idx_family_invitations_invited_email ON family_invitations(invited_email);
CREATE INDEX IF NOT EXISTS idx_family_invitations_token ON family_invitations(token);
CREATE INDEX IF NOT EXISTS idx_family_invitations_status ON family_invitations(status);
CREATE INDEX IF NOT EXISTS idx_family_invitations_expires_at ON family_invitations(expires_at);

CREATE TRIGGER update_family_invitations_updated_at
  BEFORE UPDATE ON family_invitations
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ─── pet_ownership_transfer ───────────────────────────────────────────────────
-- Tracks pet ownership transfers for audit trail
CREATE TABLE IF NOT EXISTS pet_ownership_transfer (
  id UUID PRIMARY KEY,
  pet_id UUID NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  from_user_id UUID NOT NULL REFERENCES users(id),
  to_user_id UUID NOT NULL REFERENCES users(id),
  transferred_by UUID NOT NULL REFERENCES users(id),
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pet_ownership_transfer_pet_id ON pet_ownership_transfer(pet_id);
CREATE INDEX IF NOT EXISTS idx_pet_ownership_transfer_from_user_id ON pet_ownership_transfer(from_user_id);
CREATE INDEX IF NOT EXISTS idx_pet_ownership_transfer_to_user_id ON pet_ownership_transfer(to_user_id);

-- ─── Update audit actions ─────────────────────────────────────────────────────
-- Add new audit actions to the AuditLog model
-- (This is handled in the TypeScript model, not in SQL)

-- ─── Record this migration ────────────────────────────────────────────────────
INSERT INTO schema_migrations (version, name)
  VALUES (9, '009_family_sharing')
  ON CONFLICT (version) DO NOTHING;
