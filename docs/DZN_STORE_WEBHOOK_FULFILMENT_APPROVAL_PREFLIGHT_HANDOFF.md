# DZN Store Webhook Fulfilment Approval Preflight Handoff

## Start State

- Worktree: `C:\Users\rafae\Desktop\DZN-Audits\worktrees\dzn-store-webhook-fulfilment-approval-preflight-20260828`
- Branch: `codex/dzn-store-webhook-fulfilment-approval-preflight-20260828`
- Base: `origin/codex/dzn-store-sandbox-webhook-ledger-receipt-20260828`
- Base commit: `cb4aae9716548e294eee6a3866d77e7addd64984`
- Prior stacked PR: `#103` for the Store sandbox webhook receipt ledger.
- Protected OneDrive checkout was not modified.

## Scope

This slice is preflight-only documentation and guard-test work for future DZN Store webhook fulfilment.

Added:

- `docs/DZN_STORE_WEBHOOK_FULFILMENT_APPROVAL_PREFLIGHT.md`
- `docs/DZN_STORE_WEBHOOK_FULFILMENT_APPROVAL_PREFLIGHT_HANDOFF.md`
- `scripts/test-dzn-store-webhook-fulfilment-approval-preflight.ts`

Updated:

- `docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md`
- `docs/DZN_SAFE_MONETISATION_SUPPORTER_SYSTEM_BACKLOG.md`
- `docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md`
- `docs/PUBLIC_ACCESS_POLICY.md`
- `docs/BILLING_PLANS.md`
- `docs/STRIPE_LIVE_ACTIVATION_CHECKLIST.md`
- `package.json`

## Architecture Found

DZN currently separates:

- Owner subscription checkout and webhooks for Starter/Pro owner access.
- Player/account DZN Store sandbox order and Checkout Session work for guaranteed cosmetics/supporter purchases.
- Store sandbox webhook receipt, which verifies Stripe signatures and records sanitized test-mode `store_payment_events` rows only.

The current Store schema has `store_orders`, `store_order_items`, and `store_payment_events` only. It does not contain account entitlement, Supporter Card, earned-spin, wheel, or account-purchases tables.

The current `store_payment_events` schema still hard-blocks fulfilment side effects:

- `fulfilment_attempted = 0`
- `entitlement_write_attempted = 0`
- `supporter_card_write_attempted = 0`

## Fulfilment Contract Defined

The preflight defines:

- `checkout.session.completed` as the first eligible future fulfilment event, test-mode only, `mode=payment`, complete, and paid.
- `checkout.session.async_payment_succeeded` as future-eligible only if delayed payment methods are separately approved.
- PaymentIntent events as receipt/corroboration only for the first runtime slice.
- Success-page redirects as never sufficient for fulfilment.
- Order transitions from `checkout_created`/`payment_pending` into paid, failed, expired, disputed, refunded, revoked, manual review, or blocked-by-flag states.
- Exactly-once account entitlement and Supporter Card boundaries.
- Refund, reversal, chargeback, and dispute rollback rules.
- Required future schema preconditions before any fulfilment runtime can write account entitlements or Supporter Cards.
- A proof matrix for the next runtime/migration approval slice.

## Access And Write Matrix

| Surface | Current result | Future rule |
| --- | --- | --- |
| `/store` | Read-only preview | Still no entitlement until verified payment fulfilment exists. |
| `POST /api/store/orders` | Local/test pending order and item only | Purchaser identity stays session-derived. |
| `POST /api/store/orders/:orderId/checkout` | Test-mode Checkout Session and `store_orders` `checkout_created` update only | Success redirect still grants nothing. |
| `POST /api/stripe/store-webhook` | Signed test-mode receipt row only | Future fulfilment requires separate approval, flags, schema, and proof. |
| Future account entitlements | Not implemented | Exactly one account entitlement per fulfilled source order. |
| Future Supporter Cards | Not implemented | Exactly one Founding Supporter Card per qualifying account. |
| Future earned spins/wheel | Not implemented | Store payments must never mint spins or run the wheel. |
| Owner `/setup` and Nitrado | Unchanged owner entitlement gate | Store purchases must never unlock owner access. |

## Protected Surfaces

This slice leaves these surfaces untouched:

- Owner billing plan normalization.
- Starter/Pro owner subscription checkout.
- Owner subscription webhook handling.
- `/setup`.
- Nitrado linking.
- Owner onboarding.
- Owner dashboards.
- Server-management APIs.
- Server ownership.
- Rankings and discovery score.
- Reviews and review score.
- Badges, seasons, crowns, events, brackets, CTF scoring, and Server Wars scoring.
- XP awards and earned calling-card awards.
- Public profile visibility.
- Retained exports.
- Moderation decisions.
- Competitive eligibility.

## Production-Mutation Confirmation

This slice must not run or approve:

- `npm run db:migrate:remote`
- `wrangler d1 migrations apply dzn_network_db --remote`
- `wrangler pages secret put`
- Stripe Product or Price creation/mutation.
- Stripe webhook endpoint creation/mutation.
- Stripe customer, refund, dispute, or payment mutation.
- Store webhook fulfilment.
- Account entitlement writes.
- Supporter Card issuance.
- Earned-spin or reward-wheel runtime.
- Cloudflare Pages deployment.
- Nitrado or Discord mutations.
- Live checkout activation.
- Issue #49 mutation or merge.

## Validation

Completed on 2026-08-28 in the isolated worktree:

- `npm run test:dzn-store-webhook-fulfilment-approval-preflight`
- `npm run test:dzn-store-sandbox-webhook-ledger-receipt`
- `npm run test:dzn-store-sandbox-checkout-session-approval`
- `npm run test:dzn-store-sandbox-order-route-approval`
- `npm run test:dzn-store-order-ledger-schema`
- `npm run test:dzn-store-sandbox-checkout-approval-preflight`
- `npm run test:dzn-safe-monetisation-supporter-preflight`
- `npm run test:dzn-store-public-preview-contract`
- `npm run test:dzn-store-catalog-admin-draft`
- `npm run test:billing-plans`
- `npm run test:stripe-live-readiness`
- `npm run test:stripe-live-activation-checklist`
- `npm run check:billing-config`
- `npx tsc --noEmit --incremental false`
- `npm run lint`
- `npm test`
- `npm run build`
- `git diff --check`

`npm run lint` passed with the existing repository warnings in `components/network/public-network.tsx`, `components/servers/live-server-rail.tsx`, and `functions/api/servers/[serverId]/dashboard/advanced-stats.ts`.

`npm run check:billing-config` confirmed live billing remains not configured and live checkout remains disabled.

Codex Security diff review completed with no findings. TAC advisory status could not be verified because the security-access connector was not logged in; the scan continued because TAC is advisory and not a gate.

## Next Recommended Slice

Next should be DZN Store fulfilment ledger/schema migration approval preflight only if deliberately approved: define the exact local/test schema changes for account entitlements, Supporter Cards, fulfilment-attempt state, refund/dispute revocation audit, uniqueness constraints, and rollback before any fulfilment route writes account entitlements, issues Supporter Cards, mints earned spins, runs the wheel, enables live checkout, mutates Stripe Products/Prices, mutates Cloudflare config, writes production D1, or changes issue #49.
