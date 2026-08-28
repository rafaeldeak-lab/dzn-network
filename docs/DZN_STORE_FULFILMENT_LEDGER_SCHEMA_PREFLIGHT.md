# DZN Store Fulfilment Ledger Schema Migration Approval Preflight

## Status And Boundary

This slice is approval preflight only. It defines the exact local/test schema migration contract for future Store fulfilment ledgers before any new migration, runtime fulfilment code, entitlement write, Supporter Card issuance, earned-spin ledger, wheel runtime, live checkout, production D1 operation, Stripe mutation, Cloudflare mutation, or issue #49 change exists.

This slice does not add, enable, create, mutate, run, or approve:

- No new migration file.
- No production D1 migration apply.
- No local D1 migration apply.
- No `account_entitlements` table.
- No `supporter_cards` table.
- No `store_fulfilment_attempts` table.
- No refund/dispute/revocation audit table.
- No Store webhook fulfilment route writes.
- No `store_orders` paid/refunded/revoked status update from a webhook.
- No account entitlement write.
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

DZN's Store payment track currently has these delivered pieces:

- Store catalog/admin draft schema in `migrations/0071_dzn_store_catalog_admin_draft.sql`.
- Store sandbox order ledger schema in `migrations/0072_dzn_store_order_ledger_schema.sql`.
- Authenticated local/test pending order creation through `POST /api/store/orders`.
- Test-mode Checkout Session creation through `POST /api/store/orders/:orderId/checkout`.
- Receipt-only signed Store webhook handling through `POST /api/stripe/store-webhook`.

The current Store database surface is intentionally incomplete for fulfilment:

- `store_orders` can move from `draft` to `checkout_created` through the sandbox checkout route.
- `store_order_items` stores one immutable guaranteed account-bound item.
- `store_payment_events` records signed test-mode event receipts only.
- `store_payment_events.fulfilment_attempted`, `entitlement_write_attempted`, and `supporter_card_write_attempted` remain fixed to `0`.
- `account_entitlements`, `supporter_cards`, `store_fulfilment_attempts`, refund/dispute audit tables, earned-spin tables, wheel tables, and account-purchase UI tables do not exist.

The safer future migration approach is to leave receipt rows immutable and add separate fulfilment/audit tables instead of weakening the existing receipt-only table in place.

## External References Reviewed On 2026-08-28

- Stripe webhook verification requires the raw request body and `Stripe-Signature` header: https://docs.stripe.com/webhooks/signature
- Stripe webhook endpoints receive asynchronous events and must verify the request before handling it: https://docs.stripe.com/webhooks
- Stripe Checkout fulfilment should be server-side and webhook-driven; success-page redirects must not be the fulfilment authority: https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted
- Stripe event types include Checkout Session completion/expiry, async payment events, refunds, charge refunds, and dispute events: https://docs.stripe.com/api/events/types
- Stripe idempotency keys are for retryable API writes and must not contain sensitive data: https://docs.stripe.com/api/idempotent_requests
- Stripe refunds can be full or partial and require local reconciliation for fulfilled purchases: https://docs.stripe.com/refunds
- Stripe disputes are surfaced by Dashboard, API, email, and webhooks and can debit the disputed amount: https://docs.stripe.com/disputes/how-disputes-work
- Cloudflare D1 local development separates local data from remote production data; `--local` keeps execution local: https://developers.cloudflare.com/d1/best-practices/local-development/
- Cloudflare D1 migrations are created/applied through Wrangler, and apply has `--local`, `--remote`, and `--preview` modes: https://developers.cloudflare.com/d1/wrangler-commands/#migrations
- Cloudflare D1 prepared statements support bound parameters for safe SQL access: https://developers.cloudflare.com/d1/worker-api/prepared-statements/

## Required Approval Gates Before A Migration Exists

No schema migration may be added until a dedicated follow-on issue or PR explicitly approves the exact local/test migration file. Generic "continue", "next", "finish Store", "make payments work", or "set up checkout" wording is not enough for payment-ledger schema creation.

The approved follow-on must confirm:

