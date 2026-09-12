-- Separate server capability grants. This migration grants nobody access.
CREATE TABLE server_showcase_grants (
  id TEXT PRIMARY KEY,
  linked_server_id TEXT NOT NULL CHECK (linked_server_id = '8741ac30-84ba-41e2-93e8-d584cdc81c89'),
  owner_user_id TEXT NOT NULL CHECK (owner_user_id = '7df55354-77b4-4f85-aee9-81d0e6deba0a'),
  owner_discord_id TEXT NOT NULL CHECK (owner_discord_id = '831243159785701398'),
  guild_id TEXT NOT NULL CHECK (guild_id = '1504922257481531402'),
  nitrado_service_id TEXT NOT NULL CHECK (nitrado_service_id = '18765761'),
  plan_key TEXT NOT NULL DEFAULT 'pro' CHECK (plan_key = 'pro'),
  purpose TEXT NOT NULL DEFAULT 'platform_owner_showcase' CHECK (purpose = 'platform_owner_showcase'),
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
  expires_at TEXT CHECK (expires_at IS NULL OR (julianday(expires_at) IS NOT NULL AND julianday(expires_at) > julianday(created_at))),
  revoked_at TEXT,
  revoked_by_user_id TEXT,
  revocation_reason TEXT,
  CHECK ((revoked_at IS NULL AND revoked_by_user_id IS NULL AND revocation_reason IS NULL)
    OR (julianday(revoked_at) IS NOT NULL AND revocation_reason IS NOT NULL
      AND revocation_reason IN ('owner_request', 'support_correction', 'association_changed', 'server_unavailable')))
);

CREATE UNIQUE INDEX idx_server_showcase_active ON server_showcase_grants(linked_server_id) WHERE revoked_at IS NULL;

CREATE TABLE server_showcase_grant_audit (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  grant_id TEXT NOT NULL,
  linked_server_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  owner_discord_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  nitrado_service_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('granted', 'revoked')),
  actor_user_id TEXT,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_server_showcase_audit_server ON server_showcase_grant_audit(linked_server_id, sequence DESC);

CREATE TRIGGER server_showcase_grant_initial_state BEFORE INSERT ON server_showcase_grants
WHEN NEW.revoked_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'new showcase grants cannot start revoked');
END;

CREATE TRIGGER server_showcase_grant_insert_audit AFTER INSERT ON server_showcase_grants
BEGIN
  INSERT INTO server_showcase_grant_audit (grant_id, linked_server_id, owner_user_id, owner_discord_id,
    guild_id, nitrado_service_id, action, actor_user_id, reason, created_at)
  VALUES (NEW.id, NEW.linked_server_id, NEW.owner_user_id, NEW.owner_discord_id, NEW.guild_id,
    NEW.nitrado_service_id, 'granted', NEW.created_by_user_id, NEW.purpose, NEW.created_at);
END;

CREATE TRIGGER server_showcase_grant_immutable BEFORE UPDATE ON server_showcase_grants
WHEN OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL
  OR NEW.id IS NOT OLD.id OR NEW.linked_server_id IS NOT OLD.linked_server_id
  OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.owner_discord_id IS NOT OLD.owner_discord_id
  OR NEW.guild_id IS NOT OLD.guild_id OR NEW.nitrado_service_id IS NOT OLD.nitrado_service_id
  OR NEW.plan_key IS NOT OLD.plan_key OR NEW.purpose IS NOT OLD.purpose
  OR NEW.created_by_user_id IS NOT OLD.created_by_user_id OR NEW.created_at IS NOT OLD.created_at
  OR NEW.expires_at IS NOT OLD.expires_at
BEGIN
  SELECT RAISE(ABORT, 'showcase grant is immutable; revoke and review a new grant');
END;

CREATE TRIGGER server_showcase_grant_revoke_audit AFTER UPDATE ON server_showcase_grants
BEGIN
  INSERT INTO server_showcase_grant_audit (grant_id, linked_server_id, owner_user_id, owner_discord_id,
    guild_id, nitrado_service_id, action, actor_user_id, reason, created_at)
  VALUES (NEW.id, NEW.linked_server_id, NEW.owner_user_id, NEW.owner_discord_id, NEW.guild_id,
    NEW.nitrado_service_id, 'revoked', NEW.revoked_by_user_id, NEW.revocation_reason, NEW.revoked_at);
END;

CREATE TRIGGER server_showcase_grant_no_delete BEFORE DELETE ON server_showcase_grants
BEGIN
  SELECT RAISE(ABORT, 'showcase grant history must be retained');
END;
CREATE TRIGGER server_showcase_audit_no_update BEFORE UPDATE ON server_showcase_grant_audit
BEGIN
  SELECT RAISE(ABORT, 'showcase audit is append-only');
END;
CREATE TRIGGER server_showcase_audit_no_delete BEFORE DELETE ON server_showcase_grant_audit
BEGIN
  SELECT RAISE(ABORT, 'showcase audit is append-only');
END;

-- A transfer away and back must not revive an old grant.
CREATE TRIGGER server_showcase_association_change AFTER UPDATE OF user_id, guild_id, nitrado_service_id, status ON linked_servers
BEGIN
  UPDATE server_showcase_grants SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    revocation_reason = 'association_changed'
  WHERE linked_server_id = NEW.id AND revoked_at IS NULL
    AND (owner_user_id IS NOT NEW.user_id OR guild_id IS NOT NEW.guild_id
      OR nitrado_service_id IS NOT NEW.nitrado_service_id
      OR lower(COALESCE(NEW.status, '')) IN ('deleted', 'merged', 'suspended'));
END;
-- This column is added by the existing metadata bootstrap on fresh installations.
CREATE TRIGGER server_showcase_merge_change AFTER UPDATE OF merged_into_server_id ON linked_servers
WHEN COALESCE(NEW.merged_into_server_id, '') != ''
BEGIN
  UPDATE server_showcase_grants SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    revocation_reason = 'association_changed'
  WHERE linked_server_id = NEW.id AND revoked_at IS NULL;
END;
CREATE TRIGGER server_showcase_server_delete BEFORE DELETE ON linked_servers
BEGIN
  UPDATE server_showcase_grants SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    revocation_reason = 'server_unavailable'
  WHERE linked_server_id = OLD.id AND revoked_at IS NULL;
END;
CREATE TRIGGER server_showcase_owner_identity_change AFTER UPDATE OF discord_id ON users
BEGIN
  UPDATE server_showcase_grants SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    revocation_reason = 'association_changed'
  WHERE owner_user_id = NEW.id AND owner_discord_id IS NOT NEW.discord_id AND revoked_at IS NULL;
END;
CREATE TRIGGER server_showcase_owner_delete BEFORE DELETE ON users
BEGIN
  UPDATE server_showcase_grants SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    revocation_reason = 'association_changed'
  WHERE owner_user_id = OLD.id AND revoked_at IS NULL;
END;
