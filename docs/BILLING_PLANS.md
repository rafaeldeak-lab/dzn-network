# DZN Billing Plans

## Active Purchasable Plans

Only these plans may be shown as new customer-facing checkout options:

| Plan | Public label | Price | Trial | Public/advert publication | Linked servers | Promotion credits |
| --- | --- | ---: | --- | --- | ---: | ---: |
| Starter | 2-day free trial | £0 today, then £2/month | 2 days | Every 72 hours after a successful publication | 1 | 0 |
| Pro | Full DZN Access | £10/month | None | Every 24 hours after a successful publication | 3 | 2 per Stripe billing period |

Starter must not be described simply as free. Customer-facing copy must clearly say:

- "Starter - 2-day free trial"
- "£0 today, then £2/month."
- "First payment: £2 after the two-day trial. Cancel before trial expiry to pay nothing."
- "Charged automatically every month until cancelled."

Pro customer-facing copy must clearly say:

- "Pro - Full DZN Access"
- "£10/month."
- "Charged immediately and renewed monthly until cancelled."

## Starter Trial Abuse Protection

Starter is a one-time trial, not a repeatable free plan.

Before live billing is enabled, DZN must enforce one Starter trial claim per DZN Discord user and, when a Stripe customer is already known, one Starter trial claim per Stripe customer.

The durable trial claim is stored in `owner_starter_trial_claims`. A Starter checkout attempt reserves the claim before creating a Stripe Checkout Session so concurrent requests cannot create multiple trial sessions for the same DZN user. After Stripe confirms checkout or subscription state, webhook handling attaches the Stripe customer, subscription, checkout session, and current status to the same claim.

Cancelled, expired, failed, or completed Starter trials still count as used. A customer who has already claimed Starter should choose Pro or manage their existing billing account rather than starting another Starter trial.

Trial enforcement is billing-sensitive. Applying the trial-claim migration, enabling live Stripe prices, changing checkout/webhook behavior, importing existing Stripe customers, or repairing production trial claims remains high-risk billing work requiring human review and explicit approval.

## Live Stripe Readiness

Live billing must not be enabled because the public pricing UI looks correct or because test-mode checkout works. The readiness gate is:

- Starter checkout uses `STRIPE_PRICE_STARTER` as a server-side Cloudflare Pages variable.
- Pro checkout uses `STRIPE_PRICE_PRO` as a server-side Cloudflare Pages variable.
- `STRIPE_SECRET_KEY` is live mode.
- `STRIPE_WEBHOOK_SECRET` belongs to the live production webhook endpoint.
- `DZN_APP_URL` or `NEXT_PUBLIC_APP_URL` points at the production DZN domain, not a preview URL.
- `/api/billing/readiness` reports `liveConfigurationReady: true` without exposing secret values or Price IDs.

`NEXT_PUBLIC_STRIPE_*_PRICE_ID` variables are compatibility fallbacks only. They can keep old checkout paths working during rollout, but they are not valid evidence for live billing readiness.

`liveConfigurationReady: true` means the live configuration shape is ready for review. It does not mean real customer checkout is enabled.

Live Stripe checkout is paused by default unless `DZN_LIVE_CHECKOUT_ENABLED=true` is deliberately set during a later approved go-live step. Test-mode Stripe checkout remains available for sandbox validation without that flag. In live mode, `/api/billing/create-checkout-session` must refuse checkout before reserving a Starter trial claim, writing D1, or calling Stripe when the flag is not enabled.

The readiness check is read-only. Live Stripe product/price creation, webhook endpoint changes, Cloudflare secret changes, D1 migration application, customer import, checkout enablement, and payment enablement remain separate high-risk human-approved operations.

Use `docs/STRIPE_LIVE_ACTIVATION_CHECKLIST.md` with Issue #49 before any future live billing activation. That checklist is a non-mutating human handoff; it is not an AutoDev activation script.

## Public Subscription Contract

The active non-production-mutation contract is stored in `lib/billing/plans.ts` as `SUBSCRIPTION_PLAN_PUBLIC_CONTRACT`. It is safe public metadata for UI, docs, and tests. It does not create Stripe Prices, change live Stripe state, apply production migrations, or mutate production data.

| Plan | Discovery treatment | Badge showcase | Organic bump cooldown |
| --- | --- | ---: | --- |
| Starter | Standard listing and search placement | 3 badges | 30 days |
| Pro | Full DZN Access, featured rotation, spotlight eligibility, advanced profile presentation | 8 badges | 7 days |

## Legacy Plan Compatibility

`premium`, `network`, and `partner` are legacy read/input compatibility values only.

