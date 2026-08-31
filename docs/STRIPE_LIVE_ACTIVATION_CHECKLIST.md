# Stripe Live Activation Checklist

Issue #49 tracks the future human-approved Stripe live billing activation for DZN. This document is the safe handoff checklist only. It does not approve live billing, create Stripe products, set Cloudflare secrets, apply D1 migrations, deploy production, or change payment state.

The DZN Safe Monetisation and Supporter System implementation preflight is `docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md`. It defines future one-time Store checkout, supporter purchases, earned-only spins, and wheel/payment ledgers, but does not approve store live checkout, Stripe product/Price mutation, Cloudflare secret changes, production D1 writes, webhook fulfilment, account entitlement writes, or issue #49 changes.

The DZN Store sandbox order and checkout approval preflight is `docs/DZN_STORE_SANDBOX_ORDER_CHECKOUT_APPROVAL_PREFLIGHT.md`. It defines sandbox order creation, one-time Checkout Session shape, webhook event ledger, idempotent fulfilment, refund/chargeback revocation, tax/receipt records, feature flags, rollback, and proof matrix, but does not approve or implement checkout routes, order tables, Store webhooks, entitlement writes, Supporter Card issuance, earned-spin ledgers, wheel runtime, Stripe object mutation, Cloudflare secret/config mutation, production D1 writes, live checkout activation, or issue #49 changes.

The DZN Store sandbox order ledger schema is `docs/DZN_STORE_SANDBOX_ORDER_LEDGER_SCHEMA.md`. It adds source-controlled local/sandbox ledger schema only for `store_orders`, `store_order_items`, and `store_payment_events`. It does not approve production D1 migration application, checkout routes, Stripe Checkout Session creation, Store webhook handlers, webhook fulfilment, account entitlement writes, Supporter Card issuance, earned-spin ledgers, wheel runtime, Stripe object mutation, Cloudflare secret/config mutation, live checkout activation, or issue #49 changes.

The DZN Store webhook fulfilment approval preflight is `docs/DZN_STORE_WEBHOOK_FULFILMENT_APPROVAL_PREFLIGHT.md`. It defines future verified test-mode fulfilment rules only. It does not approve fulfilment route writes, account entitlement tables, Supporter Card tables, earned-spin ledgers, reward wheel runtime, Stripe Product/Price mutation, Cloudflare secret/config mutation, production D1 writes, live checkout activation, or issue #49 changes.

The DZN Store fulfilment ledger schema migration approval preflight is `docs/DZN_STORE_FULFILMENT_LEDGER_SCHEMA_PREFLIGHT.md`. It defines future local/test-only schema contracts for account entitlements, Supporter Cards, fulfilment attempts, status history, refund/dispute audit, uniqueness, and rollback only. It does not add or approve a migration file, production D1 apply, Store fulfilment runtime, account entitlement writes, Supporter Card issuance, earned-spin ledgers, reward wheel runtime, Stripe Product/Price mutation, Cloudflare secret/config mutation, live checkout activation, or issue #49 changes.

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
- `docs/DZN_STORE_WEBHOOK_FULFILMENT_APPROVAL_PREFLIGHT.md` defines future verified test-mode fulfilment, refund/chargeback rollback, exactly-once entitlement/card boundaries, and proof requirements only.
- `docs/DZN_STORE_FULFILMENT_LEDGER_SCHEMA_PREFLIGHT.md` defines future local/test fulfilment-ledger schema, uniqueness, status-history, refund/dispute audit, and rollback contracts only; it adds no migration file or runtime fulfilment.
- `docs/DZN_STORE_FULFILMENT_LEDGER_SCHEMA_MIGRATION.md` adds source-controlled local/test fulfilment ledger schema only through `migrations/0073_dzn_store_fulfilment_ledger_schema.sql`; it does not approve production D1 migration application, Store webhook fulfilment, Supporter Card issuance, earned spins, reward wheel runtime, live checkout, or issue #49 changes.
- The DZN Store fulfilment runtime implementation approval preflight is `docs/DZN_STORE_FULFILMENT_RUNTIME_IMPLEMENTATION_PREFLIGHT.md`; it defines the future disabled-by-default local/test fulfilment runtime contract, exact write scope, idempotency, account-entitlement creation, optional Supporter Card issuance, refund/dispute rollback, proof matrix, and rollback path only. It does not approve runtime implementation, live checkout, Stripe mutation, Cloudflare config mutation, production D1 writes, or issue #49 changes.
- `docs/DZN_STORE_FULFILMENT_RUNTIME_IMPLEMENTATION.md` adds disabled-by-default local/test Store fulfilment runtime for verified Store receipts only. It does not approve live checkout, production D1 migration application, Stripe Product/Price/customer/refund/dispute/webhook endpoint mutation, Cloudflare config mutation, earned-spin ledger, reward wheel runtime, public Supporter Card reveal, account purchases UI, or issue #49 changes.
  This runtime does not approve issue #49 changes.
