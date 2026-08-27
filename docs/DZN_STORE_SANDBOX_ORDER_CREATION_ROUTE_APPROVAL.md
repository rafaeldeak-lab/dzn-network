# DZN Store Sandbox Order Creation Route Approval

## Status And Boundary

This slice adds the first authenticated DZN Store sandbox order-creation route, disabled by default:

- `functions/api/store/orders.ts`
- `functions/_lib/dzn-store-orders.ts`
- `POST /api/store/orders`

It writes only `store_orders` and `store_order_items`, and only when all Store sandbox flags are explicitly enabled in local/test.

Required local/test gates:

- `DZN_STORE_SANDBOX_RUNTIME=local` or `test`
- `DZN_STORE_ENABLED=true`
- `DZN_STORE_CHECKOUT_ENABLED=true`
- `DZN_STORE_SANDBOX_CHECKOUT_ENABLED=true`
- `DZN_STORE_LIVE_CHECKOUT_ENABLED=false`
- `DZN_LIVE_CHECKOUT_ENABLED` remains unset/false.
- `DZN_STORE_WEBHOOK_FULFILMENT_ENABLED=false`
- `DZN_SUPPORTER_CARDS_ENABLED=false`
- `DZN_EARNED_SPINS_ENABLED=false`
- `DZN_REWARD_WHEEL_ENABLED=false`

No Cloudflare variables, secrets, bindings, Pages config, or Workers config are added. The flags are read only from the current runtime environment and remain absent from source-controlled Cloudflare config.

This slice still does not add, create, mutate, or enable:

- No Stripe Checkout Session is created.
- No one-time `mode=payment` Stripe call is made.
- No Stripe Product, Price, Customer, PaymentIntent, refund, dispute, or webhook endpoint is created or mutated.
- No Store webhook is processed.
- No `store_payment_events` row is written.
- No account entitlement is granted.
- No Supporter Card is issued.
- No earned spin is minted.
- No reward wheel runtime runs.
- No owner subscription, `/setup`, Nitrado, server-management, or server-ownership access is changed.
- No analytics, tracking, AI provider credentials, vector stores, metered model calls, Nitrado mutation, or Discord mutation are added.
- No production D1 write or remote migration apply is performed.
- No live checkout activation is performed.
- Issue #49 remains reserved for final live checkout activation.

## Architecture Found

DZN already has:

- Owner subscription checkout at `functions/api/billing/create-checkout-session.ts` using `mode: "subscription"`.
- Owner subscription webhook handling at `functions/api/stripe/webhook.ts`.
- Canonical owner billing/readiness safety in `functions/_lib/plans.ts`.
- Store catalog safety helpers in `functions/_lib/dzn-store-catalog.ts`.
- Store catalog schema in `migrations/0071_dzn_store_catalog_admin_draft.sql`.
- Store order ledger schema in `migrations/0072_dzn_store_order_ledger_schema.sql`.
- A read-only `/store` preview surface that must not call Store or billing APIs.

The order route is deliberately separate from owner billing. It does not call the owner entitlement layer and cannot satisfy the owner gate used by `/setup`, Nitrado linking, owner dashboards, owner onboarding, or server-management APIs.

## External References Reviewed On 2026-08-27

- Cloudflare D1 prepared statements use parameter binding, which is the route's SQL-injection boundary: https://developers.cloudflare.com/d1/worker-api/prepared-statements/
- Cloudflare D1 worker bindings expose `prepare`, `bind`, `first`, and `batch` from the D1 Database API: https://developers.cloudflare.com/d1/worker-api/d1-database/
- Cloudflare Pages Functions receive bindings through `context.env`: https://developers.cloudflare.com/pages/functions/bindings/
- D1 local development remains separate from remote D1 application: https://developers.cloudflare.com/d1/best-practices/local-development/

## Runtime Contract

Canonical endpoint:

```text
POST /api/store/orders
```

Request body:

```json
{
  "productKey": "dzn-founding-supporter-pack",
  "priceId": "local_store_price_id",
  "supporterCardThemeKey": "signal-crown",
  "returnTo": "/store",
  "clientMutationId": "optional-client-token"
}
```

Accepted body fields are intentionally narrow. The route rejects client-supplied identity, owner, server, billing, entitlement, Stripe, quantity, amount, currency, livemode, or status fields.

The route derives the purchaser from the existing Discord session model. A logged-out caller receives `401` and no D1 writes occur.

## Catalog And Price Rules

Before writing an order, the route must resolve one product and one price server-side:

- `store_products.product_key = productKey`
- `store_prices.id = priceId`
- Product status is `approved`.
- Product active is `1`.
- Price status is `approved`.
- Price active is `1`.
- Price is currently effective.
- Price currency is `gbp`.
- Price amount is positive.
- Quantity remains fixed to `1`.
- Pay-what-you-want remains blocked.
- Stripe Price binding remains blocked for this order-only slice.

The product must keep:

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

Supporter Card products require a selected approved theme from product metadata before a pending order can be recorded.

## Write Contract

When every guard passes, the route writes:

- One `store_orders` row.
- One `store_order_items` row.

The order row is:

- `status = draft`
- `ledger_scope = local` or `sandbox`; `DZN_STORE_SANDBOX_RUNTIME=test` maps to the schema-approved `sandbox` ledger scope
- `livemode = 0`
- `product_count = 1`
- `currency = gbp`
- `tax_amount_minor = 0`
- `stripe_checkout_session_id = NULL`
- `stripe_payment_intent_id = NULL`
- `stripe_customer_ref_hash = NULL`
- session-derived `purchasing_user_id`
- hashed `purchasing_discord_id_hash`
- immutable product, price, flag, and tax snapshots
- `terms_version = dzn-store-sandbox-order-v1`

The item row is:

- quantity `1`
- account-bound
- guaranteed purchase
- no competitive advantage
- all paid-outcome columns fixed to `0`

## Response Contract

Successful response:

```json
{
  "ok": true,
  "order": {
    "status": "draft",
    "livemode": false,
    "product_count": 1,
    "checkout": {
      "available": false,
      "url": null,
      "session_id": null,
      "reason": "Stripe Checkout Session creation requires a later approved checkout runtime slice."
    }
  },
  "next_step": "checkout_session_creation_requires_future_approval"
}
```

The response must not expose:

- Raw Discord ids.
- Internal DZN user ids.
- Stripe customer ids.
- Checkout Session ids.
- PaymentIntent ids.
- Webhook event ids.
- Tax internals beyond the zero-tax sandbox snapshot.
- Private payment state.
- Card, CVC, bank, billing address, or payment method data.

## Fair Progression Boundary

This route cannot affect:

- Billing plans or owner entitlements.
- `/setup`, Nitrado linking, owner onboarding, owner dashboards, owner APIs, server management, or server ownership.
- Rankings, leaderboards, discovery score, reviews, review score, badges, seasons, crowns, Server Wars scoring, CTF scoring, event outcomes, bracket outcomes, player XP, earned calling-card awards, earned spins, wheel cooldowns, wheel odds, public profile visibility, retained exports, moderation decisions, or competitive eligibility.

## Production-Mutation Boundary

This slice must not run or approve:

- `npm run db:migrate:remote`
- `wrangler d1 migrations apply dzn_network_db --remote`
- `wrangler pages secret put`
- Stripe Product or Price creation.
- Stripe Checkout Session creation.
- Stripe webhook endpoint creation.
- Cloudflare Pages deployment.
- Nitrado or Discord mutations.
- Live checkout activation.
- Issue #49 mutation or merge.

## Tests And Acceptance Criteria

This slice is accepted only if tests prove:

- The route is disabled by default.
- Local/test runtime is required.
- Store, checkout, and sandbox checkout flags are required.
- Live checkout flags block before D1 access.
- Webhook fulfilment, Supporter Card, earned-spin, and wheel flags must stay disabled.
- Logged-out callers receive `401`.
- Oversized or invalid JSON bodies are rejected.
- Request body identity/payment/owner/server fields are rejected.
- The route writes only `store_orders` and `store_order_items`.
- The route never writes `store_payment_events`, account entitlements, Supporter Cards, earned spins, spin ledgers, or wheel cooldowns.
- Catalog safety violations block writes.
- The response reports checkout unavailable.
- No Stripe helper, webhook verifier, `fetch`, one-time payment mode, or Stripe Checkout Session creation appears in this route slice.
- Cloudflare config files and `cloudflare-env.d.ts` are unchanged.

## Next Recommended Slice

Next should be the DZN Store sandbox Checkout Session creation approval slice, only if deliberately approved: add test-mode Stripe Checkout Session creation after the pending local/test order exists, using server-controlled test Price binding, order-derived idempotency, no fulfilment, no Store webhook processing beyond any separately approved ledger-only receipt, no entitlements, no Supporter Cards, no earned spins, no wheel runtime, no Stripe object mutation, no Cloudflare secret/config mutation, no production D1 write, no live checkout activation, and no issue #49 change.
