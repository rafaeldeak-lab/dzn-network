# DZN Store Fulfilment Runtime Implementation Approval Preflight Handoff

## Scope

This slice is approval preflight only for the future disabled-by-default local/test DZN Store fulfilment runtime.

Protected OneDrive checkout was not modified.

Branch: `codex/dzn-store-fulfilment-runtime-preflight-20260828`

Base: `codex/dzn-store-fulfilment-ledger-schema-migration-20260828`

## Added

- `docs/DZN_STORE_FULFILMENT_RUNTIME_IMPLEMENTATION_PREFLIGHT.md`
- `docs/DZN_STORE_FULFILMENT_RUNTIME_IMPLEMENTATION_PREFLIGHT_HANDOFF.md`
- `scripts/test-dzn-store-fulfilment-runtime-implementation-preflight.ts`

## Architecture Found

DZN already has:

- Owner subscription checkout and webhooks separated from the player/account Store.
- Disabled-by-default Store catalog, public preview, sandbox order, test-mode Checkout Session, and receipt-only Store webhook slices.
- `migrations/0072_dzn_store_order_ledger_schema.sql` for local/sandbox `store_orders`, `store_order_items`, and `store_payment_events`.
- `migrations/0073_dzn_store_fulfilment_ledger_schema.sql` for local/test `account_entitlements`, `supporter_cards`, `store_fulfilment_attempts`, order status history, entitlement status history, and refund/dispute audit.

Current runtime still does not write fulfilment ledgers.

## Runtime Contract Defined

The preflight defines:

- Required disabled-by-default local/test feature flags.
- Exact future write scope.
- Verified Store webhook fulfilment sequence.
- Eligible and non-grant Stripe event handling.
- Order status transition rules.
- Idempotency and concurrency controls.
- Account-entitlement creation rules.
- Optional Supporter Card issuance rules.
- Refund, reversal, chargeback, and dispute rollback rules.
- Private payment-data boundaries.
- Fair Progression Boundary.
- Future runtime test matrix.
- Non-destructive rollback.

## Boundary

No Store webhook fulfilment runtime.

No account entitlement writes.

No Supporter Card issuance.

No earned spins.

No reward wheel runtime.

No live checkout.

No Stripe Product or Price mutation.

No Cloudflare secret/config mutation.

No production D1 writes.

No issue #49 change.

## Protected Surfaces

The future runtime contract keeps Store fulfilment separate from:

- Starter/Pro owner billing.
- `/setup`.
- Nitrado linking.
- Server ownership.
- Owner dashboards and server-management APIs.
- Rankings and discovery score.
- Reviews and review score.
- Badges, seasons, crowns, events, brackets, CTF scoring, and Server Wars scoring.
- XP awards and earned calling-card awards.
- Public profile visibility.
- Retained exports.
- Moderation decisions.
- Competitive eligibility.

## Validation

Completed on 2026-08-28:

```text
npm run test:dzn-store-fulfilment-runtime-implementation-preflight - PASS
npm run test:dzn-store-fulfilment-ledger-schema-migration - PASS
npm run test:dzn-store-fulfilment-ledger-schema-preflight - PASS
npm run test:dzn-store-webhook-fulfilment-approval-preflight - PASS
npm run test:dzn-safe-monetisation-supporter-preflight - PASS
npm run test:dzn-store-sandbox-webhook-ledger-receipt - PASS
npm run test:dzn-store-sandbox-checkout-session-approval - PASS
npm run test:dzn-store-sandbox-order-route-approval - PASS
npm run test:dzn-store-order-ledger-schema - PASS
npm run test:dzn-store-sandbox-checkout-approval-preflight - PASS
npm run test:dzn-store-public-preview-contract - PASS
npm run test:dzn-store-catalog-admin-draft - PASS
npm run test:billing-plans - PASS
npm run test:stripe-live-readiness - PASS
npm run test:stripe-live-activation-checklist - PASS
npm run check:billing-config - PASS; live checkout remains not configured and disabled
git diff --check - PASS
npx tsc --noEmit --incremental false - PASS
npm run build - PASS
npm run lint - PASS with existing warnings in public-network images, live-server-rail image, unused _linkedServerId, and large onboarding dashboard transpilation
npm test - PASS
```

## Security Review

Codex Security diff scan completed with no findings.

Scan id: `4592fca6-b32e-4667-873a-b89d7e3f8226`

Coverage included `package.json`, `scripts/test-dzn-store-fulfilment-runtime-implementation-preflight.ts`, this preflight doc/handoff, and the linked billing/platform/public-access/live-checkout docs.

TAC advisory was unavailable because the Codex Security Access connector was not logged in. The scan continued because TAC status is advisory and does not authorize or block the local review.

## Next Recommended Slice

Next should be DZN Store fulfilment runtime implementation only if deliberately approved: add the disabled-by-default local/test runtime that processes verified `checkout.session.completed` Store payment receipts into `store_fulfilment_attempts`, `store_order_status_history`, exactly one safe `account_entitlements` row, and optionally one `supporter_cards` row when the product and flags qualify, with refund/dispute audit and rollback handling. That implementation must still avoid earned spins, reward wheel runtime, live checkout, Stripe Product/Price mutation, Cloudflare config mutation, production D1 writes, and issue #49 changes.
