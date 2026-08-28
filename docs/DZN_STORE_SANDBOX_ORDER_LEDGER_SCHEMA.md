# DZN Store Sandbox Order Ledger Schema

## Status And Boundary

This slice implements the first Store order/payment ledger schema only:

- `migrations/0072_dzn_store_order_ledger_schema.sql`
- `store_orders`
- `store_order_items`
- `store_payment_events`

The schema is local/sandbox-only source work for the next disabled-by-default Store checkout sequence. Applying it to production D1 is not approved by this slice.

This slice does not add, create, mutate, or enable:

- Checkout routes.
- Stripe Checkout Sessions.
- Store webhook handlers.
- Webhook fulfilment.
- Account entitlement writes.
- Supporter Card tables or issuance.
- Earned-spin ledgers.
- Reward wheel runtime.
- Stripe Products, Prices, Customers, Sessions, refunds, disputes, or webhook endpoints.
- Cloudflare variables, secrets, bindings, Pages config, Workers config, or production D1 state.
- Nitrado, Discord, AI provider credentials, vector stores, analytics, tracking, or metered model calls.
- Live checkout activation.
- Issue #49 changes.

`DZN_LIVE_CHECKOUT_ENABLED` remains unset/false. Store checkout flags remain disabled by default and are not declared in Cloudflare config by this slice.

## Architecture Baseline

DZN already has:

- Owner subscription checkout at `functions/api/billing/create-checkout-session.ts` using `mode: "subscription"`.
- Subscription webhook handling at `functions/api/stripe/webhook.ts`.
- Canonical owner billing readiness and entitlement safety in `functions/_lib/plans.ts`.
- Stripe raw-body signature verification in `functions/_lib/stripe.ts`.
- Store catalog draft tables in `migrations/0071_dzn_store_catalog_admin_draft.sql`.
- Store catalog and preview validation in `functions/_lib/dzn-store-catalog.ts`.
- A public-safe, read-only `/store` preview route.
- A Store sandbox order and checkout approval preflight in `docs/DZN_STORE_SANDBOX_ORDER_CHECKOUT_APPROVAL_PREFLIGHT.md`.

The new ledger schema is stacked after those contracts. It creates storage needed for future sandbox order, item, and provider-event facts, but it does not add any route that can write those facts.

## External References Reviewed On 2026-08-27

Future runtime work must re-check provider docs, but this schema follows the current public contracts:

- Stripe Checkout Sessions support one-time `payment` mode, server-side line items, metadata, success URLs, cancel URLs, and PaymentIntent metadata: https://docs.stripe.com/api/checkout/sessions/create
- Stripe webhook signature verification depends on the `Stripe-Signature` header and the unmodified raw request body: https://docs.stripe.com/webhooks/signature
- Stripe idempotency keys are intended for retryable `POST` requests and must not contain sensitive data: https://docs.stripe.com/api/idempotent_requests
- Stripe event types cover Checkout, PaymentIntent, refund, charge, and dispute state used by later fulfilment/revocation reviews: https://docs.stripe.com/api/events/types
- Cloudflare D1 migrations are SQL files applied through Wrangler, with `--local` targeting local development data rather than the remote D1 database: https://developers.cloudflare.com/d1/reference/migrations/ and https://developers.cloudflare.com/d1/wrangler-commands/

## Schema Design

### `store_orders`

Purpose:

- Store the local/sandbox Store order header before any future one-time Stripe Checkout Session is created.
- Preserve the purchasing DZN user, order number, amount snapshot, tax snapshot, terms version, provider references, and order lifecycle state.
- Keep data private and non-public by default.

Important fields:

- `id TEXT PRIMARY KEY`
- `order_number TEXT NOT NULL UNIQUE`
- `purchasing_user_id TEXT NOT NULL REFERENCES users(id)`
- `purchasing_discord_id_hash TEXT`
- `status TEXT NOT NULL DEFAULT 'draft'`
- `ledger_scope TEXT NOT NULL DEFAULT 'sandbox' CHECK(ledger_scope IN ('local', 'sandbox'))`
- `livemode INTEGER NOT NULL DEFAULT 0 CHECK(livemode = 0)`
- `product_count INTEGER NOT NULL DEFAULT 1 CHECK(product_count = 1)`
- `currency TEXT NOT NULL DEFAULT 'gbp'`
- `subtotal_amount_minor`, `tax_amount_minor`, and `total_amount_minor`
- `selected_theme_key`
- `stripe_checkout_session_id TEXT UNIQUE`
- `stripe_payment_intent_id TEXT UNIQUE`
- `stripe_customer_ref_hash TEXT`
- `immutable_product_snapshot_json`
- `immutable_price_snapshot_json`
- `store_flags_snapshot_json`
- `tax_snapshot_json`
- `terms_version`
- `checkout_idempotency_key_hash TEXT UNIQUE`
- timestamp fields for creation, update, paid, refund, and revocation

Guardrails:

- `livemode` is fixed to `0`; this schema is not a live-checkout schema.
- `product_count` is fixed to `1`; multi-item orders are future-only.
- Amounts must be non-negative and `total_amount_minor = subtotal_amount_minor + tax_amount_minor`.
- Stripe customer references are stored as hashes only in this first schema.
- There is no fulfilled status and no fulfilled timestamp in this schema. Future entitlement fulfilment requires a separate approved migration.

### `store_order_items`

Purpose:

- Store the immutable product/price/item snapshot attached to a Store order.
- Keep the first order slice to exactly one item with quantity `1`.
- Preserve the Fair Progression Boundary on the purchased item itself.

Important fields:

- `id TEXT PRIMARY KEY`
- `order_id TEXT NOT NULL REFERENCES store_orders(id)`
- `product_id TEXT NOT NULL REFERENCES store_products(id)`
- `price_id TEXT NOT NULL REFERENCES store_prices(id)`
- `product_key`
- `product_name_snapshot`
- `product_type`
- `fulfilment_kind`
- `quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity = 1)`
- `currency TEXT NOT NULL DEFAULT 'gbp'`
- `unit_amount_minor`, `tax_amount_minor`, and `total_amount_minor`
- `item_snapshot_json`
- `UNIQUE(order_id)`

Paid-outcome constraints:

- `account_bound = 1`
- `guaranteed_purchase = 1`
- `no_competitive_advantage = 1`
- `grants_spins = 0`
- `grants_xp = 0`
- `grants_rank_advantage = 0`
- `grants_discovery_advantage = 0`
- `grants_review_advantage = 0`
- `grants_event_advantage = 0`
- `grants_server_wars_advantage = 0`
- `grants_ctf_advantage = 0`
- `grants_owner_subscription_access = 0`
- `grants_competitive_eligibility = 0`

### `store_payment_events`

Purpose:

- Store a local/sandbox provider-event ledger for future signed webhook receipt.
- Make duplicate Stripe event ids side-effect-free.
- Preserve a sanitized event summary and raw body hash without storing raw provider payloads or card data.
- Keep fulfilment writes explicitly impossible in this schema.

Important fields:

- `id TEXT PRIMARY KEY`
- `stripe_event_id TEXT NOT NULL UNIQUE`
- `event_type TEXT NOT NULL`
- `event_class TEXT NOT NULL CHECK(event_class IN ('checkout', 'payment_intent', 'refund', 'dispute', 'ignored'))`
- `api_version`
- `ledger_scope TEXT NOT NULL DEFAULT 'sandbox'`
- `livemode INTEGER NOT NULL DEFAULT 0 CHECK(livemode = 0)`
- `processing_status TEXT NOT NULL DEFAULT 'received'`
- `related_order_id TEXT REFERENCES store_orders(id)`
- provider reference fields for Checkout Session, PaymentIntent, Charge, Refund, and Dispute ids
- `raw_event_sha256 TEXT NOT NULL`
- `sanitized_summary_json TEXT NOT NULL DEFAULT '{}'`
- `failure_code`
- `failure_message`

Fulfilment blockers:

- `fulfilment_attempted INTEGER NOT NULL DEFAULT 0 CHECK(fulfilment_attempted = 0)`
- `entitlement_write_attempted INTEGER NOT NULL DEFAULT 0 CHECK(entitlement_write_attempted = 0)`
- `supporter_card_write_attempted INTEGER NOT NULL DEFAULT 0 CHECK(supporter_card_write_attempted = 0)`

This keeps the ledger ready for signed event receipt in a later slice without allowing account entitlement or Supporter Card writes.

## Feature-Flag Boundary

This slice does not add Cloudflare variables or `cloudflare-env.d.ts` entries.

Future runtime writes must remain blocked unless a later approved slice deliberately introduces and validates these default-disabled flags:

- `DZN_STORE_ENABLED=false`
- `DZN_STORE_CHECKOUT_ENABLED=false`
- `DZN_STORE_SANDBOX_CHECKOUT_ENABLED=false`
- `DZN_STORE_WEBHOOK_FULFILMENT_ENABLED=false`
- `DZN_STORE_LIVE_CHECKOUT_ENABLED=false`
- `DZN_SUPPORTER_CARDS_ENABLED=false`
- `DZN_EARNED_SPINS_ENABLED=false`
- `DZN_REWARD_WHEEL_ENABLED=false`
- `NEXT_PUBLIC_DZN_STORE_ENABLED=false`

No flag may allow Store purchases to affect owner access, billing plans, scoring, rankings, discovery, reviews, badges, seasons, events, Server Wars, CTF, XP awards, earned calling-card awards, public profile visibility, retained exports, moderation decisions, or competitive eligibility.

## Privacy And Payment Data Boundary

The ledger schema may store private reconciliation facts, but public routes must not expose:

- Stripe customer references.
- Checkout Session ids.
- PaymentIntent ids.
- Charge ids.
- Refund ids.
- Dispute ids.
- Stripe event ids.
- Raw webhook payloads.
- Card numbers, CVC, bank details, or payment method details.
- Full billing address details.
- Raw Discord ids.
- Internal DZN user ids.
- Tax internals or private payment state.

This schema stores only sanitized summaries and raw event hashes for provider events. It does not store raw webhook bodies.

## Fair Progression Boundary

The schema cannot write or influence:

- Owner billing accounts.
- Owner plan entitlements.
- Server subscriptions.
- Server ownership.
- `/setup`, Nitrado linking, owner onboarding, owner dashboards, or server-management APIs.
- Rankings, discovery score, leaderboards, reviews, or review score.
- Badges, seasons, crowns, or earned reputation.
- Events, tournaments, brackets, approvals, rosters, CTF scoring, or Server Wars scoring.
- ADM stats, kill events, player events, leaderboard formulas, or player rankings.
- XP awards.
- Earned calling-card awards.
- Earned spins, spin limits, reward odds, or wheel outcomes.
- Public profile visibility.
- Retained exports.
- Moderation decisions.
- Competitive eligibility.

## Production-Mutation Boundary

This branch must not run or approve:

- `npm run db:migrate:remote`
- `wrangler d1 migrations apply dzn_network_db --remote`
- `wrangler pages secret put`
- Stripe Product or Price creation.
- Stripe Checkout Session creation.
- Stripe webhook endpoint creation.
- Cloudflare Pages deployment.
- Nitrado or Discord mutations.
- Live checkout activation.
- Issue #49 merge or mutation.

Local validation may inspect the SQL file and, if explicitly run, may use `--local` D1 execution only. Production migration application remains a separate high-risk release operation.

## Tests And Acceptance Criteria

This slice is accepted only if tests prove:

- `0072_dzn_store_order_ledger_schema.sql` is the only new Store ledger migration.
- The migration creates exactly `store_orders`, `store_order_items`, and `store_payment_events`.
- `store_orders` is sandbox/local scoped and fixed to `livemode = 0`.
- `store_order_items` is one item per order, quantity `1`, account-bound, guaranteed-purchase, and no-competitive-advantage.
- Paid item constraints block spins, XP, ranking, discovery, review, event, Server Wars, CTF, owner subscription access, and competitive eligibility.
- `store_payment_events.stripe_event_id` is unique.
- Payment events store sanitized summaries and raw SHA-256 hashes, not raw payloads or card data.
- Payment events cannot mark fulfilment, entitlement writes, or Supporter Card writes as attempted.
- No account entitlement, Supporter Card, earned-spin, spin-ledger, or wheel-cooldown table is added.
- No runtime route, Store API, Stripe Checkout call, Store webhook handler, entitlement write, Supporter Card issuance, wheel runtime, Cloudflare config, live checkout, production D1 write, or issue #49 change is added.

## Next Recommended Slice

Next should be the DZN Store sandbox order creation route approval slice: design and, only if deliberately approved, add a disabled-by-default authenticated order-creation route that can write pending sandbox orders only when Store sandbox flags are explicitly enabled in the local/test environment. It must still create no Stripe Checkout Sessions, process no webhooks, grant no entitlements, issue no Supporter Cards, mint no earned spins, run no wheel, change no Stripe objects, change no Cloudflare secrets/config, write no production D1, enable no live checkout, and change no issue #49.

## Follow-On Order Creation Route Slice

That follow-on route slice is now defined in `docs/DZN_STORE_SANDBOX_ORDER_CREATION_ROUTE_APPROVAL.md` and implemented through `functions/api/store/orders.ts` plus `functions/_lib/dzn-store-orders.ts`.

It writes only `store_orders` and `store_order_items`, and only for authenticated local/test sandbox requests where the Store order flags are explicitly enabled. It still creates no Stripe Checkout Sessions, processes no Store webhooks, grants no entitlements, issues no Supporter Cards, mints no earned spins, runs no reward wheel, mutates no Stripe objects, mutates no Cloudflare secrets/config, writes no production D1, enables no live checkout, and changes no issue #49.

## Follow-On Checkout Session Slice

The DZN Store sandbox Checkout Session approval slice is now delivered in `docs/DZN_STORE_SANDBOX_CHECKOUT_SESSION_APPROVAL.md`.

It uses the existing `store_orders` columns `stripe_checkout_session_id`, `stripe_payment_intent_id`, `stripe_customer_ref_hash`, `checkout_idempotency_key_hash`, and `checkout_session_expires_at`; no additional migration is required. `POST /api/store/orders/:orderId/checkout` can update only an owned draft local/test order to `checkout_created` after a safe test-mode Stripe Checkout Session is returned.

It still adds no Store webhook handler, no `store_payment_events` write, no account entitlement write, no Supporter Card issuance, no earned-spin ledger, no wheel runtime, no production D1 apply, no live checkout activation, and no issue #49 change.
