# DZN Store Fulfilment Runtime Implementation Handoff

## Branch And Scope

Branch: `codex/dzn-store-fulfilment-runtime-implementation-20260828`

Base: `1bc16535d4aa7d1095241360a4a61bd51b556add`

Protected OneDrive checkout was not modified.

This slice implements the deliberately approved disabled-by-default local/test Store fulfilment runtime. It is not live checkout activation and it is not a production D1 apply.

## What Changed

- Added `functions/_lib/dzn-store-fulfilment.ts`.
- Updated `functions/_lib/dzn-store-webhook.ts` so verified Store webhook receipts call fulfilment only when `DZN_STORE_WEBHOOK_FULFILMENT_ENABLED=true`.
- Added `scripts/test-dzn-store-fulfilment-runtime-implementation.ts`.
- Wired `test:dzn-store-fulfilment-runtime-implementation` into `package.json` and the full `npm test` chain.
- Added `docs/DZN_STORE_FULFILMENT_RUNTIME_IMPLEMENTATION.md`.

## Runtime Behavior

Default behavior is still receipt-only. When `DZN_STORE_WEBHOOK_FULFILMENT_ENABLED` is absent or false, `POST /api/stripe/store-webhook` verifies the Stripe signature, records the sanitized test-mode `store_payment_events` row, returns `fulfilment: null`, and writes no fulfilment attempts, account entitlements, or Supporter Cards.

When explicit local/test flags allow fulfilment, a verified `checkout.session.completed` Store receipt can:

- Insert one `store_fulfilment_attempts` row.
- Move the matched local/test order to `paid`.
- Append `store_order_status_history`.
- Insert exactly one safe `account_entitlements` row for the source order item.
- Optionally insert one `supporter_cards` row only when `DZN_SUPPORTER_CARDS_ENABLED=true` and the product is the DZN Founding Supporter Pack.

For one-time account-bound products, the runtime also checks whether the same purchasing user already has a non-revoked entitlement with the same entitlement key. If one exists, it records the attempt, moves the new order to `manual_review`, and does not create a second entitlement or Supporter Card.

Refund/dispute receipts can:

- Append `store_refund_dispute_audit`.
- Move the affected Store order to `refunded`, `disputed`, `revoked`, `paid`, or `manual_review` depending on the verified event and local state.
- Suspend, revoke, or restore only the affected Store entitlement/card.

If the sanitized receipt row is written but fulfilment throws, the webhook returns a retryable `503 STORE_FULFILMENT_RUNTIME_FAILED` with `receipt_recorded: true` rather than returning a false success.

## Entitlement/Access Matrix

| Surface or system | Store fulfilment impact |
| --- | --- |
| Store account entitlement | Allowed only after verified eligible Store payment receipt. |
| Founding Supporter Card | Optional, local/test only, gated by `DZN_SUPPORTER_CARDS_ENABLED=true`. |
| Owner Starter/Pro plan | No impact. |
| `/setup` and Nitrado linking | No impact. |
| Owner dashboards/server management | No impact. |
| Server ownership | No impact. |
| Rankings/discovery/leaderboards | No impact. |
| Reviews/review score | No impact. |
| Badges/seasons/crowns/reputation | No impact. |
| Events/tournaments/CTF/Server Wars | No impact. |
| XP and earned calling cards | No impact. |
| Earned spins/reward wheel | No writes and no runtime. |
| Public profile visibility | No impact. |
| Retained exports/moderation decisions | No impact. |
| Competitive eligibility | No impact. |

## Protected Surfaces

The slice keeps fulfilment behind:

- Stripe signature verification on the raw webhook body.
- Test-mode Stripe event requirement.
- `DZN_STORE_SANDBOX_RUNTIME=local|test`.
- Store sandbox flags.
- `DZN_STORE_WEBHOOK_FULFILMENT_ENABLED=true`.
- Live checkout blockers.
- Earned-spin and reward-wheel blockers.
- Server-side order/item/provider reconciliation.
- Unique constraints on receipt, attempt, entitlement, Supporter Card, and status-history tables.
- Same-account one-time product duplicate checks that move the new order to `manual_review` without a second entitlement/card grant.

Success-page redirects still do not grant entitlements. PaymentIntent events still do not fulfil alone.

## Production Mutation Confirmation

This slice made no production mutation:

- No earned spins.
- No reward wheel runtime.
- No live checkout.
- No Stripe Product/Price/customer/refund/dispute/webhook endpoint mutation.
- No Cloudflare variable, secret, binding, or config mutation.
- No production D1 writes.
- No Nitrado or Discord mutation.
- No analytics/tracking or metered AI call.
- No issue #49 change.

## Next Recommended Slice

Next should be the Store fulfilment reconciliation/read-model preflight: define the private Account Purchases and Entitlements read model, Supporter Card reveal/status UI contract, webhook replay/manual-review controls, and refund/dispute operator workflow before adding any public card reveal, account purchases route, admin replay route, notification, production migration apply, live checkout activation, earned-spin ledger, reward wheel runtime, Stripe mutation, Cloudflare config mutation, production D1 write, or issue #49 change.