They must not be purchasable through new checkout, billing cards, plan comparison pages, or `/api/billing/plans` output. Existing stored Premium, Network, and Partner values may still be read so old Stripe events, invoices, subscriptions, and database rows remain compatible.

Legacy Premium, Network, and Partner subscriptions map to effective Pro capabilities. Do not delete or rewrite Stripe history. Do not expose legacy plans through new Checkout Sessions.

Keep these server-only compatibility variables only while old active legacy subscriptions may still emit webhook events with archived Price IDs:

```text
STRIPE_PRICE_PREMIUM
STRIPE_PRICE_NETWORK
STRIPE_PRICE_PARTNER
```

They are not required for new checkout readiness.

## Fair Competition

Paid access must never alter competitive results. Starter, Pro, and legacy-mapped accounts must receive equal treatment for:

- leaderboard calculations
- server ranking calculations
- player ranking calculations
- kills, deaths, K/D, longest kill, and longest-lived statistics
- ratings and reviews
- event scoring
- Server Wars scoring
- season wins, crowns, and earned badges
- ADM ingestion, statistics syncing, and leaderboard processing

Pro purchases presentation, automation, promotion, analytics, additional server allowance, and advanced owner tools. It does not buy leaderboard rank, crowns, badges, reviews, or gameplay results.

## Future Store And Supporter Purchases

The DZN Safe Monetisation and Supporter System implementation preflight is `docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md`.

Future one-time Store purchases are separate from Starter/Pro owner subscriptions. They may grant guaranteed account-bound cosmetics or supporter recognition only, such as the planned `DZN FOUNDING SUPPORTER PACK`, and must use a separate Store order/payment/entitlement ledger with verified webhook fulfilment before anything is granted.

The DZN Store catalog and admin product/price draft model adds only inactive product/price metadata in `store_products` and `store_prices`. It does not create Stripe Products or Prices, does not create checkout sessions, and does not fulfil orders. Draft validation keeps Stripe Price IDs unbound in this slice.

The read-only `/store` preview is not an owner subscription checkout path. It may show safe catalog metadata, guaranteed-purchase/account-bound/no-competitive-advantage labels, and sample-only Supporter Card preview copy. It does not create one-time Checkout Sessions, orders, entitlements, supporter cards, earned spins, wheel runtime, or live payment activation.

The DZN Store sandbox order and checkout approval preflight defines the future authenticated order creation and one-time Stripe Checkout contract using `mode=payment`, but it is still documentation/test-guard work only. No checkout route, Store order table, payment webhook, entitlement write, Supporter Card issuance, earned-spin ledger, wheel runtime, live checkout activation, or issue #49 change is added by that preflight.

The DZN Store sandbox order ledger schema adds local/sandbox-only `store_orders`, `store_order_items`, and `store_payment_events` tables. Those tables are fixed to `livemode = 0`, one item per order, immutable product/price/tax snapshots, unique provider event ids, sanitized event summaries, and no-fulfilment blockers. No Store order creation route, Stripe Checkout Session, webhook fulfilment, account entitlement write, Supporter Card issuance, earned-spin ledger, wheel runtime, live checkout activation, production D1 apply, or issue #49 change is added.

The DZN Store sandbox order creation route is separate from Starter/Pro owner subscriptions. It adds a disabled-by-default authenticated `POST /api/store/orders` path that can write pending local/test `store_orders` and `store_order_items` only when Store sandbox flags and catalog safety checks pass. It does not create Stripe Checkout Sessions or grant owner setup access. It does not change `DZN_LIVE_CHECKOUT_ENABLED`. It does not change live checkout readiness, owner billing accounts, owner plan entitlements, server ownership, Nitrado access, production D1, or issue #49.

The DZN Store sandbox Checkout Session route remains separate from Starter/Pro owner subscriptions. `POST /api/store/orders/:orderId/checkout` can create a test-mode Stripe Checkout Session only after an authenticated player owns a pending local/test Store order, all Store sandbox checkout flags are explicitly enabled, and `STRIPE_SECRET_KEY` is a test-mode key. It updates only `store_orders` to `checkout_created`; the success redirect does not grant anything. It does not change `DZN_LIVE_CHECKOUT_ENABLED`. It does not change live checkout readiness, owner billing accounts, owner plan entitlements, server ownership, Nitrado access, production D1, or issue #49.

