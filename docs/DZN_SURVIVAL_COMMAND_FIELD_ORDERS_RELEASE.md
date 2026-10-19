# Survival Command Field Orders Release

## Scope

This source release adds an optional, server-authoritative tactical phase to a ready Survival Command expedition. A player selects exactly one order before the existing incident decision:

- **Overwatch protocol**: less strain, slightly less salvage.
- **Signal intercept**: more intelligence and breakthrough potential, slightly less salvage.
- **Recovery priority**: more salvage with a more difficult return.

The order is part of the deterministic outcome fingerprint. Browser input never supplies rewards, outcome class, mission seed, building level, or incident definition. Survival Command remains private player progression only: it does not change DayZ data, server standings, competitive scoring, raw coordinates, entitlements, or billing.

## Release Boundary

- Source keeps `DZN_SURVIVAL_COMMAND_FIELD_ORDERS_ENABLED` absent from `wrangler.toml`; therefore production and preview keep the existing Survival Command flow.
- This release enables only `DZN_SURVIVAL_COMMAND_FIELD_ORDERS_MIGRATION_MAINTENANCE=true` with `DZN_ACCOUNT_DELETE_ENABLED=false` in production. Authenticated reads remain available, while Survival Command writes and account closure are paused before the retained expedition rows are fingerprinted.
- Existing expeditions continue to use the pre-field-order decision flow while the flag is absent or `false`.
- The Field Order interface appears only when both the flag is exactly `true` and the isolated schema is present.
- There is no migration, customer, Discord, Nitrado, or billing action in this source release. The maintenance flag is removed by a separately reviewed cleanup release after the isolated D1 operation succeeds.

## Controlled Production Activation

Perform this separately from the source merge and from every other migration:

1. Record the private D1 recovery reference for `dzn_network_db` and record the preflight migration-ledger state.
2. Apply only `0112_dzn_survival_command_field_orders.sql`.
3. Verify that the migration ledger records `0112` once and only once.
4. Verify the three `dzn_survival_command_expeditions` columns: `field_order`, `field_order_request_id`, and `field_order_at`.
5. Verify both indexes: `idx_dzn_survival_command_field_order_request` and `idx_dzn_survival_command_field_order_active`.
6. Verify foreign keys with `PRAGMA foreign_key_check`, the new field-order check constraint, and the expected zero-row baseline before the feature is enabled.
7. Set only `DZN_SURVIVAL_COMMAND_FIELD_ORDERS_ENABLED=true` on the server runtime. Keep other flags unchanged.
8. With an authenticated test account, establish a Command Centre and Operations profile, dispatch a mission, wait for the normal server-ready state, choose each field order in separate controlled missions, and verify:
   - no order is shown before the migration plus flag;
   - one order can be chosen exactly once;
   - stale, replayed, forged, cross-account, and early requests are rejected without changing the expedition;
   - the subsequent incident decision resolves once and records the selected field order in private history;
   - the resulting resources are server-side values only;
   - no DayZ, server, leaderboard, entitlement, payment, raw-location, or competitive record changes.
9. Keep the flag off if any verification fails; investigate from the recovery reference rather than combining a repair with another migration.

## Local Evidence

- `npm run test:survival-command` exercises field-order gating, origin/authentication checks, individual ownership, idempotency, stale/version behavior, deterministic risk/recovery changes, persistence, retention, migration columns, indexes, constraints, foreign keys, and zero baseline.
- `npm run qa:survival-command` uses a disposable loopback fixture to verify desktop and phone rendering, a field-order selection, the rendered Three.js command marker, reduced-motion rendering, no horizontal overflow, and no browser console errors.
