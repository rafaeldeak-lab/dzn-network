# Survival Command Field Orders Release

## Scope

This source release adds an optional, server-authoritative tactical phase to a ready Survival Command expedition. A player selects exactly one order before the existing incident decision:

- **Overwatch protocol**: less strain, slightly less salvage.
- **Signal intercept**: more intelligence and breakthrough potential, slightly less salvage.
- **Recovery priority**: more salvage with a more difficult return.

The order is part of the deterministic outcome fingerprint. Browser input never supplies rewards, outcome class, mission seed, building level, or incident definition. Survival Command remains private player progression only: it does not change DayZ data, server standings, competitive scoring, raw coordinates, entitlements, or billing.

## Release Boundary

- `0112_dzn_survival_command_field_orders.sql` was applied by itself in [production workflow run #16](https://github.com/rafaeldeak-lab/dzn-network/actions/runs/39346130218). The run recorded a private D1 recovery bookmark and passed its ledger, schema, index, constraint, foreign-key, retained-state, and default-initialization checks.
- The temporary maintenance switch is removed, `DZN_ACCOUNT_DELETE_ENABLED=true` is restored in production, and the maintenance health route returns its normal `404` response.
- Production enables `DZN_COMMAND_CENTRE_ENABLED`, `DZN_SURVIVAL_COMMAND_ENABLED`, and `DZN_SURVIVAL_COMMAND_FIELD_ORDERS_ENABLED` together. The prerequisite schema chain through `0112` was proven by the successful one-migration rollout, so the player-facing controls cannot be enabled against an unverified database.
- Preview keeps all three switches unset. Existing production expeditions continue to use the pre-field-order decision flow until they reach a field-order-ready state.
- The Field Order interface appears only when both the flag is exactly `true` and the isolated schema is present.
- This activation contains no database migration, customer, Discord, Nitrado, or billing action.

## Controlled Production Activation

Perform this separately from the source merge and from every other migration:

1. Record the private D1 recovery reference for `dzn_network_db` and record the preflight migration-ledger state.
2. Apply only `0112_dzn_survival_command_field_orders.sql`.
3. Verify that the migration ledger records `0112` once and only once.
4. Verify the three `dzn_survival_command_expeditions` columns: `field_order`, `field_order_request_id`, and `field_order_at`.
5. Verify both indexes: `idx_dzn_survival_command_field_order_request` and `idx_dzn_survival_command_field_order_active`.
6. Verify foreign keys with `PRAGMA foreign_key_check`, the new field-order check constraint, and the expected zero-row baseline before the feature is enabled.
7. Merge and deploy a separately reviewed cleanup release that removes `DZN_SURVIVAL_COMMAND_FIELD_ORDERS_MIGRATION_MAINTENANCE` and restores `DZN_ACCOUNT_DELETE_ENABLED=true`. Verify the maintenance health route has returned its normal `404` response and existing authenticated Survival Command writes are available again before proceeding.
8. After that cleanup is live and verified, deploy the separate production-only activation for Command Centre, Survival Command, and Field Orders. Keep every unrelated feature flag unchanged and leave previews disabled.
9. With an authenticated test account, establish a Command Centre and Operations profile, dispatch a mission, wait for the normal server-ready state, choose each field order in separate controlled missions, and verify:
   - no order is shown before the migration plus flag;
   - one order can be chosen exactly once;
   - stale, replayed, forged, cross-account, and early requests are rejected without changing the expedition;
   - the subsequent incident decision resolves once and records the selected field order in private history;
   - the resulting resources are server-side values only;
   - no DayZ, server, leaderboard, entitlement, payment, raw-location, or competitive record changes.
10. If live verification fails, disable the three runtime flags together. Do not alter the verified migration or combine a repair with another migration.

## Local Evidence

- `npm run test:survival-command` exercises field-order gating, origin/authentication checks, individual ownership, idempotency, stale/version behavior, deterministic risk/recovery changes, persistence, retention, migration columns, indexes, constraints, foreign keys, and zero baseline.
- `npm run qa:survival-command` uses a disposable loopback fixture to verify desktop and phone rendering, a field-order selection, the rendered Three.js command marker, reduced-motion rendering, no horizontal overflow, and no browser console errors.
