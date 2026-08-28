# DZN Store Fulfilment Runtime Implementation Approval Preflight

## Status And Boundary

This slice is approval preflight only. It defines the exact disabled-by-default local/test runtime contract for the first future DZN Store fulfilment implementation.

Delivered follow-on implementation: `docs/DZN_STORE_FULFILMENT_RUNTIME_IMPLEMENTATION.md` and `functions/_lib/dzn-store-fulfilment.ts` now implement this approved local/test runtime with disabled defaults, no earned-spin or reward-wheel runtime, no live checkout, no production D1 write, and no issue #49 change.

This slice does not add, enable, create, mutate, or approve:

- No Store webhook fulfilment runtime.
- No account entitlement writes.
- No Supporter Card issuance.
- No earned spins.
- No reward wheel runtime.
- No account purchases screen.
- No Store fulfilment route, job, component, or helper.
- No Stripe Product, Price, Customer, Checkout Session, refund, dispute, payment, or webhook endpoint mutation.
- No Cloudflare variable, secret, binding, Pages config, Workers config, or production D1 mutation.
- No Nitrado, Discord, analytics, tracking, AI provider credentials, vector stores, or metered model calls.
- No live checkout activation.
- No issue #49 change.

`DZN_LIVE_CHECKOUT_ENABLED` remains unset/false. `DZN_STORE_LIVE_CHECKOUT_ENABLED` remains unset/false. Issue #49 remains reserved for final live checkout activation.

Current `POST /api/stripe/store-webhook` remains receipt-only. Current `store_payment_events` fulfilment blockers remain fixed to `0`. The new `0073` fulfilment ledger tables exist only as local/test schema and are not written by runtime code in this slice.

## Architecture Found

DZN currently separates owner subscription billing from player/account Store purchases:

- Owner subscription checkout remains in `functions/api/billing/create-checkout-session.ts` with Stripe `mode=subscription`.
- Owner subscription webhooks remain in `functions/api/stripe/webhook.ts`.
- Owner setup, `/setup`, Nitrado linking, onboarding, dashboards, and server-management APIs remain behind the canonical owner entitlement layer.
- Store catalog/product validation remains in `functions/_lib/dzn-store-catalog.ts`.
- Store sandbox order creation remains in `functions/_lib/dzn-store-orders.ts` and `functions/api/store/orders.ts`.
- Store sandbox Checkout Session creation remains in `functions/_lib/dzn-store-checkout.ts` and `functions/api/store/orders/[orderId]/checkout.ts`.
- Store sandbox webhook receipt remains in `functions/_lib/dzn-store-webhook.ts` and `functions/api/stripe/store-webhook.ts`.
- Store order/payment ledgers remain in `migrations/0072_dzn_store_order_ledger_schema.sql`.
- Store fulfilment ledgers now exist in `migrations/0073_dzn_store_fulfilment_ledger_schema.sql`.

The existing runtime can create a pending local/test Store order and a test-mode Checkout Session only when explicit sandbox flags and test Stripe proof are present. The existing webhook can verify a Stripe signature and record a sanitized test-mode `store_payment_events` receipt only. It does not fulfil.

The current `store_payment_events` table deliberately keeps receipt rows side-effect-free:

- `fulfilment_attempted INTEGER NOT NULL DEFAULT 0 CHECK(fulfilment_attempted = 0)`
- `entitlement_write_attempted INTEGER NOT NULL DEFAULT 0 CHECK(entitlement_write_attempted = 0)`
- `supporter_card_write_attempted INTEGER NOT NULL DEFAULT 0 CHECK(supporter_card_write_attempted = 0)`

Future fulfilment must not relax those receipt-row blockers in place. It should write its own idempotent processing state into `store_fulfilment_attempts` and history tables from `0073`.

## External References Reviewed On 2026-08-28

