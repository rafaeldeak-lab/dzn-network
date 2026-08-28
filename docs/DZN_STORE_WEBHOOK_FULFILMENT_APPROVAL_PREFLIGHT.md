# DZN Store Webhook Fulfilment Approval Preflight

## Status And Boundary

This slice is approval preflight only. It defines the exact future Store webhook fulfilment contract before any fulfilment runtime exists.

This slice does not add, enable, create, mutate, or approve:

- No Store webhook fulfilment route writes.
- No order fulfilment.
- No `store_orders` paid/refunded/revoked status writes from the webhook.
- No account entitlement writes.
- No Supporter Card issuance.
- No earned-spin ledger.
- No reward wheel runtime.
- No account purchases screen.
- No Stripe Product, Price, Customer, Checkout Session, refund, dispute, payment, or webhook endpoint mutation.
- No Cloudflare variable, secret, binding, Pages config, Workers config, or production D1 mutation.
- No Nitrado, Discord, analytics, tracking, AI provider credentials, vector stores, or metered model calls.
- No live checkout activation.
- No issue #49 change.

`DZN_LIVE_CHECKOUT_ENABLED` remains unset/false. `DZN_STORE_LIVE_CHECKOUT_ENABLED` remains unset/false. Issue #49 remains reserved for final live checkout activation.

Current `POST /api/stripe/store-webhook` remains receipt-only. Current `store_payment_events` fulfilment blockers remain fixed to `0`.

## Architecture Found

DZN already has a strict separation between owner subscriptions and player/account Store purchases:

- Owner subscription checkout remains in `functions/api/billing/create-checkout-session.ts` with `mode: "subscription"`.
- Owner subscription webhooks remain in `functions/api/stripe/webhook.ts`.
- Owner setup, `/setup`, Nitrado linking, onboarding, dashboards, and server-management APIs remain behind the canonical owner entitlement layer.
- Store catalog validation remains in `functions/_lib/dzn-store-catalog.ts`.
- Store sandbox order creation remains in `functions/_lib/dzn-store-orders.ts` and `functions/api/store/orders.ts`.
- Store sandbox Checkout Session creation remains in `functions/_lib/dzn-store-checkout.ts` and `functions/api/store/orders/[orderId]/checkout.ts`.
- Store sandbox webhook receipt remains in `functions/_lib/dzn-store-webhook.ts` and `functions/api/stripe/store-webhook.ts`.
- Store order ledger schema remains in `migrations/0072_dzn_store_order_ledger_schema.sql`.

The current ledger has only `store_orders`, `store_order_items`, and `store_payment_events`. It does not have `account_entitlements`, `supporter_cards`, `earned_spins`, `spin_ledger`, or `wheel_cooldowns`.

The current `store_payment_events` table deliberately blocks fulfilment side effects:

- `fulfilment_attempted INTEGER NOT NULL DEFAULT 0 CHECK(fulfilment_attempted = 0)`
- `entitlement_write_attempted INTEGER NOT NULL DEFAULT 0 CHECK(entitlement_write_attempted = 0)`
- `supporter_card_write_attempted INTEGER NOT NULL DEFAULT 0 CHECK(supporter_card_write_attempted = 0)`

A later runtime fulfilment PR must first receive separate approval for schema changes that add entitlement/supporter-card tables and relax or replace those no-fulfilment blockers. This preflight does not do that.

## External References Reviewed On 2026-08-28

