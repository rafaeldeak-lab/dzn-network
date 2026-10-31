-- Additive, inactive Vault cabinets. No purchase, payment, reward schedule or
-- production feature is enabled by this migration. Gameplay tables are untouched.

CREATE TABLE dzn_vault_grants (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('player', 'server')),
  scope_id TEXT NOT NULL CHECK (length(scope_id) BETWEEN 1 AND 128),
  item_id TEXT NOT NULL CHECK (length(item_id) BETWEEN 1 AND 128),
  source_type TEXT NOT NULL CHECK (source_type IN ('welcome', 'earned')),
  source_key TEXT NOT NULL CHECK (length(source_key) BETWEEN 1 AND 200),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reversed')),
  granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reversed_at TEXT,
  UNIQUE(scope_type, scope_id, item_id),
  UNIQUE(scope_type, scope_id, source_key),
  CHECK ((status = 'active' AND reversed_at IS NULL) OR (status = 'reversed' AND reversed_at IS NOT NULL))
);

CREATE INDEX idx_dzn_vault_grants_scope ON dzn_vault_grants(scope_type, scope_id, status, granted_at);

CREATE TRIGGER dzn_vault_grant_owner_exists BEFORE INSERT ON dzn_vault_grants
WHEN (NEW.scope_type = 'player' AND NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.scope_id))
  OR (NEW.scope_type = 'server' AND NOT EXISTS (SELECT 1 FROM linked_servers WHERE id = NEW.scope_id))
BEGIN
  SELECT RAISE(ABORT, 'vault owner must exist');
END;

CREATE TRIGGER dzn_vault_grant_identity_immutable
BEFORE UPDATE OF id, scope_type, scope_id, item_id, source_type, source_key, granted_at ON dzn_vault_grants
BEGIN
  SELECT RAISE(ABORT, 'vault grant identity and source are immutable');
END;

CREATE TABLE dzn_vault_showcases (
  scope_type TEXT NOT NULL CHECK (scope_type IN ('player', 'server')),
  scope_id TEXT NOT NULL CHECK (length(scope_id) BETWEEN 1 AND 128),
  version INTEGER NOT NULL CHECK (typeof(version) = 'integer' AND version >= 1),
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
  slots_json TEXT NOT NULL CHECK (
    length(slots_json) <= 4096 AND json_valid(slots_json)
    AND json_type(slots_json) = 'object'
    AND COALESCE(json_type(slots_json, '$.hero'), '') IN ('text', 'null')
    AND COALESCE(json_type(slots_json, '$.supporting'), '') = 'array'
    AND json_array_length(slots_json, '$.supporting') = 4
    AND COALESCE(json_type(slots_json, '$.supporting[0]'), '') IN ('text', 'null')
    AND COALESCE(json_type(slots_json, '$.supporting[1]'), '') IN ('text', 'null')
    AND COALESCE(json_type(slots_json, '$.supporting[2]'), '') IN ('text', 'null')
    AND COALESCE(json_type(slots_json, '$.supporting[3]'), '') IN ('text', 'null')
    AND COALESCE(json_type(slots_json, '$.scene'), '') IN ('text', 'null')
  ),
  -- This is deliberately nullable so account deletion can anonymise historic
  -- server showcase edits without changing the selected server collectibles.
  updated_by_user_id TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(scope_type, scope_id)
);

CREATE TRIGGER dzn_vault_showcase_owner_exists BEFORE INSERT ON dzn_vault_showcases
WHEN (NEW.scope_type = 'player' AND NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.scope_id))
  OR (NEW.scope_type = 'server' AND NOT EXISTS (SELECT 1 FROM linked_servers WHERE id = NEW.scope_id))
BEGIN
  SELECT RAISE(ABORT, 'vault showcase owner must exist');
END;

CREATE TRIGGER dzn_vault_showcase_identity_immutable
BEFORE UPDATE OF scope_type, scope_id ON dzn_vault_showcases
BEGIN
  SELECT RAISE(ABORT, 'vault showcase owner is immutable');
END;

CREATE TABLE dzn_vault_audit (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('player', 'server')),
  scope_id TEXT NOT NULL,
  -- Account deletion retains server-level audit history but clears the person
  -- who performed the action. Player-scoped audit rows are removed instead.
  actor_user_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('welcome_claimed', 'showcase_saved')),
  previous_version INTEGER,
  next_version INTEGER,
  detail_json TEXT NOT NULL CHECK (json_valid(detail_json) AND json_type(detail_json) = 'object'),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_dzn_vault_audit_scope ON dzn_vault_audit(scope_type, scope_id, created_at);

CREATE TRIGGER dzn_vault_audit_identity_immutable
BEFORE UPDATE OF id, scope_type, scope_id, action, previous_version, next_version, detail_json, created_at ON dzn_vault_audit
BEGIN
  SELECT RAISE(ABORT, 'vault audit is append-only');
END;

CREATE TRIGGER dzn_vault_audit_actor_anonymise_only
BEFORE UPDATE OF actor_user_id ON dzn_vault_audit
WHEN NEW.actor_user_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'vault audit actor can only be cleared');
END;
