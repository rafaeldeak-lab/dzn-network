# DZN Store Sandbox Webhook Event Ledger Receipt

## Status And Boundary

This slice adds the first DZN Store sandbox webhook receipt route, disabled by default:

- `functions/api/stripe/store-webhook.ts`
- `functions/_lib/dzn-store-webhook.ts`
- `POST /api/stripe/store-webhook`

The route verifies Stripe signatures and records sanitized test-mode `store_payment_events` receipt rows only. It does not fulfil orders and does not grant anything to an account.

Required local/test gates:

- `DZN_STORE_SANDBOX_RUNTIME=local` or `test`
- `DZN_STORE_ENABLED=true`
- `DZN_STORE_CHECKOUT_ENABLED=true`
- `DZN_STORE_SANDBOX_CHECKOUT_ENABLED=true`
- `DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_ENABLED=true`
- `DZN_STORE_LIVE_CHECKOUT_ENABLED=false`
- `DZN_LIVE_CHECKOUT_ENABLED` remains unset/false.
- `DZN_STORE_WEBHOOK_FULFILMENT_ENABLED=false`
- `DZN_SUPPORTER_CARDS_ENABLED=false`
- `DZN_EARNED_SPINS_ENABLED=false`
- `DZN_REWARD_WHEEL_ENABLED=false`
- `STRIPE_WEBHOOK_SECRET` must be a bounded `whsec_` signing secret.

No Cloudflare variables, secrets, bindings, Pages config, or Workers config are added. These flags are read only from the current local/test runtime environment and remain absent from source-controlled Cloudflare config.

This slice creates no live payment path. It still does not add, create, mutate, or enable:

- No live Stripe event processing.
- No Store webhook fulfilment.
- No order fulfilment.
- No fulfilment is attempted.
- No account entitlement write.
- No account entitlement is granted.
- No Supporter Card issuance.
- No Supporter Card is issued.
- No earned spin or spin ledger write.
- No earned spin is minted.
- No reward wheel runtime.
- No reward wheel runtime runs.
- No account purchases screen.
- No Stripe Product, Price, Customer, Checkout Session, refund, dispute, or webhook endpoint mutation.
- No owner subscription, `/setup`, Nitrado, server-management, or server-ownership access change.
- No analytics, tracking, AI provider credentials, vector stores, metered model calls, Nitrado mutation, or Discord mutation.
- No production D1 write or remote migration apply.
- No live checkout activation.
- No issue #49 change.
- Issue #49 remains reserved for final live checkout activation.

## Architecture Found

DZN already has:

- Owner subscription checkout at `functions/api/billing/create-checkout-session.ts` using `mode: "subscription"`.
- Owner subscription webhook handling at `functions/api/stripe/webhook.ts`.
- Canonical owner billing/readiness safety in `functions/_lib/plans.ts`.
- Store catalog safety helpers in `functions/_lib/dzn-store-catalog.ts`.
- Store sandbox pending order creation in `functions/_lib/dzn-store-orders.ts` and `functions/api/store/orders.ts`.
- Store sandbox Checkout Session creation in `functions/_lib/dzn-store-checkout.ts` and `functions/api/store/orders/[orderId]/checkout.ts`.
- Store catalog schema in `migrations/0071_dzn_store_catalog_admin_draft.sql`.
- Store order ledger schema in `migrations/0072_dzn_store_order_ledger_schema.sql`, including `store_payment_events`.
- A read-only `/store` preview surface that must not call Store or billing APIs.

The Store sandbox webhook route is deliberately separate from owner billing. It does not call the owner entitlement layer and cannot satisfy the owner gate used by `/setup`, Nitrado linking, owner dashboards, owner onboarding, or server-management APIs.

## External References Reviewed On 2026-08-28

- Stripe webhook signature verification requires the exact raw request body and `Stripe-Signature` header: https://docs.stripe.com/webhooks/signature
- Stripe webhook endpoints receive Event objects and should acknowledge received events only after local processing succeeds: https://docs.stripe.com/webhooks
- Stripe event types include Checkout Session, PaymentIntent, refund, charge refund, and dispute events used by this receipt contract: https://docs.stripe.com/api/events/types
- Cloudflare Pages Functions receive runtime bindings through `context.env`: https://developers.cloudflare.com/pages/functions/bindings/
- Cloudflare D1 prepared statements use `prepare`, `bind`, `first`, `run`, and parameter binding: https://developers.cloudflare.com/d1/worker-api/prepared-statements/
- Cloudflare D1 worker bindings expose the D1 Database API used by Pages Functions: https://developers.cloudflare.com/d1/worker-api/d1-database/

## Runtime Contract

Canonical endpoint:

```text
POST /api/stripe/store-webhook
```

Authentication:

- No player session is required because Stripe webhook requests are authenticated by signature.
- Verify the `Stripe-Signature` header against the unmodified raw request body before parsing.
- Missing, malformed, or mismatched signatures return `400` and no D1 write.
- Missing Store sandbox flags or webhook secret returns `403` and no D1 write.