- Stripe webhook verification requires the unmodified raw request body and `Stripe-Signature` header: https://docs.stripe.com/webhooks/signature
- Stripe webhook handlers should verify the event and return a 2xx only after safe local processing; Stripe retries failed delivery: https://docs.stripe.com/webhooks
- Stripe Checkout fulfilment should use webhooks and exactly-once server-side fulfilment; success-page redirects must not be the only fulfilment trigger: https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted
- Stripe Checkout fulfilment events include `checkout.session.completed` and delayed-payment `checkout.session.async_payment_succeeded`: https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted
- Stripe event types include Checkout Session completion/expiry, async payment success/failure, refund, charge refund, and dispute lifecycle events: https://docs.stripe.com/api/events/types
- Stripe idempotency keys are for retrying create/update API requests and must avoid sensitive data: https://docs.stripe.com/api/idempotent_requests
- Stripe refunds may be full or partial and are post-payment events that need local reconciliation: https://docs.stripe.com/refunds
- Stripe disputes can debit the disputed amount and are surfaced through webhooks/API/Dashboard: https://docs.stripe.com/disputes/how-disputes-work
- Cloudflare D1 prepared statements support bound parameters and return write metadata through `run()`: https://developers.cloudflare.com/d1/worker-api/prepared-statements/
- Cloudflare D1 local development provides a local-only D1 environment for testing before deployment: https://developers.cloudflare.com/d1/best-practices/local-development/

## Required Approval Gates Before Fulfilment Runtime

No fulfilment implementation may start until a dedicated follow-on issue or PR explicitly approves the exact runtime slice. Generic "continue", "next", "fix Store", "finish payments", or "set up Stripe" wording is not enough for production mutation.

Before any fulfilment runtime exists, the approved follow-on must confirm:

- Scope is local/test mode only unless a later live payment activation approval exists.
- No production D1 migration apply is authorized.
- No Cloudflare secret/config/binding mutation is authorized.
- No Stripe Product/Price/customer/refund/dispute/webhook endpoint mutation is authorized.
- No live checkout is authorized.
- Issue #49 remains untouched unless that issue is explicitly opened and approved for the specific live payment operation.
- Fulfilment can be disabled independently from receipt by `DZN_STORE_WEBHOOK_FULFILMENT_ENABLED=false`.
- Supporter Card issuance can be disabled independently by `DZN_SUPPORTER_CARDS_ENABLED=false`.
- Earned spins and reward wheel runtime remain disabled independently by `DZN_EARNED_SPINS_ENABLED=false` and `DZN_REWARD_WHEEL_ENABLED=false`.

## Exact Eligible Test-Mode Fulfilment Events

The first eligible fulfilment event is:

- `checkout.session.completed`

It is eligible only when all of these checks pass:

- The Stripe signature is verified against the raw body before parsing.
- `event.livemode === false`.
- `data.object.object === "checkout.session"`.
- `data.object.id` is a bounded `cs_test_...` Checkout Session id.
- `data.object.mode === "payment"`.
- `data.object.status === "complete"`.
- `data.object.payment_status === "paid"`.
- The Store runtime is `local` or `test`.
- Store, checkout, sandbox checkout, sandbox webhook receipt, and fulfilment flags are explicitly enabled for the local/test runtime.
- Store live checkout and owner live checkout flags are false.
- The local order id resolves from `client_reference_id` or `metadata.dzn_order_id`.
- The local `store_orders` row exists, is `livemode = 0`, and is scoped to `local` or `sandbox`.
- The local `store_orders.stripe_checkout_session_id` equals the Checkout Session id.
- The local order status is `checkout_created` or `payment_pending`.
- The local order contains exactly one `store_order_items` row.
- The local item is account-bound, guaranteed-purchase, and no-competitive-advantage.
- The local product/price/order snapshots match the paid amount and currency.
- The order item does not grant spins, XP, rank advantage, discovery advantage, review advantage, event advantage, Server Wars advantage, CTF advantage, owner subscription access, or competitive eligibility.

Delayed-payment fulfilment event:

- `checkout.session.async_payment_succeeded`

This event is future-eligible only if a later approved slice enables delayed payment methods. It must pass the same checks as `checkout.session.completed`, and the order must already be in `payment_pending` or another explicitly approved pending state.

PaymentIntent events are receipt/corroboration only for the first fulfilment runtime. `payment_intent.succeeded` must not fulfil by itself unless a later approval adds a separate Checkout Session retrieval/reconciliation step that proves the linked Checkout Session, order id, amount, currency, product snapshot, purchaser, and flags.

