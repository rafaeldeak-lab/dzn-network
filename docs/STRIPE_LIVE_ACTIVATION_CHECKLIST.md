# Stripe Live Activation Checklist

Issue #49 tracks the future human-approved Stripe live billing activation for DZN. This document is the safe handoff checklist only. It does not approve live billing, create Stripe products, set Cloudflare secrets, apply D1 migrations, deploy production, or change payment state.

The DZN Safe Monetisation and Supporter System implementation preflight is `docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md`. It defines future one-time Store checkout, supporter purchases, earned-only spins, and wheel/payment ledgers, but does not approve store live checkout, Stripe product/Price mutation, Cloudflare secret changes, production D1 writes, webhook fulfilment, account entitlement writes, or issue #49 changes.

The DZN Store sandbox order and checkout approval preflight is `docs/DZN_STORE_SANDBOX_ORDER_CHECKOUT_APPROVAL_PREFLIGHT.md`. It defines sandbox order creation, one-time Checkout Session shape, webhook event ledger, idempotent fulfilment, refund/chargeback revocation, tax/receipt records, feature flags, rollback, and proof matrix, but does not approve or implement checkout routes, order tables, Store webhooks, entitlement writes, Supporter Card issuance, earned-spin ledgers, wheel runtime, Stripe object mutation, Cloudflare secret/config mutation, production D1 writes, live checkout activation, or issue #49 changes.

The DZN Store sandbox order ledger schema is `docs/DZN_STORE_SANDBOX_ORDER_LEDGER_SCHEMA.md`. It adds source-controlled local/sandbox ledger schema only for `store_orders`, `store_order_items`, and `store_payment_events`. It does not approve production D1 migration application, checkout routes, Stripe Checkout Session creation, Store webhook handlers, webhook fulfilment, account entitlement writes, Supporter Card issuance, earned-spin ledgers, wheel runtime, Stripe object mutation, Cloudflare secret/config mutation, live checkout activation, or issue #49 changes.

## Activation Boundary

Live billing activation is high-risk billing and production-mutation work.

AutoDev may inspect, test, and prepare PRs for billing safety, but it must not run live Stripe activation unattended. A PR merge is not approval to create Stripe products, create Prices, change webhook endpoints, set Cloudflare production variables or secrets, apply production D1 migrations, import customers, or enable payments.

Required approval must be explicit in the active task and must name the live production mutation being approved. Generic messages such as "next", "continue", "fix billing", or "set up Stripe" are not enough.

## Current Public Billing Model

Only these plans are purchasable for new customers:

| Plan | Public contract | Billing behavior |
| --- | --- | --- |
| Starter | 2-day free trial | GBP 0 today, then GBP 2/month after the trial unless cancelled |
| Pro | Full DZN Access | GBP 10/month charged immediately and renewed monthly |

Premium, Network, and Partner are historical compatibility values only. They may remain readable for old Stripe events, invoices, subscriptions, and database rows, but they must not be shown as new public checkout options.

## Fair Competition

Plans may unlock presentation, owner tools, publishing cadence, promotion credits, analytics, additional server allowance, and Pro discovery surfaces.

Plans must never change:

- leaderboard rank
- server rank
- player rank
- kills, deaths, K/D, longest kill, or survival stats
- event standings or match outcomes
- Server Wars scoring
- season wins
- crowns
- earned badges
- reputation awards
- ADM ingestion or stat formulas

## Required Preconditions

Before any live activation is approved:

- Production is healthy on the latest `main`.
- PR #45's live readiness gate is present in production.
- `/api/billing/readiness` is admin-only and returns `401` when unauthenticated.
- `/api/billing/readiness` never exposes secret values or Stripe Price IDs.
- `npm run check:billing-config` remains read-only and prints variable names/status only.
- `/api/billing/plans` publicly returns Starter and Pro only.
- Live checkout remains paused until the final approved go-live step sets `DZN_LIVE_CHECKOUT_ENABLED=true`.
- Starter trial abuse protection is present and reviewed before live billing is enabled.
- No public copy advertises Premium, Network, or Partner as purchasable plans.
- Any needed D1 migration has been separately approved, applied, and verified before live billing is enabled.

## Human Live Setup Steps

These steps are manual, deliberate production operations. They must not be converted into an unattended AutoDev script or GitHub Action.