Accepted mode:

- Test-mode events only.
- `event.livemode` must be exactly `false`.
- Live-mode events return `422` and no D1 write.

## Stored Receipt Contract

The route writes only `store_payment_events`.

Stored fields include:

- Unique `stripe_event_id`.
- `event_type`.
- `event_class`: `checkout`, `payment_intent`, `refund`, `dispute`, or `ignored`.
- `ledger_scope`: `local` or `sandbox`.
- `livemode = 0`.
- Optional related local/sandbox order id when it safely resolves to an existing `store_orders` row.
- Optional provider references for Checkout Session, PaymentIntent, charge, refund, and dispute ids.
- Raw event SHA-256 hash.
- `sanitized_summary_json`.
- No-fulfilment blockers fixed to `0`.

Duplicate Stripe event ids use `ON CONFLICT(stripe_event_id) DO NOTHING` and return a duplicate receipt response without additional rows or side effects.

## Sanitization Rules

`sanitized_summary_json` may include:

- Schema version and route.
- Event type and class.
- Stripe API version and created timestamp.
- Stripe object type.
- Safe status/mode strings.
- Whether safe provider references are present.
- DZN metadata key names only, not values.
- Guard booleans proving fulfilment, entitlement, Supporter Card, earned spin, wheel runtime, raw event body storage, customer details storage, payment-method storage, and live checkout are all disabled.

It must not store:

- Raw event body.
- Customer email.
- Customer name.
- Customer billing address.
- Payment method details.
- Card, CVC, bank, or wallet data.
- Full customer object.
- Success-page redirect state as proof of entitlement.

## Event Families

Receipt rows are classified as:

- `checkout`: `checkout.session.*`
- `payment_intent`: `payment_intent.*`
- `refund`: `refund.*` and `charge.refunded`
- `dispute`: `charge.dispute.*`
- `ignored`: verified test-mode events outside those families

Ignored events may be recorded with `processing_status = ignored` for audit clarity, but they do not trigger fulfilment.

## Fair Progression Boundary

This route cannot affect:

- Billing plans or owner entitlements.
- Store order state beyond receipt rows.
- Account entitlements.
- Supporter Cards.
- Earned spins.
- Wheel cooldowns or wheel odds.
- `/setup`, Nitrado linking, owner onboarding, owner dashboards, owner APIs, server management, or server ownership.
- Rankings, leaderboards, discovery score, reviews, review score, badges, seasons, crowns, Server Wars scoring, CTF scoring, event outcomes, bracket outcomes, player XP, earned calling-card awards, public profile visibility, retained exports, moderation decisions, or competitive eligibility.

## Production-Mutation Boundary

This slice must not run or approve:

- `npm run db:migrate:remote`
- `wrangler d1 migrations apply dzn_network_db --remote`
- `wrangler pages secret put`
- Stripe Product or Price creation.
- Stripe webhook endpoint creation.
- Stripe refund or dispute mutation.
- Store webhook fulfilment.
- Account entitlement writes.
- Supporter Card issuance.
- Earned-spin or reward-wheel runtime.
- Cloudflare Pages deployment.
- Nitrado or Discord mutations.
- Live checkout activation.
- Issue #49 mutation or merge.

## Tests And Acceptance Criteria

This slice is accepted only if tests prove:

- The route is disabled by default.
- Local/test runtime is required.
- Store, checkout, sandbox checkout, and webhook receipt flags are required.
- `STRIPE_WEBHOOK_SECRET` must be a bounded `whsec_` signing secret.
- Stripe signatures are verified with the raw request body before parsing.
- Invalid signatures write no ledger rows.
- Live checkout flags block before D1 writes.
- Webhook fulfilment, Supporter Card, earned-spin, and wheel flags must stay disabled.
- Live-mode Stripe events are blocked before D1 writes.
- Test-mode Checkout Session, PaymentIntent, refund, charge refund, dispute, and ignored events map to the correct receipt classes.
- Duplicate Stripe event ids are side-effect-free.
- The route writes only `store_payment_events`.
- The route never writes or updates `store_orders`, `store_order_items`, account entitlements, Supporter Cards, earned spins, spin ledgers, or wheel cooldowns.
- Stored summaries omit customer details, payment method details, and raw event bodies.
- Cloudflare config files and `cloudflare-env.d.ts` are unchanged.

## Next Recommended Slice

Next should be Store webhook fulfilment approval preflight only if deliberately approved: define the verified test-mode fulfilment contract, exact eligible events, order-status transitions, idempotent entitlement/supporter-card boundaries, refund/chargeback rollback rules, and proof matrix before any fulfilment route writes account entitlements, Supporter Cards, earned spins, wheel runtime, live checkout activation, Stripe Product/Price mutation, Cloudflare config mutation, production D1 writes, or issue #49 changes.
