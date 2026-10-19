-- Isolated Survival Command field-loadout progression. Apply only after 0108
-- has been independently verified. Existing feature flags remain unchanged.
ALTER TABLE dzn_survival_command_expeditions
  ADD COLUMN loadout TEXT NOT NULL DEFAULT 'field_kit'
  CHECK (loadout IN ('field_kit', 'signal_scanner', 'recovery_kit', 'convoy_plating'));

CREATE TABLE dzn_survival_command_loadout_unlocks (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  loadout TEXT NOT NULL CHECK (loadout IN ('signal_scanner', 'recovery_kit', 'convoy_plating')),
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, loadout)
);

CREATE TABLE dzn_survival_command_spend_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  loadout TEXT NOT NULL CHECK (loadout IN ('signal_scanner', 'recovery_kit', 'convoy_plating')),
  salvage_spent INTEGER NOT NULL CHECK (salvage_spent >= 0),
  intel_spent INTEGER NOT NULL CHECK (intel_spent >= 0),
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, request_id),
  UNIQUE (user_id, loadout),
  CHECK (salvage_spent > 0 OR intel_spent > 0)
);

CREATE INDEX idx_dzn_survival_command_loadout_history
  ON dzn_survival_command_spend_ledger(user_id, created_at DESC);