- Stripe webhook verification requires the unmodified raw request body and `Stripe-Signature` header: https://docs.stripe.com/webhooks/signature
- Stripe webhook handlers should verify the event, handle POST requests, and return a 2xx response after safe local handling decisions: https://docs.stripe.com/webhooks
- Stripe Checkout fulfilment should use webhooks for server-side fulfilment and should not rely only on a success page redirect: https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted
- Stripe event types include Checkout Session completion/expiry, async payment success/failure, refund, charge refund, and dispute lifecycle events: https://docs.stripe.com/api/events/types
- Stripe idempotency keys apply to retryable create/update requests and must not contain sensitive data: https://docs.stripe.com/api/idempotent_requests
- Stripe refunds may be full or partial and need local reconciliation: https://docs.stripe.com/refunds
- Stripe disputes and chargebacks need local status handling and may remove funds: https://docs.stripe.com/disputes/how-disputes-work
- Cloudflare D1 prepared statements support bound parameters and `run()` write metadata: https://developers.cloudflare.com/d1/worker-api/prepared-statements/
- Cloudflare D1 local development provides a local-only environment for migration and runtime tests before deployment: https://developers.cloudflare.com/d1/best-practices/local-development/

## Required Approval Gates Before Runtime

No fulfilment implementation may start until a dedicated follow-on PR or issue deliberately approves this exact local/test runtime scope.

That approval must confirm:

- The runtime is local/test only.
- `DZN_STORE_WEBHOOK_FULFILMENT_ENABLED` remains absent/false by default and must be explicitly true only in local/test.
- `DZN_SUPPORTER_CARDS_ENABLED` remains absent/false by default and must be explicitly true before Supporter Card issuance is attempted.
- `DZN_EARNED_SPINS_ENABLED=false` and `DZN_REWARD_WHEEL_ENABLED=false` remain mandatory for every Store fulfilment path.
- `DZN_STORE_LIVE_CHECKOUT_ENABLED=false` and `DZN_LIVE_CHECKOUT_ENABLED=false` remain mandatory.
- No production D1 migration apply is authorized.
- No Cloudflare secret/config/binding mutation is authorized.
- No Stripe Product, Price, Customer, refund, dispute, payment, or webhook endpoint mutation is authorized.
- No live checkout is authorized.
- Issue #49 remains untouched unless that issue is explicitly opened and approved for the specific live payment operation.

Generic "continue", "finish payments", "go live", "make Store work", or "set up Stripe" wording is not enough for production mutation or live checkout.

## First Runtime Slice Shape

The first future runtime implementation should be the smallest disabled-by-default local/test Store webhook fulfilment path.

Expected runtime files, if later approved:

- `functions/_lib/dzn-store-fulfilment.ts`
- Updates to `functions/_lib/dzn-store-webhook.ts` to call fulfilment only after receipt and only when fulfilment flags pass.
- Focused tests for disabled defaults, eligibility, idempotency, rollback, privacy, and fairness.

No public client route should trigger fulfilment. Success and cancel redirects may show the order status only after the server has processed verified webhook state. Success redirects must never grant or reveal entitlements by themselves.

## Runtime Flag Contract

Future fulfilment is allowed only when every required local/test flag check passes:

| Flag or condition | Required value | Purpose |
| --- | --- | --- |
| `DZN_STORE_SANDBOX_RUNTIME` | `local` or `test` | Blocks production runtime. |
| `DZN_STORE_ENABLED` | `true` | Store feature is intentionally enabled. |
| `DZN_STORE_CHECKOUT_ENABLED` | `true` | Store checkout/order flow is intentionally enabled. |
| `DZN_STORE_SANDBOX_CHECKOUT_ENABLED` | `true` | Sandbox checkout path is intentionally enabled. |
| `DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_ENABLED` | `true` | Signed receipt rows may be recorded. |
| `DZN_STORE_WEBHOOK_FULFILMENT_ENABLED` | `true` | Verified receipt rows may be processed into local/test fulfilment ledgers. |
| `DZN_SUPPORTER_CARDS_ENABLED` | `true` only for card products | Allows Supporter Card issuance for qualifying products. |
| `DZN_EARNED_SPINS_ENABLED` | `false` | Store payments cannot mint spins. |
| `DZN_REWARD_WHEEL_ENABLED` | `false` | Store payments cannot run the wheel. |
| `DZN_STORE_LIVE_CHECKOUT_ENABLED` | `false` | Store live checkout remains blocked. |
| `DZN_LIVE_CHECKOUT_ENABLED` | `false` | Owner live checkout gate remains blocked. |
| `STRIPE_SECRET_KEY` | test secret only, when API retrieval is later approved | No live Stripe secret may be accepted. |
| `STRIPE_WEBHOOK_SECRET` | bounded `whsec_...` test/local secret | Required for receipt before fulfilment. |

If any required flag is absent, false, live-mode, or ambiguous, the future runtime may record only a receipt row and a `store_fulfilment_attempts` row with `status='blocked_by_flag'` if that specific write is approved. It must not create account entitlements, Supporter Cards, spins, or wheel results.

## Exact Write Scope

The first runtime implementation may write only these local/test tables, and only after a verified test-mode Stripe event is received:

| Table | Allowed future write | Limits |
| --- | --- | --- |
| `store_payment_events` | Existing receipt insert only | Receipt blockers stay `0`; no raw payload, secret, customer email, payment method, or billing address storage. |
| `store_fulfilment_attempts` | One attempt row per payment event | `payment_event_id`, `attempt_key`, and `UNIQUE(order_id, payment_event_id)` enforce idempotency. |
| `store_orders` | Status/timestamp updates only | Only the matched local/test order; no product, price, purchaser, amount, tax, or snapshot mutation. |
| `store_order_status_history` | Append-only order transition audit | Safe summaries only; no raw Stripe payload or private payment details. |
| `account_entitlements` | One account-bound cosmetic/supporter entitlement per fulfilled source item | Only for eligible paid Store item; all no-advantage columns remain fixed to zero. |
| `store_entitlement_status_history` | Append-only entitlement/card status audit | Only after entitlement/card status changes. |
| `supporter_cards` | Optional one card for a qualifying Supporter product | Only when `DZN_SUPPORTER_CARDS_ENABLED=true`, product kind is `supporter_card`, and the account has no existing card. |
| `store_refund_dispute_audit` | One sanitized refund/dispute audit row per relevant payment event | Full refunds, reversals, and lost disputes may drive revocation; partial refunds go to manual review. |

The future runtime must not write:

- `store_products` or `store_prices`, except read-only validation.
- `owner_billing_accounts`, `owner_plan_entitlements`, `server_subscriptions`, `server_owners`, `linked_servers`, or Nitrado tables.
- `earned_spins`, `spin_ledger`, `wheel_cooldowns`, or any reward-wheel table.
- Rankings, discovery, reviews, review score, badges, seasons, events, CTF, Server Wars, XP, calling-card awards, public profile visibility, retained exports, moderation decisions, or competitive eligibility tables.
- Cloudflare config, Stripe Products/Prices, production D1, issue #49, Nitrado, Discord, AI, vector-store, analytics, or tracking state.

## Verified Fulfilment Sequence

The future local/test runtime must follow this sequence:

1. Accept only `POST /api/stripe/store-webhook`.
2. Verify the `Stripe-Signature` header against the unmodified raw body before JSON parsing.
3. Reject malformed, unsigned, mismatched, oversized, or live-mode events before any fulfilment write.
4. Record or locate the unique `store_payment_events` receipt row by `stripe_event_id`.
5. Classify duplicate `stripe_event_id` as side-effect-free success.
6. Check `DZN_STORE_WEBHOOK_FULFILMENT_ENABLED=true` and every local/test flag condition.
7. Insert or locate exactly one `store_fulfilment_attempts` row for the payment event.
8. Resolve the order only from `client_reference_id`, `metadata.dzn_order_id`, and stored local order state.
9. Re-read the order and item from D1 using bound statements.
10. Confirm order and item are `livemode = 0`, `ledger_scope IN ('local','sandbox')`, one-item, account-bound, guaranteed-purchase, no-competitive-advantage, and server-snapshot matched.
11. Confirm the Checkout Session id, PaymentIntent id if present, amount, currency, product, price, purchaser, selected theme, terms version, and stored flags match the order ledger.
12. For grant events, conditionally move the order from `checkout_created` or `payment_pending` to `paid`.
13. Insert `store_order_status_history` for every state transition.
14. Insert exactly one `account_entitlements` row for the source order item when the product is eligible.
15. Insert `store_entitlement_status_history` for entitlement activation.
16. If the item is the DZN Founding Supporter product and `DZN_SUPPORTER_CARDS_ENABLED=true`, issue exactly one `supporter_cards` row.
17. If Supporter Card issuance is required but the flag is false, move to `blocked_by_flag` or `manual_review` with no partial public display.
18. Return a 2xx response for duplicate/already-fulfilled events without duplicating entitlements, Supporter Cards, serials, cosmetics, notifications, or receipt records.

All write paths must be conditional and idempotent. Client-provided user ids, Discord ids, owner ids, server ids, billing ids, Stripe customer ids, product ids, price ids, amount, currency, and status fields must be ignored or rejected as sources of authority.

## Eligible Event Contract

The first grant event is:

- `checkout.session.completed`

It is eligible only when:

- Stripe signature verification succeeds.
- `event.livemode === false`.
- The Checkout Session id starts with `cs_test_`.
- The event object is a Checkout Session.
- `mode === "payment"`.
- `status === "complete"`.
- `payment_status === "paid"`.
- The order id resolves to one local/test `store_orders` row.
- `store_orders.stripe_checkout_session_id` equals the Checkout Session id.
- The order status is `checkout_created` or `payment_pending`.
- The order contains exactly one matching item.
- Product, price, amount, currency, theme, no-competitive-advantage fields, and immutable snapshots match.
- Store live checkout and owner live checkout flags are false.

Future delayed-payment grant event:

- `checkout.session.async_payment_succeeded`

This event remains disabled until delayed payment methods are separately approved. If approved later, it must pass the same checks as `checkout.session.completed` and the order must already be `payment_pending`.

PaymentIntent events are not grant events for the first runtime. `payment_intent.succeeded` may be recorded or corroborated only; it must not fulfil by itself unless a later approved slice adds a Checkout Session retrieval/reconciliation step.

## Non-Grant Event Contract

These events may drive status/audit handling in the future runtime but must not grant new entitlements:

- `checkout.session.expired`
- `checkout.session.async_payment_failed`
- `payment_intent.payment_failed`
- `refund.created`
- `refund.updated`
- `charge.refunded`
- `charge.dispute.created`
- `charge.dispute.closed`

Owner subscription events, invoices, setup intents, customer updates, payouts, balance transactions, Stripe entitlements events, and unrelated verified events are not Store fulfilment events. They may be recorded as ignored receipts only.

## Order Status Transition Contract

Allowed future grant transitions:

- `checkout_created -> paid`
- `payment_pending -> paid`

Allowed future failure or blocking transitions:

- `checkout_created|payment_pending -> checkout_expired`
- `checkout_created|payment_pending -> payment_failed`
- `checkout_created|payment_pending -> blocked_by_flag`
- `checkout_created|payment_pending|paid|disputed -> manual_review`

Allowed future refund/dispute transitions:

- `paid -> disputed`
- `paid|disputed -> refunded`
- `paid|disputed|refunded -> revoked`
- `disputed -> paid`, only when the dispute is won and no refund, reversal, or chargeback remains

Disallowed transitions:

- `draft -> paid`.
- `checkout_created -> paid` from success-page redirect only.
- `checkout_created -> paid` from a PaymentIntent event alone.
- `paid -> paid` with duplicate entitlement/card writes.
- `refunded`, `revoked`, or `cancelled` back to active without explicit manual review policy.
- Any transition that unlocks owner subscription access, `/setup`, Nitrado, owner dashboards, server management, server ownership, rankings, discovery, reviews, badges, seasons, events, CTF scoring, Server Wars scoring, XP awards, calling-card awards, public profile visibility, retained exports, moderation decisions, or competitive eligibility.

## Idempotency And Concurrency Contract

Future fulfilment must be safe under Stripe retries, duplicate events, browser refreshes, and concurrent processing.

Required controls:

- Unique `stripe_event_id` in `store_payment_events`.
- Unique `payment_event_id` and `attempt_key` in `store_fulfilment_attempts`.
- `UNIQUE(order_id, payment_event_id)` in `store_fulfilment_attempts`.
- `UNIQUE(source_order_item_id)` in `account_entitlements`.
- `UNIQUE(user_id, entitlement_key, source_order_id)` in `account_entitlements`.
- `UNIQUE(source_order_item_id)` in `supporter_cards`.
- `UNIQUE(user_id, card_type)` and unique `serial_number` in `supporter_cards`.
- Conditional order updates that require expected prior status, matching provider ids, `livemode=0`, and local/sandbox scope.
- Bounded serial generation retry on collision.
- No duplicate emails, notifications, cosmetics, cards, entitlement rows, order history rows, refund audit rows, or receipt records.

The implementation must return success for duplicate/already-processed Stripe retries after confirming no additional side effects are needed.

## Account Entitlement Creation Rules

Future account entitlement creation is allowed only after a verified eligible grant event and successful local order reconciliation.

The entitlement must:

- Attach to `store_orders.purchasing_user_id`.
- Use the source order item as the uniqueness boundary.
- Copy only safe product key/type/fulfilment kind snapshots.
- Store the granting `store_payment_events.id`.
- Use `status='active'` only when all checks pass.
- Keep all no-advantage fields fixed to zero.
- Remain account-bound and non-transferable.
- Not be read by owner entitlement checks.
- Not unlock `/setup`, Nitrado linking, owner dashboards, owner APIs, server management, or server ownership.

If the product is ambiguous, amount/currency mismatched, already revoked, not account-bound, not guaranteed, has any paid-outcome flag, or cannot be tied to exactly one order item, the future runtime must move the order or attempt to `manual_review` and create no entitlement.

## Supporter Card Issuance Rules

Supporter Card issuance is optional in the first runtime and must be independently gated by `DZN_SUPPORTER_CARDS_ENABLED=true`.

Future issuance is allowed only when:

- The product is the approved `DZN FOUNDING SUPPORTER PACK`.
- The fulfilled order item has `fulfilment_kind='supporter_card'`.
- The account has no existing Founding Supporter Card.
- The entitlement for that source item was created or already exists for the same user/order/item.
- The selected card theme matches the immutable order snapshot.
- The generated serial matches `DZN-SUP-######` and is unique.
- The generated insignia metadata is deterministic enough for audit and contains no private payment data.

The card remains:

- Account-bound.
- Non-transferable.
- Non-tradeable.
- Non-resellable.
- Non-redeemable for money or credit.
- Revocable on refund, reversal, or chargeback.
- Equal-recognition only, with no artificial rarity tiers based on payment amount.

If the card flag is false, if serial generation collides past the bounded retry limit, or if an existing card belongs to the account, the future runtime must not create a second card. It should mark the attempt as `blocked_by_flag`, `duplicate`, or `manual_review` according to the exact condition.

## Refund, Reversal, And Chargeback Rollback Rules

Future rollback must use verified Stripe events and local order/provider reconciliation.

Required behavior:

- Full refund, reversal, and lost-dispute/chargeback events revoke only the affected Store account entitlement and linked Supporter Card.
- Partial refunds require `manual_review` unless a later product-specific policy explicitly supports them.
- `charge.dispute.created` may move only the affected paid order to `disputed` and suspend public cosmetic/card display if approved.
- `charge.dispute.closed` may move the affected order/entitlement/card to `revoked` when lost, or restore only that affected Store item when won and no refund/reversal/chargeback remains.
- Refund/dispute handling appends `store_refund_dispute_audit` and status history rows.
- Rollback does not delete ledgers.
- Rollback does not revoke unrelated earned progression, XP, calling cards, reviews, profile privacy settings, owner subscriptions, linked servers, events, rankings, Server Wars state, CTF state, or eligibility.

## Privacy And Public Output Contract

Future Store fulfilment must keep payment data private.

Do not expose in public or player-safe presentation routes:

- Raw Stripe event bodies.
- Webhook signatures.
- Stripe customer ids.
- PaymentIntent ids.
- Charge ids.
- Refund ids.
- Dispute ids.
- Customer email.
- Billing address.
- Tax internals.
- Payment method details.
- Raw Discord ids.
- Private DZN user ids.

Public profile or chat display may later show only visibility-safe cosmetic state that the player has not hidden. The player hiding a supporter badge or card publicly must not delete the private entitlement or payment ledger.

## Fair Progression Boundary

Future Store fulfilment cannot affect:

- Owner billing plan status.
- Starter/Pro entitlement.
- `/setup`.
- Nitrado linking.
- Server ownership.
- Rankings.
- Discovery score.
- Reviews or review score.
- Badges, seasons, crowns, or earned reputation.
- Events, tournaments, brackets, joins, approvals, or CTF scoring.
- Server Wars scoring.
- ADM stats.
- Leaderboard formulas.
- Player XP awards.
- Earned calling-card awards.
- Public profile visibility.
- Retained exports.
- Moderation decisions.
- Competitive eligibility.

Store payments must never mint spins, improve wheel odds, bypass wheel cooldowns, or run the reward wheel.

## Test Matrix For The Future Runtime PR

The future runtime implementation PR must prove:

| Area | Required proof |
| --- | --- |
| Disabled defaults | Missing/false fulfilment flag records no fulfilment side effects. |
| Local/test only | `DZN_STORE_SANDBOX_RUNTIME` missing, invalid, or production-like blocks fulfilment. |
| Live event denial | `event.livemode=true`, `cs_live_...`, or live secret mode blocks before side effects. |
| Signature verification | Missing/malformed/mismatched Stripe signatures create no fulfilment writes. |
| Raw body handling | Verification uses the exact raw request body before JSON parsing. |
| Success-page denial | Success/cancel redirects cannot create entitlements or cards. |
| Eligible grant event | Only verified `checkout.session.completed` with `payment_status=paid` can grant in the first runtime. |
| Delayed payment disabled | `checkout.session.async_payment_succeeded` remains no-grant until separately approved. |
| PaymentIntent denial | `payment_intent.succeeded` cannot fulfil alone. |
| Order match | Wrong order id, Checkout Session, PaymentIntent, amount, currency, product, price, theme, status, or user moves to `manual_review` or no-op. |
| Idempotency | Duplicate Stripe event creates no duplicate attempt, entitlement, card, status row, refund row, email, or notification. |
| Concurrency | Parallel handling of the same order/session produces one entitlement and one Supporter Card at most. |
| Account boundary | Entitlements attach only to `store_orders.purchasing_user_id`. |
| No owner access | Store fulfilment cannot unlock owner setup, Nitrado, dashboards, management APIs, server ownership, Starter, or Pro. |
| Supporter Card uniqueness | One Founding Supporter Card per qualifying account; serial collisions retry safely. |
| Card flag disabled | Qualifying supporter-card product creates no card when `DZN_SUPPORTER_CARDS_ENABLED=false`. |
| Refund full | Full refund/reversal revokes only the affected Store entitlement/card. |
| Refund partial | Partial refund goes to `manual_review` with no silent grant/revoke. |
| Dispute lost | Lost dispute or chargeback revokes only the affected Store entitlement/card. |
| Dispute won | Won dispute restores only if no refund/reversal/chargeback remains. |
| Private payment data | Public/player responses expose no raw provider/customer/tax/payment data. |
| No paid spins | Store orders, payments, Supporter Packs, subscriptions, bundles, refunds, and admin prices cannot mint spins. |
| No wheel runtime | Fulfilment cannot run the reward wheel or alter wheel cooldowns. |
| Fair Progression Boundary | No effect on rankings, discovery, reviews, badges, seasons, events, CTF, Server Wars, XP, calling cards, public profile visibility, retained exports, moderation decisions, or competitive eligibility. |
| Production mutation | No Stripe Product/Price/customer/refund/dispute/webhook endpoint mutation, no Cloudflare config mutation, no production D1 write, no live checkout, and no issue #49 change. |