1. Confirm the live Stripe account is selected, not test mode.
2. Create or confirm the live `DZN Starter` product and recurring monthly Price.
3. Confirm Starter Checkout uses a two-day trial and then GBP 2/month.
4. Create or confirm the live `DZN Pro` product and recurring monthly Price.
5. Confirm Pro is GBP 10/month with no trial.
6. Confirm Premium, Network, and Partner are archived or hidden from new public purchase paths.
7. Configure the live production webhook endpoint for DZN.
8. Confirm live webhook delivery for:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
9. Set or verify the Cloudflare production variable/secret names only:
   - `STRIPE_PRICE_STARTER`
   - `STRIPE_PRICE_PRO`
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `DZN_APP_URL` or `NEXT_PUBLIC_APP_URL`
10. Run the read-only readiness check as an authenticated admin/support/dev user.
11. Confirm `liveConfigurationReady: true`, `humanApprovalRequiredForLiveBilling: true`, and `productionMutationAllowedByReadinessCheck: false`.
12. Keep `DZN_LIVE_CHECKOUT_ENABLED` unset while performing sandbox/test readiness. In this state, live checkout should report `checkoutSessionCreationAllowed: false`.
13. Only after a separate explicit go-live approval, set `DZN_LIVE_CHECKOUT_ENABLED=true` to allow live customer checkout.
14. Run read-only production smoke after activation.

## Evidence Rules

Record evidence without secrets:

- Stripe product names and prices are okay.
- Stripe mode can be recorded as live/test.
- Cloudflare variable names are okay.
- Secret values, webhook signing secrets, Price IDs, customer IDs, payment details, and signed webhook payloads must not be pasted into issues, PRs, logs, screenshots, or chat.

`NEXT_PUBLIC_STRIPE_*_PRICE_ID` values are fallback compatibility aliases only. They must not be used as proof that live billing is ready.

## AutoDev Hard Blocks

AutoDev must treat these as blocked unless a future high-risk human-approved redesign explicitly changes the automation model:

- `stripe products create`
- `stripe prices create`
- `stripe webhook_endpoints create`
- script or workflow calls to Stripe live mutation APIs for products, Prices, webhooks, customers, or subscriptions
- `wrangler pages secret put STRIPE_PRICE_STARTER`
- `wrangler pages secret put STRIPE_PRICE_PRO`
- `wrangler pages secret put STRIPE_SECRET_KEY`
- `wrangler pages secret put STRIPE_WEBHOOK_SECRET`
- `wrangler pages secret put DZN_LIVE_CHECKOUT_ENABLED`
- unattended "go live" or "activate live billing" scripts

Read-only checks remain allowed when they do not expose secret values, mutate production, or imply approval.

## DZN Store Sandbox Boundaries

The DZN Store Safe Monetisation track is separate from this live owner-subscription checklist.

- `docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md` defines the future Store production sequence but does not approve store live checkout.
- `docs/DZN_STORE_SANDBOX_ORDER_CHECKOUT_APPROVAL_PREFLIGHT.md` defines sandbox order, checkout, webhook, fulfilment, refund, tax, rollback, and proof contracts only.
- `docs/DZN_STORE_SANDBOX_ORDER_LEDGER_SCHEMA.md` adds source-controlled local/sandbox ledger schema only and does not approve production D1 migration application.
- `docs/DZN_STORE_SANDBOX_ORDER_CREATION_ROUTE_APPROVAL.md` adds a disabled-by-default local/test pending-order route only and does not approve Stripe Checkout Session creation.
- `docs/DZN_STORE_SANDBOX_CHECKOUT_SESSION_APPROVAL.md` adds a disabled-by-default test-mode Store Checkout Session route only and does not approve Store webhook fulfilment, entitlement writes, Supporter Card issuance, earned spins, reward wheel runtime, production D1 writes, live checkout activation, or issue #49 changes.

The Store order route writes only pending local/test `store_orders` and `store_order_items` after explicit sandbox flags and catalog safety checks pass. It must not create Stripe Checkout Sessions, process Store webhooks, write `store_payment_events`, grant entitlements, issue Supporter Cards, mint earned spins, run the wheel, mutate Stripe objects, mutate Cloudflare secrets/config, write production D1, enable live checkout, or change issue #49.

The Store sandbox Checkout Session route can create only a test-mode `mode=payment` Checkout Session after an owned draft local/test order exists. It updates only `store_orders` to `checkout_created` and keeps `DZN_LIVE_CHECKOUT_ENABLED` unset/false. It must not process Store webhooks, write `store_payment_events`, grant entitlements, issue Supporter Cards, mint earned spins, run the wheel, mutate Stripe Products/Prices/Customers/webhook endpoints/refunds/disputes, mutate Cloudflare secrets/config, write production D1, enable live checkout, or change issue #49.

## Stop Conditions

Stop the activation and leave billing inactive if any of these are true:

- Production health is not verified.
- Starter trial abuse protection is absent or unreviewed.
- Live and test Stripe objects are mixed.
- `/api/billing/readiness` exposes a secret value or Price ID.
- The public plan API shows Premium, Network, or Partner as purchasable.
- Any plan appears to alter rank, scoring, badges, crowns, reputation, or match outcomes.
- Cloudflare production secret setup or D1 migration approval is unclear.
- The requested action would mutate production without explicit approval in the active task.
