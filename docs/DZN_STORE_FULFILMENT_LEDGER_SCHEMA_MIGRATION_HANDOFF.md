# DZN Store Fulfilment Ledger Schema Migration Handoff

## Scope

This slice implements the deliberately approved local/test-only DZN Store fulfilment ledger schema migration.

Protected OneDrive checkout was not modified.

Branch: `codex/dzn-store-fulfilment-ledger-schema-migration-20260828`

Base: `codex/dzn-store-fulfilment-ledger-schema-preflight-20260828`

## Added

- `migrations/0073_dzn_store_fulfilment_ledger_schema.sql`
- `docs/DZN_STORE_FULFILMENT_LEDGER_SCHEMA_MIGRATION.md`
- `scripts/test-dzn-store-fulfilment-ledger-schema-migration.ts`

## Migration Numbering

The migration directory was rechecked before implementation.

The previous latest migration was:

```text
migrations/0072_dzn_store_order_ledger_schema.sql
```

The new migration is:

```text
migrations/0073_dzn_store_fulfilment_ledger_schema.sql
```

There is exactly one `0073` migration in this slice.

## Tables Added

The migration creates only the approved Store fulfilment ledger schema objects:

- `account_entitlements`
- `supporter_cards`
- `store_fulfilment_attempts`
- `store_order_status_history`
- `store_entitlement_status_history`
- `store_refund_dispute_audit`

## Boundary

No runtime fulfilment.

No Supporter Card issuance.

No earned spins.

No reward wheel runtime.

No live checkout.

No Stripe Product or Price mutation.

No Cloudflare secret/config mutation.

No production D1 writes.

No issue #49 change.

## Safety Notes

- The new ledger tables are fixed to local/sandbox scope with `livemode = 0`.
- `account_entitlements` fixed-zero safety columns prevent Store entitlements from granting owner subscription access, spins, XP, ranking advantage, discovery advantage, review advantage, event advantage, Server Wars advantage, CTF advantage, or competitive eligibility.
- `supporter_cards` enforces one Founding Supporter Card per user/card type, one source order item per card, and unique `DZN-SUP-######` serial numbers.
- `store_fulfilment_attempts` defines future idempotent processing keys but no runtime writes.
- Status history and refund/dispute audit are private schema contracts only.

## Runtime State

The existing Store webhook remains receipt-only:

- `POST /api/stripe/store-webhook`
- `functions/api/stripe/store-webhook.ts`
- `functions/_lib/dzn-store-webhook.ts`

`store_payment_events` fulfilment blockers remain fixed to `0`:

- `fulfilment_attempted`
- `entitlement_write_attempted`
- `supporter_card_write_attempted`

## Validation

Completed:

```text
npm run test:dzn-store-fulfilment-ledger-schema-migration - PASS
npm run test:dzn-store-fulfilment-ledger-schema-preflight - PASS
npm run test:dzn-store-webhook-fulfilment-approval-preflight - PASS
npm run test:dzn-store-sandbox-webhook-ledger-receipt - PASS
npm run test:dzn-store-sandbox-checkout-session-approval - PASS
npm run test:dzn-store-sandbox-order-route-approval - PASS
npm run test:dzn-store-order-ledger-schema - PASS
npm run test:dzn-store-sandbox-checkout-approval-preflight - PASS
npm run test:dzn-store-public-preview-contract - PASS
npm run test:dzn-store-catalog-admin-draft - PASS
npm run test:dzn-safe-monetisation-supporter-preflight - PASS
npm run test:billing-plans - PASS
npm run test:stripe-live-readiness - PASS
npm run test:stripe-live-activation-checklist - PASS
npm run check:billing-config - PASS
npx tsc --noEmit --incremental false - PASS
npm run lint - PASS with existing warnings only
npm run build - PASS
npm test - PASS
git diff --check - PASS
npx wrangler d1 migrations apply dzn_network_db --local - PASS
npx wrangler d1 execute dzn_network_db --local --command "<six-table readback>" - PASS
npx wrangler d1 execute dzn_network_db --local --command "PRAGMA foreign_key_check;" - PASS
```

Codex Security diff scan:

```text
Scan ID: ef856bdf-7f66-4b5a-9ba9-c54014f4f1ef
Findings: 0
Status: complete
TAC advisory: unavailable because Codex Security Access was not connected
```

`npm run lint` retains existing warnings outside this slice:

- `components/network/public-network.tsx`
- `components/servers/live-server-rail.tsx`
- `functions/api/servers/[serverId]/dashboard/advanced-stats.ts`

## Next Recommended Slice

Delivered follow-on reference: the DZN Store fulfilment runtime implementation approval preflight is `docs/DZN_STORE_FULFILMENT_RUNTIME_IMPLEMENTATION_PREFLIGHT.md`. It defines the disabled-by-default local/test runtime sequence, write scope, idempotency behavior, order-status transitions, account-entitlement creation rules, optional Supporter Card issuance rules, refund/chargeback rollback rules, test matrix, rollback path, and security proof.

That preflight adds no runtime fulfilment code, account entitlement writes, Supporter Card issuance, earned spins, reward wheel runtime, live checkout, Stripe Product/Price mutation, Cloudflare config mutation, production D1 writes, or issue #49 changes.

Next should be DZN Store fulfilment runtime implementation only if deliberately approved: add the disabled-by-default local/test runtime from that preflight, with tests proving verified Stripe receipt processing, idempotency, no paid spins, no owner entitlement, privacy, rollback, and Fair Progression Boundary isolation.