- The migration is local/test only.
- The migration filename and number are reserved only after checking the current `migrations/` directory.
- No production D1 apply is authorized.
- No Cloudflare secret, variable, binding, or config mutation is authorized.
- No Stripe Product, Price, Customer, Checkout Session, refund, dispute, payment, or webhook endpoint mutation is authorized.
- No live checkout is authorized.
- Issue #49 remains untouched unless that issue is explicitly opened and approved for the specific live payment operation.
- Runtime fulfilment remains disabled independently by `DZN_STORE_WEBHOOK_FULFILMENT_ENABLED=false`.
- Supporter Card issuance remains disabled independently by `DZN_SUPPORTER_CARDS_ENABLED=false`.
- Earned spins and reward wheel runtime remain disabled independently by `DZN_EARNED_SPINS_ENABLED=false` and `DZN_REWARD_WHEEL_ENABLED=false`.

## Future Migration Name And Scope

The future migration should be named only after rechecking migration numbering. If no newer migration exists, the expected name is:

```text
migrations/0073_dzn_store_fulfilment_ledger_schema.sql
```

That future migration may add only local/test fulfilment ledger schema. It must not backfill, fulfil, update, delete, refund, revoke, issue cards, mint spins, or run the wheel.

Allowed future schema objects:

- `account_entitlements`
- `supporter_cards`
- `store_fulfilment_attempts`
- `store_order_status_history`
- `store_entitlement_status_history`
- `store_refund_dispute_audit`

Blocked future schema objects in this migration:

- `earned_spins`
- `spin_ledger`
- `wheel_cooldowns`
- owner subscription entitlement tables
- Nitrado tables
- rankings/discovery/reviews/events/scoring/progression mutation tables
- retained export storage/history tables

Earned spins and wheel ledgers require a later dedicated earned-only progression/wheel slice. They must not be introduced by Store payment fulfilment schema.

## Future `account_entitlements` Contract

Future `account_entitlements` rows are private account-owned Store cosmetic/supporter entitlements only. They are not owner subscription entitlements.

Required columns:

- `id TEXT PRIMARY KEY`
- `user_id TEXT NOT NULL REFERENCES users(id)`
- `entitlement_key TEXT NOT NULL`
- `source_order_id TEXT NOT NULL REFERENCES store_orders(id)`
- `source_order_item_id TEXT NOT NULL REFERENCES store_order_items(id)`
- `source_product_key TEXT NOT NULL`
- `source_product_type TEXT NOT NULL`
- `source_fulfilment_kind TEXT NOT NULL`
- `status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','hidden','suspended','revoked','manual_review'))`
- `visibility_state TEXT NOT NULL DEFAULT 'visible' CHECK(visibility_state IN ('visible','hidden'))`
- `granted_by_payment_event_id TEXT NOT NULL REFERENCES store_payment_events(id)`
- `revoked_by_payment_event_id TEXT REFERENCES store_payment_events(id)`
- `granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `suspended_at TEXT`
- `revoked_at TEXT`
- `revoke_reason TEXT`
- `status_reason TEXT`
- `created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `grants_owner_subscription_access INTEGER NOT NULL DEFAULT 0 CHECK(grants_owner_subscription_access = 0)`
- `grants_spins INTEGER NOT NULL DEFAULT 0 CHECK(grants_spins = 0)`
- `grants_xp INTEGER NOT NULL DEFAULT 0 CHECK(grants_xp = 0)`
- `grants_rank_advantage INTEGER NOT NULL DEFAULT 0 CHECK(grants_rank_advantage = 0)`
- `grants_discovery_advantage INTEGER NOT NULL DEFAULT 0 CHECK(grants_discovery_advantage = 0)`
- `grants_review_advantage INTEGER NOT NULL DEFAULT 0 CHECK(grants_review_advantage = 0)`
- `grants_event_advantage INTEGER NOT NULL DEFAULT 0 CHECK(grants_event_advantage = 0)`
- `grants_server_wars_advantage INTEGER NOT NULL DEFAULT 0 CHECK(grants_server_wars_advantage = 0)`
- `grants_ctf_advantage INTEGER NOT NULL DEFAULT 0 CHECK(grants_ctf_advantage = 0)`
- `grants_competitive_eligibility INTEGER NOT NULL DEFAULT 0 CHECK(grants_competitive_eligibility = 0)`

Required uniqueness/indexes:

- `UNIQUE(source_order_item_id)`
- `UNIQUE(user_id, entitlement_key, source_order_id)`
- index on `(user_id, status, granted_at)`
- index on `(source_order_id)`
- index on `(granted_by_payment_event_id)`

