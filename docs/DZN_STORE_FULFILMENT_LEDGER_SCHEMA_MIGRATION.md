# DZN Store Fulfilment Ledger Schema Migration

## Purpose

This slice implements the deliberately approved DZN Store fulfilment ledger schema migration as a local/test-only database contract.

It adds `migrations/0073_dzn_store_fulfilment_ledger_schema.sql` after rechecking that the current migration sequence ended at `0072_dzn_store_order_ledger_schema.sql`.

The migration is schema-only. Store fulfilment runtime remains disabled and unimplemented.

## Added Schema

The migration creates only these approved private Store fulfilment ledger tables:

- `account_entitlements`
- `supporter_cards`
- `store_fulfilment_attempts`
- `store_order_status_history`
- `store_entitlement_status_history`
- `store_refund_dispute_audit`

No other Store, wheel, scoring, owner, profile, review, event, moderation, or export table is added by this slice.

## Local/Test Boundary

The new tables are local/test-only ledgers:

- `ledger_scope` is constrained to `local` or `sandbox`.
- `livemode = 0` is enforced by `CHECK(livemode = 0)`.
- No production D1 migration apply is authorized by this slice.
- No Cloudflare secret or source-controlled environment configuration is changed.

The schema is source-controlled so reviewers can inspect the future ledger shape without enabling runtime fulfilment or touching production.

## Account Entitlements

`account_entitlements` represents future private account-bound cosmetic/supporter entitlements only.

It is not an owner subscription entitlement table and cannot unlock Starter, Pro, `/setup`, Nitrado linking, owner dashboards, server management, server ownership, or billing plan status.

The table enforces:

- one entitlement per fulfilled `source_order_item_id`
- uniqueness across `user_id`, `entitlement_key`, and `source_order_id`
- source links to `store_orders`, `store_order_items`, and `store_payment_events`
- fixed-zero no-advantage columns for owner subscription access, spins, XP, rank, discovery, reviews, events, Server Wars, CTF, and competitive eligibility
- private visibility/status columns for future presentation only

## Supporter Cards

`supporter_cards` represents the future DZN Founding Supporter Card ledger.

The table enforces:

- one card per qualifying account and `card_type`
- one card per source order item
- one linked account entitlement
- unique `DZN-SUP-######` serial numbers
- local/test `livemode = 0`
- refund/reversal state through status fields instead of deletion

The migration does not issue a card. Future issuance still requires a separate verified fulfilment runtime slice.

## Fulfilment Attempts

`store_fulfilment_attempts` is the future idempotency and audit boundary for verified Store webhook fulfilment.

It records attempt keys, payment-event links, order links, optional order-item links, local/test mode, attempt status, failure codes, sanitized event summaries, and optional future entitlement/card links.

This slice does not create a fulfilment route, run a fulfilment job, update `store_orders`, insert fulfilment attempts at runtime, or process Stripe events beyond the existing receipt-only webhook.

## Status History

`store_order_status_history` and `store_entitlement_status_history` provide non-destructive status audit trails for future paid, failed, disputed, refunded, revoked, restored, and manual-review transitions.

The tables are append-only schema contracts for a later runtime slice. This migration does not append history rows and does not update order, entitlement, or card status.

## Refund And Dispute Audit

`store_refund_dispute_audit` is the future private audit ledger for sanitized refund, reversal, chargeback, and dispute reconciliation.

It may link a payment event to an order and records only sanitized identifiers and decision metadata. It must not store raw Stripe payload bodies, webhook signatures, card details, billing addresses, customer email, or full payment-method details.

Full refunds, reversals, and lost disputes are future rollback inputs only. This migration does not perform rollback.

## Still Blocked

This slice does not add or enable:

- No Store webhook fulfilment
- No Store order fulfilment writes
- No Supporter Card issuance
- No earned spins
- `earned_spins`
- `spin_ledger`
- `wheel_cooldowns`
- No reward wheel runtime
- No live checkout
- No one-time live checkout
- No owner live checkout
- Stripe Product or Price mutation
- Stripe customer, refund, dispute, or webhook-endpoint mutation
- Cloudflare secret/config mutation
- No production D1 writes
- Nitrado or Discord mutation
- AI provider credentials, vector stores, analytics, tracking, or metered model calls
- No issue #49 changes

## Fair Progression Boundary

The schema cannot affect billing, owner entitlement, server ownership, Nitrado linking, rankings, discovery score, reviews, review score, badges, seasons, events, CTF scoring, Server Wars scoring, XP awards, earned calling-card awards, public profile visibility, retained exports, moderation decisions, or competitive eligibility.

Any future Store runtime must continue proving that paid Store products are guaranteed account-bound presentation items only.

## Validation Contract

The focused test for this slice is:

```text
npm run test:dzn-store-fulfilment-ledger-schema-migration
```

The test proves:

- `0073` is the next and only `0073` migration.
- The migration creates exactly the six approved tables.
- The migration has fixed local/test and `livemode = 0` constraints.
- Account entitlement no-advantage columns are fixed to zero.
- Supporter Card serial and one-card-per-account constraints exist.
- Fulfilment attempt idempotency constraints exist.
- Status history and refund/dispute audit tables exist.
- The migration is schema-only and has no data mutation statements.
- Runtime fulfilment remains disabled and unimplemented.
- Existing `store_payment_events` no-fulfilment blockers remain fixed to `0`.
- Live checkout and issue #49 remain untouched.
- Issue #49 remains reserved for final live payment activation.

## Implementation Sources

This migration follows the existing DZN migration pattern and the documented Cloudflare D1 local migration model:

- https://developers.cloudflare.com/d1/best-practices/local-development/
- https://developers.cloudflare.com/d1/wrangler-commands/#migrations
- https://developers.cloudflare.com/d1/sql-api/foreign-keys/

## Next Recommended Slice

Next should be DZN Store fulfilment runtime implementation approval preflight only if deliberately approved: define the exact disabled-by-default verified test-mode runtime plan that will write fulfilment attempts and status history, update only matching local/test Store orders, grant exactly one eligible account entitlement, optionally issue exactly one eligible Supporter Card, and handle refund/chargeback rollback. That preflight must still happen before any runtime fulfilment code writes account entitlements, issues Supporter Cards, mints earned spins, runs the reward wheel, enables live checkout, mutates Stripe Products/Prices, mutates Cloudflare config, writes production D1, or changes issue #49.
