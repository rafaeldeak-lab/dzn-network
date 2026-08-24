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

The readiness check is read-only. Live Stripe product/price creation, webhook endpoint changes, Cloudflare secret changes, D1 migration application, customer import, and payment enablement remain separate high-risk human-approved operations.

Use `docs/STRIPE_LIVE_ACTIVATION_CHECKLIST.md` with Issue #46 before any future live billing activation. That checklist is a non-mutating human handoff; it is not an AutoDev activation script.

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

## Protected Systems

Billing plan cleanup must not change ADM ingestion, Nitrado integration, Worker sync logic, player profiles, kills, deaths, events, sessions, token handling, or auth/session security.

Future live billing work remains high-risk. Creating or replacing live Stripe Prices, changing webhook behavior, changing checkout flows, adding trial ledgers, applying billing migrations, or migrating live subscriptions requires a deliberate human-approved billing phase.