The DZN Store sandbox webhook event ledger receipt slice adds a disabled-by-default signed receipt route. `POST /api/stripe/store-webhook` can record only sanitized test-mode `store_payment_events` rows after the Stripe signature verifies and Store sandbox webhook receipt flags are explicitly enabled. It records only sanitized test-mode `store_payment_events` rows. It does not grant owner access, account entitlements, Supporter Cards, spins, XP, rankings, discovery, reviews, badges, seasons, events, Server Wars, CTF scoring, or competitive eligibility. It does not change `DZN_LIVE_CHECKOUT_ENABLED`, live checkout readiness, owner billing accounts, owner plan entitlements, server ownership, Nitrado access, production D1, or issue #49.

The DZN Store webhook fulfilment approval preflight defines the future verified test-mode fulfilment contract. It documents eligible Checkout Session events, order-status transitions, exactly-once account-entitlement and Supporter Card boundaries, refund/chargeback rollback, and proof requirements before any Store payment can grant anything. It adds no fulfilment route writes, account entitlement tables, Supporter Card tables, earned-spin ledgers, wheel runtime, live checkout activation, Stripe Product/Price mutation, Cloudflare secret/config mutation, production D1 write, or issue #49 change. The current Store webhook remains receipt-only.

The DZN Store fulfilment ledger schema migration approval preflight defines the future local/test schema contract. It covers account entitlements, Supporter Cards, fulfilment attempts, order-status history, entitlement-status history, refund/dispute audit, uniqueness constraints, and rollback before any migration file or runtime fulfilment exists. It adds no migration file, Store fulfilment runtime, account entitlement table, Supporter Card table, earned-spin ledger, wheel runtime, live checkout activation, production D1 apply, or issue #49 change.

The DZN Store fulfilment ledger schema migration adds local/test-only private ledger tables through `migrations/0073_dzn_store_fulfilment_ledger_schema.sql`. It does not grant owner access, account entitlements at runtime, Supporter Cards at runtime, spins, XP, rankings, discovery, reviews, badges, seasons, events, Server Wars, CTF scoring, or competitive eligibility. It does not change `DZN_LIVE_CHECKOUT_ENABLED`, live checkout readiness, owner billing accounts, owner plan entitlements, server ownership, Nitrado access, production D1, or issue #49.

The DZN Store fulfilment runtime implementation approval preflight defines the future disabled-by-default local/test fulfilment runtime contract in `docs/DZN_STORE_FULFILMENT_RUNTIME_IMPLEMENTATION_PREFLIGHT.md`. Store runtime fulfilment remains separate from owner Starter/Pro billing: future Store account entitlements and Supporter Cards are account-bound cosmetic/supporter recognition only and must not unlock owner setup, Nitrado, dashboards, server management, server ownership, plans, rankings, discovery, reviews, events, Server Wars, CTF scoring, XP awards, calling-card awards, public profile visibility, retained exports, moderation decisions, or competitive eligibility. This preflight adds no runtime writes, live checkout, Stripe mutation, Cloudflare config mutation, production D1 write, or issue #49 change.

The DZN Store fulfilment runtime implementation adds disabled-by-default local/test processing in `docs/DZN_STORE_FULFILMENT_RUNTIME_IMPLEMENTATION.md` and `functions/_lib/dzn-store-fulfilment.ts`. It can process verified `checkout.session.completed` Store receipts into idempotent fulfilment attempts, status history, exactly one safe account entitlement per source order item, optional Supporter Card issuance when independently flagged, and refund/dispute audit and rollback. Store fulfilment remains separate from owner Starter/Pro billing and still does not grant owner access, setup, Nitrado, server ownership, spins, XP, rankings, discovery, reviews, badges, seasons, events, Server Wars, CTF scoring, calling-card awards, public profile visibility, retained exports, moderation decisions, or competitive eligibility. It does not enable live checkout, mutate Stripe Products/Prices, mutate Cloudflare config, write production D1, or change issue #49.

The DZN Store fulfilment reconciliation/read-model preflight defines future private Account Purchases and Entitlements read models in `docs/DZN_STORE_FULFILMENT_RECONCILIATION_READ_MODEL_PREFLIGHT.md`. Future Store customer reads must be private, current-user scoped, no-store, and sanitized. Future Supporter Card reveal/status UI must start private and must not become public without a separate opt-in/privacy proof. Future webhook replay, manual review, and refund/dispute operator workflow must require configured DZN admin/operator scope, not owner Starter/Pro entitlement. This preflight adds no account purchases route, entitlements route, public card reveal, operator route, notification, migration, live checkout, Stripe mutation, Cloudflare config mutation, production D1 write, earned-spin ledger, reward wheel runtime, or issue #49 change.