## Non-Fulfilment Event Handling

These events may update order/payment status only in a later approved fulfilment runtime and must not grant new entitlements:

- `checkout.session.expired` may move `checkout_created` or `payment_pending` orders to `checkout_expired`.
- `checkout.session.async_payment_failed` may move delayed-payment orders to `payment_failed`.
- `payment_intent.payment_failed` may corroborate failure and move safely linked pending orders to `payment_failed`.
- `refund.created`, `refund.updated`, and `charge.refunded` may trigger refund or manual-review handling only.
- `charge.dispute.created` may move a paid order to `disputed` and suspend the affected entitlement/card display if that policy is approved.
- `charge.dispute.closed` may move a disputed order to `revoked` when lost/charged back, or return it to `paid` when won and no refund/reversal exists.

Owner subscription events, invoices, subscription objects, setup intents, customer updates, payouts, balance transactions, and unrelated verified events are not Store fulfilment events.

## Order Status Transition Contract

Allowed current runtime transition:

- `draft -> checkout_created`: already implemented by the sandbox Checkout Session route after an owned draft order creates a test-mode Checkout Session.

Future approved fulfilment transitions:

- `checkout_created -> payment_pending`: when Checkout completed with a delayed method but payment is not yet paid.
- `checkout_created|payment_pending -> paid`: only after an eligible verified test-mode fulfilment event proves successful payment.
- `checkout_created|payment_pending -> payment_failed`: only after an eligible linked failure event.
- `checkout_created|payment_pending -> checkout_expired`: only after an eligible linked expiry event.
- `paid -> disputed`: only after a linked dispute-created event.
- `paid|disputed -> refunded`: only after a linked full refund/reversal event.
- `paid|disputed|refunded -> revoked`: only after a linked refund, reversal, chargeback, or lost-dispute decision requires entitlement/card revocation.
- `disputed -> paid`: only when a linked dispute closes as won and no refund/reversal/chargeback exists.
- `any active/pending state -> manual_review`: when event data, amount, currency, purchaser, provider reference, product snapshot, fulfilment kind, status, or refund/dispute state is ambiguous.
- `any active/pending state -> blocked_by_flag`: when receipt is allowed but fulfilment is disabled before side effects.

Disallowed transitions:

- `draft -> paid` without a recorded Checkout Session.
- `checkout_created -> paid` from success-page redirect only.
- `checkout_created -> paid` from a PaymentIntent event alone.
- `paid -> paid` with duplicate entitlement/card writes.
- `refunded`, `revoked`, or `cancelled` back to active without explicit admin/manual review policy.
- Any Store order transition that unlocks owner subscription access, `/setup`, Nitrado, owner dashboards, server-management APIs, rankings, discovery, reviews, events, Server Wars, CTF scoring, XP awards, calling-card awards, profile visibility, retained exports, moderation decisions, or competitive eligibility.

## Idempotent Fulfilment Contract

Future fulfilment must be safe when Stripe retries events or when the same Checkout Session is processed concurrently.

Required controls:

- Insert or locate the `store_payment_events` row by unique `stripe_event_id` before side effects.
- Treat duplicate `stripe_event_id` rows as no-op success.
- Recheck the local order inside the fulfilment operation.
- Use conditional writes that require the expected prior order status and provider ids.
- Use a database uniqueness boundary for each entitlement source order.
- Use a database uniqueness boundary for each Supporter Card serial.
- Use a database uniqueness boundary that allows only one Founding Supporter Card per qualifying account.
- Save the exact event id and order id that caused each entitlement/card state change.
- Do not grant from client-provided user ids, Discord ids, owner ids, server ids, billing ids, Stripe customer ids, product ids, price ids, amounts, currency, or status fields.
- Do not expose raw Stripe customer ids, PaymentIntent ids, customer email, billing address, payment method details, raw event body, webhook signatures, or private tax details in public or player-visible responses.
- Return success for already-fulfilled orders without duplicating entitlements, Supporter Cards, serials, cosmetics, notifications, emails, or receipt records.