## Rollback Plan

The future runtime rollback must be non-destructive:

- Disable `DZN_STORE_WEBHOOK_FULFILMENT_ENABLED` first to stop new fulfilment.
- Keep `DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_ENABLED` configurable separately so verified receipts may still be captured for audit if approved.
- Disable `DZN_STORE_CHECKOUT_ENABLED` and `DZN_STORE_SANDBOX_CHECKOUT_ENABLED` to stop new orders and sessions.
- Keep Store products/prices inactive or paused when needed.
- Preserve `store_orders`, `store_order_items`, `store_payment_events`, `store_fulfilment_attempts`, `account_entitlements`, `supporter_cards`, status history, refund/dispute audit, and tax snapshots.
- Reprocess failed verified events only through a later approved admin/cron replay tool with idempotency proof.
- Use refunds, revocations, suspension, and manual review instead of deleting ledger rows.
- Keep migrations forward-compatible; do not drop audit tables as emergency rollback.
- Keep live checkout disabled until a separate go-live review confirms recovery.

## Security Proof For This Preflight Slice

This preflight slice is accepted when tests prove:

- The preflight doc and handoff exist.
- The master platform spec, public access policy, billing docs, Safe Monetisation backlog, migration docs, and live Stripe checklist point to this preflight.
- `POST /api/stripe/store-webhook` remains receipt-only.
- `functions/_lib/dzn-store-webhook.ts` still inserts only sanitized `store_payment_events` receipt rows and does not update `store_orders`.
- Runtime code does not insert, update, or delete `account_entitlements`, `supporter_cards`, `store_fulfilment_attempts`, `store_order_status_history`, `store_entitlement_status_history`, `store_refund_dispute_audit`, `earned_spins`, `spin_ledger`, or `wheel_cooldowns`.
- No Store fulfilment helper, entitlement helper, Supporter Card helper, wheel helper, account purchases route, or wheel route is added.
- `migrations/0073_dzn_store_fulfilment_ledger_schema.sql` remains the latest Store fulfilment migration; no new migration is added by this preflight.
- No source-controlled Cloudflare env declaration or wrangler config enables Store fulfilment, Supporter Cards, earned spins, reward wheel, Store live checkout, or owner live checkout.
- Existing `store_payment_events` receipt blockers remain fixed to `0`.
- Issue #49 remains reserved for final live payment activation.

## Next Recommended Slice

Next should be DZN Store fulfilment runtime implementation only if deliberately approved: add the disabled-by-default local/test runtime that processes verified `checkout.session.completed` Store payment receipts into `store_fulfilment_attempts`, `store_order_status_history`, exactly one safe `account_entitlements` row, and optionally one `supporter_cards` row when the product and flags qualify, with refund/dispute audit and rollback handling. That implementation must still avoid earned spins, reward wheel runtime, live checkout, Stripe Product/Price mutation, Cloudflare config mutation, production D1 writes, and issue #49 changes.