Rules:

- A fulfilled order item can create at most one entitlement.
- Entitlements attach only to `store_orders.purchasing_user_id`.
- Client-supplied user ids, Discord ids, owner ids, server ids, Stripe customer ids, product ids, price ids, amounts, currency, or status values must not determine the recipient.
- Hidden/visible status is presentation only and cannot affect billing, scoring, XP, reviews, rankings, or eligibility.

## Future `supporter_cards` Contract

Future `supporter_cards` rows represent the one-time DZN Founding Supporter Card. They are account-bound and non-transferable.

Required columns:

- `id TEXT PRIMARY KEY`
- `user_id TEXT NOT NULL REFERENCES users(id)`
- `entitlement_id TEXT NOT NULL UNIQUE REFERENCES account_entitlements(id)`
- `source_order_id TEXT NOT NULL REFERENCES store_orders(id)`
- `source_order_item_id TEXT NOT NULL REFERENCES store_order_items(id)`
- `serial_number TEXT NOT NULL UNIQUE`
- `card_type TEXT NOT NULL DEFAULT 'founding_supporter' CHECK(card_type IN ('founding_supporter'))`
- `display_name_snapshot TEXT NOT NULL`
- `supporter_since TEXT NOT NULL`
- `selected_theme_key TEXT NOT NULL`
- `insignia_seed_hash TEXT NOT NULL`
- `generated_insignia_json TEXT NOT NULL`
- `visibility_state TEXT NOT NULL DEFAULT 'visible' CHECK(visibility_state IN ('visible','hidden'))`
- `status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','hidden','suspended','revoked','manual_review'))`
- `issued_by_payment_event_id TEXT NOT NULL REFERENCES store_payment_events(id)`
- `revoked_by_payment_event_id TEXT REFERENCES store_payment_events(id)`
- `issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `suspended_at TEXT`
- `revoked_at TEXT`
- `revoke_reason TEXT`
- `created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`

Required uniqueness/indexes:

- `UNIQUE(user_id, card_type)`
- `UNIQUE(source_order_item_id)`
- `UNIQUE(serial_number)`
- index on `(user_id, status)`
- index on `(source_order_id)`
- index on `(issued_by_payment_event_id)`

Rules:

- Exactly one Founding Supporter Card can ever be issued per qualifying account.
- Serial numbers use the `DZN-SUP-######` format and must be collision-safe through the unique index plus bounded retry.
- Refunds, reversals, and chargebacks revoke or suspend the card state without deleting the ledger row.
- Public display reads only visibility-safe fields. Raw order ids, user ids, payment-event ids, Stripe ids, tax fields, and payment metadata stay private.

## Future `store_fulfilment_attempts` Contract

Future `store_fulfilment_attempts` rows are the idempotency and audit boundary for processing verified Store payment events.

Required columns:

- `id TEXT PRIMARY KEY`
- `attempt_key TEXT NOT NULL UNIQUE`
- `payment_event_id TEXT NOT NULL REFERENCES store_payment_events(id)`
- `stripe_event_id TEXT NOT NULL`
- `event_type TEXT NOT NULL`
- `order_id TEXT NOT NULL REFERENCES store_orders(id)`
- `order_item_id TEXT REFERENCES store_order_items(id)`
- `livemode INTEGER NOT NULL DEFAULT 0 CHECK(livemode = 0)`
- `ledger_scope TEXT NOT NULL DEFAULT 'sandbox' CHECK(ledger_scope IN ('local','sandbox'))`
- `status TEXT NOT NULL CHECK(status IN ('received','blocked_by_flag','eligible','fulfilled','duplicate','manual_review','failed','no_op'))`
- `eligibility_failure_code TEXT`
- `entitlement_id TEXT REFERENCES account_entitlements(id)`
- `supporter_card_id TEXT REFERENCES supporter_cards(id)`
- `fulfilment_flags_snapshot_json TEXT NOT NULL DEFAULT '{}'`
- `safe_event_summary_json TEXT NOT NULL DEFAULT '{}'`
- `error_code TEXT`
- `error_message TEXT`
- `started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `finished_at TEXT`
- `created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`

Required uniqueness/indexes:

- `UNIQUE(payment_event_id)`
- `UNIQUE(order_id, payment_event_id)`
- index on `(order_id, status, created_at)`
- index on `(stripe_event_id)`
- index on `(status, created_at)`

Rules:

- A duplicate Stripe event must resolve to the existing attempt and perform no side effects.
- A duplicate order/payment event pairing must return safe no-op success.
- Attempt rows must never store raw Stripe payload bodies, webhook signatures, card details, billing addresses, customer email, or full payment method details.
- Attempt state is private payment infrastructure and must not be public/player-visible.

## Future Order And Entitlement Status History Contract

Future status history rows provide a non-destructive audit trail for paid, failed, disputed, refunded, revoked, and manual-review decisions.

`store_order_status_history` required columns:

- `id TEXT PRIMARY KEY`
- `order_id TEXT NOT NULL REFERENCES store_orders(id)`
- `payment_event_id TEXT REFERENCES store_payment_events(id)`
- `from_status TEXT`
- `to_status TEXT NOT NULL`
- `reason_code TEXT NOT NULL`
- `actor_type TEXT NOT NULL CHECK(actor_type IN ('stripe_webhook','system','admin_review'))`
- `safe_summary_json TEXT NOT NULL DEFAULT '{}'`
- `created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`

Required uniqueness/indexes:

- `UNIQUE(order_id, payment_event_id, to_status)`
- index on `(order_id, created_at)`
- index on `(to_status, created_at)`

`store_entitlement_status_history` required columns:

- `id TEXT PRIMARY KEY`
- `entitlement_id TEXT REFERENCES account_entitlements(id)`
- `supporter_card_id TEXT REFERENCES supporter_cards(id)`
- `order_id TEXT NOT NULL REFERENCES store_orders(id)`
- `payment_event_id TEXT REFERENCES store_payment_events(id)`
- `from_status TEXT`
- `to_status TEXT NOT NULL`
- `reason_code TEXT NOT NULL`
- `actor_type TEXT NOT NULL CHECK(actor_type IN ('stripe_webhook','system','admin_review'))`
- `safe_summary_json TEXT NOT NULL DEFAULT '{}'`
- `created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`

Required uniqueness/indexes:

- `UNIQUE(entitlement_id, payment_event_id, to_status)`
- `UNIQUE(supporter_card_id, payment_event_id, to_status)`
- index on `(order_id, created_at)`
- index on `(to_status, created_at)`

Rules:

- Rollback must append history and update status; it must not delete order, payment, entitlement, or Supporter Card rows.
- Admin/manual review actions require a later separate owner/admin authorization design before they are implemented.

## Future Refund And Dispute Audit Contract

Future `store_refund_dispute_audit` rows reconcile Stripe refund/dispute events to local Store orders without storing private payment payloads.

Required columns:

- `id TEXT PRIMARY KEY`
- `payment_event_id TEXT NOT NULL UNIQUE REFERENCES store_payment_events(id)`
- `order_id TEXT REFERENCES store_orders(id)`
- `event_type TEXT NOT NULL`
- `stripe_charge_id TEXT`
- `stripe_refund_id TEXT`
- `stripe_dispute_id TEXT`
- `amount_minor INTEGER`
- `currency TEXT`
- `refund_kind TEXT CHECK(refund_kind IN ('none','partial','full'))`
- `dispute_status TEXT`
- `local_decision TEXT NOT NULL CHECK(local_decision IN ('recorded','suspend','revoke','restore','manual_review','ignored'))`
- `decision_reason TEXT NOT NULL`
- `safe_summary_json TEXT NOT NULL DEFAULT '{}'`
- `created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`

Required uniqueness/indexes:

- index on `(order_id, created_at)`
- index on `(event_type, created_at)`
- index on `(local_decision, created_at)`
- index on `(stripe_refund_id)` where not null
- index on `(stripe_dispute_id)` where not null

Rules:

- Full refunds, reversals, and lost disputes revoke only the affected Store entitlement/card.
- Partial refunds move to `manual_review` unless a later policy explicitly supports proportional handling.
- Won disputes can restore only the affected entitlement/card if no refund, reversal, or chargeback remains.
- Refund/dispute rows cannot touch owner subscriptions, XP, rankings, reviews, events, profile privacy, retained exports, or eligibility.

## Future Migration SQL Guardrails

The future migration must:

- Use `CREATE TABLE IF NOT EXISTS` for new local/test schema objects.
- Use explicit `CHECK` constraints for status enums and all no-competitive-advantage booleans.
- Use `UNIQUE` constraints for source order item fulfilment, Stripe event id processing, Supporter Card serials, and one Founding Supporter Card per user.
- Use indexes for user/status, order/status, event/status, and refund/dispute lookups.
- Store sanitized JSON summaries only; never raw provider payload bodies.
- Keep `livemode INTEGER NOT NULL DEFAULT 0 CHECK(livemode = 0)` on fulfilment-attempt schema until a separate live activation slice approves live mode.
- Preserve existing `store_payment_events` fixed-zero blockers unless a separate runtime fulfilment slice deliberately replaces them with a safer processing design.

The future migration must not:

- Include `INSERT INTO`, `UPDATE`, `DELETE FROM`, `DROP TABLE`, data backfills, Stripe commands, Wrangler remote apply commands, Cloudflare secret commands, live checkout flags, or issue #49 automation.
- Add tables or foreign keys into owner billing entitlements, server ownership, Nitrado, rankings, discovery, reviews, events, Server Wars, CTF, XP, calling-card awards, public profile visibility, retained exports, or moderation decisions.
- Add `earned_spins`, `spin_ledger`, or `wheel_cooldowns`.
- Add public account purchase UI or public Supporter Card display logic.

## Future Runtime Dependency Contract

Adding schema later does not authorize runtime fulfilment.

The runtime slice after schema must still separately prove:

- `DZN_STORE_WEBHOOK_FULFILMENT_ENABLED=false` blocks all side effects.
- Only verified test-mode Stripe events can enter fulfilment.
- `checkout.session.completed` with `payment_status=paid` is the first allowed fulfilment event.
- `checkout.session.async_payment_succeeded` remains disabled unless delayed payment methods are separately approved.
- PaymentIntent events cannot fulfil by themselves.
- Success-page redirects cannot fulfil purchases.
- Duplicate events and concurrent processing create at most one entitlement and one Supporter Card.
- Refund, reversal, and chargeback rollback affects only the matching Store entitlement/card.
- No paid Store path can mint spins or run the wheel.
- Store entitlements cannot unlock owner setup or affect competitive systems.

## Acceptance For This Preflight Slice

This preflight slice is accepted when tests prove:

- This preflight doc exists and is referenced from the Store backlog, Safe Monetisation implementation preflight, master platform spec, public access policy, billing docs, live Stripe checklist, and prior fulfilment approval preflight/handoff.
- The future migration name/scope, table contracts, uniqueness constraints, refund/dispute audit, rollback rules, and proof matrix are defined.
- No new migration file is added.
- `migrations/0072_dzn_store_order_ledger_schema.sql` remains receipt-only with fulfilment/write blockers fixed to `0`.
- Current Store webhook runtime remains receipt-only and does not update `store_orders`.
- Runtime code does not write account entitlements, Supporter Cards, fulfilment attempts, earned spins, spin ledgers, or wheel cooldowns.
- No Cloudflare env declaration or source-controlled config enables Store fulfilment, Supporter Cards, earned spins, reward wheel, Store live checkout, or owner live checkout.
- Issue #49 remains reserved for final live checkout activation.

## Personal Player Page Entry Note

The current application already exposes `/player` as the logged-in Player Hub and `/player/profile` as the private player profile/progression surface. There is also a top navigation item labelled "Player Hub".

Because that may not be clear enough to players looking for their own profile, a later player UX polish slice should add a more explicit "My Player Profile" or "My Profile" entry in logged-in player navigation and Player Hub action areas. That later slice must stay separate from Store fulfilment and must not affect billing, owner access, profile privacy settings, rankings, discovery, reviews, badges, seasons, events, Server Wars, XP awards, calling-card awards, or competitive eligibility.

## Next Recommended Slice

Next should be DZN Store fulfilment ledger schema migration implementation only if deliberately approved: add the local/test-only migration after rechecking migration numbering, create only the approved account-entitlement, Supporter Card, fulfilment-attempt, order-status-history, entitlement-status-history, and refund/dispute audit tables, keep Store fulfilment runtime disabled, and still avoid webhook fulfilment writes, Supporter Card issuance, earned spins, reward wheel runtime, live checkout, Stripe Product/Price mutation, Cloudflare config mutation, production D1 writes, and issue #49 changes.