Exactly one account entitlement per fulfilled source order is allowed. Exactly one Founding Supporter Card per qualifying account is allowed. Success-page redirects must never fulfil purchases.

## Entitlement And Supporter Card Boundaries

Future Store fulfilment may grant only account-bound cosmetic/supporter entitlements that were guaranteed before checkout.

Allowed future entitlement effects:

- Private account purchase record.
- Account-bound cosmetic entitlement.
- Supporter profile badge.
- Optional Supporter chat badge.
- Supporter profile frame.
- One permanent DZN Founding Supporter Card when the purchased item is the qualifying product.

Supporter Card issuance rules:

- Issue only after verified payment fulfilment.
- Issue only once per qualifying account.
- Use the purchaser account from the authenticated order ledger, not request body data.
- Use the selected card theme snapshot saved before Checkout.
- Generate a unique serial such as `DZN-SUP-002481`.
- Retry bounded serial generation on collision.
- Store supporter-since date, display-name snapshot, theme, insignia seed/hash/metadata, visibility state, source order, and revocation state.
- Keep the card non-transferable, non-tradeable, non-resellable, and non-redeemable for money or credit.
- Revoke or hide the card if the payment is refunded, reversed, or charged back under the approved rollback policy.
- Do not create artificial rarity tiers based on payment amount.

Store entitlements must never grant or influence:

- Starter/Pro owner subscription access.
- `/setup`, Nitrado linking, owner onboarding, owner dashboards, owner APIs, server management, or server ownership.
- Spins, wheel odds, XP, earned calling-card awards, challenge completion, rankings, discovery score, reviews, review score, badges, seasons, crowns, events, brackets, CTF scoring, Server Wars scoring, public profile visibility, retained exports, moderation decisions, or competitive eligibility.

Store payments must never mint spins or run the wheel.

## Refund, Reversal, And Chargeback Rollback Rules

Future rollback must use verified Stripe events and local order/provider reconciliation.

Required behavior:

- Full refund, reversal, and chargeback events revoke only the affected order/account entitlement and linked Supporter Card state.
- Partial refunds require `manual_review` unless a later product-specific policy explicitly supports proportional non-transferable digital entitlement handling.
- `charge.dispute.created` moves only the affected paid order to `disputed` and may suspend public cosmetic display if approved.
- Lost disputes or chargebacks move the affected order/entitlement/card to `revoked`.
- Won disputes may return the affected order/entitlement/card to active only if no refund, reversal, or chargeback remains.
- Refund/dispute handling must preserve immutable order, order-item, payment-event, tax, and receipt records.
- Rollback must not delete ledger rows.
- Rollback must not revoke unrelated earned progression, XP, calling cards, reviews, profile privacy settings, owner subscriptions, linked servers, events, rankings, Server Wars state, CTF state, or eligibility.

## Future Schema Preconditions

Before runtime fulfilment is implemented, a separate approved migration must define:

- Account entitlement table and uniqueness by source order/item.
- Supporter Card table and uniqueness by serial and qualifying account.
- Entitlement status lifecycle: active, suspended, revoked, manual_review.
- Supporter Card status lifecycle: active, hidden, suspended, revoked.
- Event-to-order processing metadata.
- Fulfilment attempt tracking that no longer conflicts with the current fixed-zero blockers.
- Refund/dispute/revocation audit rows or equivalent immutable state history.

This slice does not add those migrations.

## Proof Matrix For The Future Runtime Slice

The first fulfilment runtime PR must prove:

| Area | Required proof |
| --- | --- |
| Disabled defaults | Fulfilment flags missing/false return no side effects after receipt. |
| Signature verification | Missing, malformed, or mismatched signatures write no fulfilment state. |
| Raw body handling | Signature verification uses the exact raw request body before JSON parsing. |
| Test-mode boundary | `event.livemode=true` and `cs_live_...` events are blocked before writes. |
| Success-page denial | Success/cancel redirects cannot grant entitlements or Supporter Cards. |
| Eligible event | Only verified `checkout.session.completed` with `payment_status=paid` can fulfil the first runtime slice. |
| Delayed payment | `checkout.session.async_payment_succeeded` remains disabled unless delayed methods are separately approved. |
| PaymentIntent denial | `payment_intent.succeeded` is receipt/corroboration only and cannot fulfil alone. |
| Duplicate event | Duplicate `stripe_event_id` returns success/no-op with no duplicate entitlement/card. |
| Concurrent fulfilment | Parallel processing of the same order/session creates one entitlement and one Supporter Card at most. |
| Cross-account denial | Entitlements attach only to the purchasing account from `store_orders`. |
| Provider mismatch | Wrong Checkout Session, PaymentIntent, amount, currency, product, price, or metadata moves to `manual_review`. |
| Price immutability | Admin price changes after order creation cannot alter completed order snapshots. |
| Refund rollback | Full refunds, reversals, and lost disputes revoke only the affected Store entitlement/card. |
| Partial refund | Partial refunds do not silently revoke/grant; they require `manual_review`. |
| Serial uniqueness | Supporter Card serial collisions retry safely and cannot duplicate active cards. |
| Private payment data | Public/player responses never expose raw customer/payment/tax/webhook data. |
| No paid spins | Store orders, Store payments, Supporter Packs, subscriptions, bundles, and refunds cannot mint spins. |
| No wheel runtime | Fulfilment cannot run the reward wheel or alter wheel cooldowns. |
| No owner entitlement | Store purchases cannot unlock owner setup, Nitrado, owner dashboards, server management, or server ownership. |
| Fair Progression Boundary | Store fulfilment cannot affect billing plan status, rankings, discovery, reviews, badges, seasons, events, CTF scoring, Server Wars scoring, XP awards, calling-card awards, public profile visibility, retained exports, moderation decisions, or competitive eligibility. |
| Production mutation | Tests and review prove no Stripe Product/Price/customer/refund/dispute/webhook endpoint mutation, no Cloudflare config mutation, no production D1 writes, no live checkout, and no issue #49 changes. |

## Acceptance For This Preflight Slice

This preflight slice is accepted when tests prove:

- The new contract docs exist and are referenced from the Store backlog, master platform spec, public access policy, billing docs, and live Stripe checklist.
- `POST /api/stripe/store-webhook` remains receipt-only.
- `functions/_lib/dzn-store-webhook.ts` still inserts only sanitized `store_payment_events` rows.
- The webhook helper does not update `store_orders`.
- The runtime code does not write account entitlements, Supporter Cards, earned spins, spin ledgers, or wheel cooldowns.
- `migrations/0072_dzn_store_order_ledger_schema.sql` still fixes fulfilment, entitlement-write, and Supporter Card write blockers to `0`.
- No `account_entitlements`, `supporter_cards`, `earned_spins`, `spin_ledger`, or `wheel_cooldowns` tables are added.
- No Cloudflare env declaration or source-controlled config enables Store fulfilment, Supporter Cards, earned spins, reward wheel, Store live checkout, or owner live checkout.
- Issue #49 remains reserved for final live checkout activation.

## Next Recommended Slice

Next should be DZN Store fulfilment ledger/schema migration approval preflight only if deliberately approved: define the exact local/test schema changes for account entitlements, Supporter Cards, fulfilment-attempt state, refund/dispute revocation audit, uniqueness constraints, and rollback before any fulfilment route writes account entitlements, issues Supporter Cards, mints earned spins, runs the wheel, enables live checkout, mutates Stripe Products/Prices, mutates Cloudflare config, writes production D1, or changes issue #49.