- `docs/DZN_STORE_FULFILMENT_RECONCILIATION_READ_MODEL_PREFLIGHT.md` defines private Account Purchases and Entitlements read models, private Supporter Card reveal/status UI, webhook replay/manual-review controls, and refund/dispute operator workflow only. It does not add account purchase routes, entitlement routes, card reveal UI, replay/manual-review/refund-dispute operator routes, notifications, migrations, production D1 applies, live checkout activation, Stripe mutation, Cloudflare config mutation, earned-spin ledger, reward wheel runtime, or issue #49 changes.
- `docs/DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_IMPLEMENTATION.md` adds the disabled-by-default private Account Purchases read model through `GET /api/account/purchases`. It is current-user scoped, private/no-store, sanitized, local/test sandbox only, and read-only. It does not approve public Supporter Card reveal, Account Purchases UI, webhook replay/manual-review/refund-dispute operator routes, notifications, migrations, production D1 applies, live checkout activation, Stripe mutation, Cloudflare config mutation, earned-spin ledger, reward wheel runtime, or issue #49 changes.
- `docs/DZN_STORE_ACCOUNT_PURCHASES_UI_SHELL.md` adds the private Account Purchases UI shell at `/account/purchases`. It consumes only `GET /api/account/purchases`, shows sanitized purchase, entitlement, and private Supporter Card status, and keeps Supporter Card reveal blocked. It does not approve webhook replay/manual-review/refund-dispute operator routes, notifications, migrations, production D1 applies, live checkout activation, Stripe mutation, Cloudflare config mutation, earned-spin ledger, reward wheel runtime, or issue #49 changes.
- `docs/DZN_STORE_SUPPORTER_CARD_REVEAL_APPROVAL_PREFLIGHT.md` defines the future private Supporter Card reveal boundary only. It requires current-user account ownership proof, serial/art redaction, private/no-store responses, visibility separation, screenshot/export rules, audit requirements, rollback, and security proof before any reveal runtime. It does not approve a card reveal route, private reveal component, public reveal, card-art generation, sharing controls, notifications, migrations, production D1 applies, live checkout activation, Stripe mutation, Cloudflare config mutation, earned-spin ledger, reward wheel runtime, or issue #49 changes.
- `docs/DZN_STORE_SUPPORTER_CARD_REVEAL_IMPLEMENTATION.md` adds the disabled-by-default private Supporter Card reveal implementation through `GET /api/account/supporter-cards/[cardRef]/reveal`. It is authenticated, current-user scoped, private/no-store, local/test sandbox only, read-only, and requires Store order, order item, account entitlement, and Supporter Card ownership proof before showing a serial/status. It does not approve public Supporter Card reveal, card-art generation, sharing controls, screenshot/export controls, notifications, migrations, production D1 applies, live checkout activation, Stripe mutation, Cloudflare config mutation, earned-spin ledger, reward wheel runtime, or issue #49 changes.
- `docs/DZN_STORE_SUPPORTER_CARD_REVEAL_VISUAL_QA.md` adds private `/account/purchases` visual polish and local seeded preview evidence only. It keeps Supporter Card serials masked before the existing private reveal proof and does not approve generated card art, public reveal, sharing controls, screenshot/export controls, notifications, migrations, production D1 applies, live checkout activation, Stripe mutation, Cloudflare config mutation, earned-spin ledger, reward wheel runtime, chat runtime, AI provider credentials, metered model calls, or issue #49 changes.

The Store order route writes only pending local/test `store_orders` and `store_order_items` after explicit sandbox flags and catalog safety checks pass. It must not create Stripe Checkout Sessions, process Store webhooks, write `store_payment_events`, grant entitlements, issue Supporter Cards, mint earned spins, run the wheel, mutate Stripe objects, mutate Cloudflare secrets/config, write production D1, enable live checkout, or change issue #49.

The Store sandbox Checkout Session route can create only a test-mode `mode=payment` Checkout Session after an owned draft local/test order exists. It updates only `store_orders` to `checkout_created` and keeps `DZN_LIVE_CHECKOUT_ENABLED` unset/false. It must not process Store webhooks, write `store_payment_events`, grant entitlements, issue Supporter Cards, mint earned spins, run the wheel, mutate Stripe Products/Prices/Customers/webhook endpoints/refunds/disputes, mutate Cloudflare secrets/config, write production D1, enable live checkout, or change issue #49.

The Store sandbox webhook event ledger receipt route is `POST /api/stripe/store-webhook`. It remains disabled unless `DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_ENABLED=true` is supplied in local/test runtime. It verifies Stripe signatures and records sanitized test-mode `store_payment_events` receipt rows only. It has no fulfilment, no entitlement writes, no Supporter Card issuance, no earned spins, no wheel runtime, no Stripe Product/Price mutation, no Cloudflare config mutation, no production D1 writes, and does not approve live checkout or issue #49 changes.

The Store webhook fulfilment approval preflight leaves that route receipt-only and leaves the `store_payment_events` fulfilment blockers fixed to `0`. Any future fulfilment implementation must be a separate approved local/test runtime slice with schema approval, exactly-once proof, refund/dispute proof, no paid-spin proof, no owner entitlement proof, no production mutation proof, and no issue #49 change unless explicitly approved there.

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