The DZN Store Account Purchases read-model implementation adds a disabled-by-default private read-only route in `docs/DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_IMPLEMENTATION.md`. `GET /api/account/purchases` can show the current authenticated user's sanitized Store purchase, entitlement, and private Supporter Card status for `livemode = 0` and the active local/test sandbox ledger scope only when the dedicated read-model flag and local/test Store runtime are explicitly enabled. Store Account Purchases remain separate from Starter/Pro owner subscriptions and cannot unlock `/setup`, Nitrado, owner dashboards, server management, server ownership, owner plan status, XP, earned calling cards, rankings, discovery score, reviews, review score, badges, seasons, events, CTF scoring, Server Wars scoring, or competitive eligibility. It adds no public Supporter Card reveal, operator routes, notifications, migrations, production D1 apply, live checkout, Stripe mutation, Cloudflare config mutation, earned-spin ledger, reward wheel runtime, or issue #49 change.

The DZN Store Account Purchases UI shell adds an authenticated private read-only page in `docs/DZN_STORE_ACCOUNT_PURCHASES_UI_SHELL.md`. `/account/purchases` consumes only `GET /api/account/purchases`, uses no-store session fetches, and shows purchase and entitlement status from sanitized ledgers. It does not grant Store entitlements, owner access, billing status, setup access, Nitrado access, XP, earned calling cards, rankings, discovery, reviews, badges, seasons, events, Server Wars, CTF scoring, or competitive eligibility, and it does not enable live checkout, mutate Stripe, mutate Cloudflare config, write production D1, add wheel runtime, or change issue #49.

The DZN Store Supporter Card reveal approval preflight defines the future private reveal boundary in `docs/DZN_STORE_SUPPORTER_CARD_REVEAL_APPROVAL_PREFLIGHT.md`. It requires current-user authentication, private/no-store responses, local/test Store runtime until separate live approval, joined Store order/order item/account entitlement/Supporter Card ownership proof, and strict serial/card-art redaction. It adds no card reveal route, private reveal component, public reveal, card-art generation, sharing controls, screenshot/export controls, notifications, migrations, production D1 apply, live checkout activation, earned-spin ledger, reward wheel runtime, Stripe mutation, Cloudflare config mutation, production D1 write, or issue #49 change. It cannot alter Starter/Pro owner subscriptions, `/setup`, Nitrado linking, owner tools, server ownership, XP, earned calling cards, rankings, discovery, reviews, badges, seasons, events, Server Wars, CTF scoring, reward-wheel state, or competitive eligibility.

The DZN Store Supporter Card private reveal implementation adds a disabled-by-default private route in `docs/DZN_STORE_SUPPORTER_CARD_REVEAL_IMPLEMENTATION.md`. `GET /api/account/supporter-cards/[cardRef]/reveal` can show the current authenticated account's Supporter Card serial/status only after local/test Store flags pass and joined Store order, order item, account entitlement, and Supporter Card ownership proof succeeds. It remains separate from Starter/Pro owner subscriptions and adds no generated card art, public reveal, sharing controls, screenshot/export controls, notifications, migrations, production D1 apply, live checkout activation, earned-spin ledger, reward wheel runtime, Stripe mutation, Cloudflare config mutation, production D1 write, or issue #49 change. It cannot alter owner access, billing plan status, setup access, Nitrado access, XP, earned calling cards, rankings, discovery, reviews, badges, seasons, events, Server Wars, CTF scoring, reward-wheel state, or competitive eligibility.

Store purchases must never unlock `/setup`, Nitrado linking, owner onboarding, owner dashboards, server-management APIs, owner billing plan status, server ownership, XP, earned calling cards, rankings, discovery score, reviews, review score, badges, seasons, events, CTF scoring, Server Wars scoring, or competitive eligibility.

Players must never be able to buy wheel spins. Spins remain earned-only and must be enforced server-side with a maximum three spins in any rolling 24-hour period, a minimum four-hour cooldown, server-generated outcomes, complete reward-pool probability display, no cash-equivalent rewards, and an auditable spin ledger.

The catalog draft slice does not add checkout, payment webhook fulfilment, account entitlement writes, Supporter Card issuance, wheel runtime, Cloudflare secrets, production D1 writes, live checkout activation, or issue #49 changes.

## Protected Systems

Billing plan cleanup must not change ADM ingestion, Nitrado integration, Worker sync logic, player profiles, kills, deaths, events, sessions, token handling, or auth/session security.

Future live billing work remains high-risk. Creating or replacing live Stripe Prices, changing webhook behavior, changing checkout flows, adding trial ledgers, applying billing migrations, or migrating live subscriptions requires a deliberate human-approved billing phase.
