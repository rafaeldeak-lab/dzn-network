-- Isolated Survival Command field-order storage. Apply only after 0109 and the
-- live Survival Command base are independently verified. The feature flag stays
-- disabled until this schema, its ledger, indexes, constraints and baseline pass.
ALTER TABLE dzn_survival_command_expeditions
  ADD COLUMN field_order TEXT
  CHECK (field_order IS NULL OR field_order IN ('overwatch', 'intercept', 'recovery'));

ALTER TABLE dzn_survival_command_expeditions
  ADD COLUMN field_order_request_id TEXT;

ALTER TABLE dzn_survival_command_expeditions
  ADD COLUMN field_order_at INTEGER;

CREATE UNIQUE INDEX idx_dzn_survival_command_field_order_request
  ON dzn_survival_command_expeditions(user_id, field_order_request_id)
  WHERE field_order_request_id IS NOT NULL;

CREATE INDEX idx_dzn_survival_command_field_order_active
  ON dzn_survival_command_expeditions(user_id, status, field_order, ready_at DESC);
