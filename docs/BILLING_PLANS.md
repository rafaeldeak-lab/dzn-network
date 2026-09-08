# DZN Billing Plans

## Active Purchasable Plans

Only these plans may be shown as new customer-facing checkout options:

| Plan | Public label | Price | Trial | Public/advert publication | Linked servers | Promotion credits |
| --- | --- | ---: | --- | --- | ---: | ---: |
| Starter | Server-owner subscription | £2/month | 2 days for eligible accounts only | Every 72 hours after a successful publication | 1 | 0 |
| Pro | Advanced server-owner tools | £10/month | None | Every 24 hours after a successful publication | 3 | 2 per Stripe billing period |

Starter must not be described simply as free. Customer-facing copy must clearly say:

- "Eligible accounts: £0 for a 2-day trial, then £2/month."
- "Payment method required. Your trial starts when you complete checkout in Stripe. DZN verifies the subscription before unlocking owner access."
- "Cancel before trial expiry to avoid the first subscription payment."
- "Charged automatically every month until cancelled."
- "Already used your trial? After separate confirmation, £2 is due when you confirm payment in Stripe, then £2/month, with no new trial."

Player access remains free. It is not the same thing as the Starter owner subscription. Viewing pricing, signing in, requesting checkout or following a success redirect does not grant a trial or owner entitlement.

Pro customer-facing copy must clearly say:

- "Pro - Advanced server-owner tools"
- "£10/month."
- "No free trial. First payment is due when you confirm payment in Stripe; renewed monthly until cancelled."

## Starter Trial Abuse Protection

Starter is a one-time trial, not a repeatable free plan.

Before live billing is enabled, DZN must enforce one Starter trial claim per DZN Discord user and, when a Stripe customer is already known, one Starter trial claim per Stripe customer.

The durable trial claim is stored in `owner_starter_trial_claims`. A Starter checkout attempt reserves the claim before creating a Stripe Checkout Session so concurrent requests cannot create multiple trial sessions for the same DZN user. After Stripe confirms checkout or subscription state, webhook handling attaches the Stripe customer, subscription, checkout session, and current status to the same claim.

Consumed trial claims remain consumed after cancellation or payment failure. Existing active subscriptions use Manage Billing, not another checkout. Returning customers with no active subscription can explicitly confirm the separate no-trial Starter offer; it never restarts the trial. Checkout retries follow the frozen-attempt and claim lifecycle rules, not a blanket new trial reservation.

Trial enforcement is billing-sensitive. Applying the trial-claim migration, enabling live Stripe prices, changing checkout/webhook behavior, importing existing Stripe customers, or repairing production trial claims remains high-risk billing work requiring human review and explicit approval.

## Live Stripe Readiness

Live billing must not be enabled because the public pricing UI looks correct or because test-mode checkout works. The readiness gate is:

- Starter checkout uses `STRIPE_PRICE_STARTER` as a server-side Cloudflare Pages variable.
- Pro checkout uses `STRIPE_PRICE_PRO` as a server-side Cloudflare Pages variable.
- `STRIPE_SECRET_KEY` is live mode.
- `STRIPE_WEBHOOK_SECRET` belongs to the live production webhook endpoint.
- `DZN_APP_URL` or `NEXT_PUBLIC_APP_URL` points at the production DZN domain, not a preview URL.
- `DZN_PUBLIC_LEGAL_SELLER_NAME` and `DZN_PUBLIC_LEGAL_CONTACT_ADDRESS` publish the confirmed seller identity and owner-approved business correspondence address in the customer terms.
- `/api/billing/readiness` reports `liveConfigurationReady: true` without exposing secret values or Price IDs.

`NEXT_PUBLIC_STRIPE_*_PRICE_ID` variables are compatibility fallbacks only. They can keep old checkout paths working during rollout, but they are not valid evidence for live billing readiness.

`liveConfigurationReady: true` means the live configuration shape is ready for review. It does not mean real customer checkout is enabled.

Live Stripe checkout is paused by default unless `DZN_LIVE_CHECKOUT_ENABLED=true` is deliberately set during a later approved go-live step. Test-mode Stripe checkout remains available for sandbox validation without that flag. In live mode, `/api/billing/create-checkout-session` must refuse checkout before reserving a Starter trial claim, writing D1, or calling Stripe when the flag is not enabled.

The readiness check is read-only. Live Stripe product/price creation, webhook endpoint changes, Cloudflare secret changes, D1 migration application, customer import, checkout enablement, and payment enablement remain separate high-risk human-approved operations.

Use `docs/STRIPE_LIVE_ACTIVATION_CHECKLIST.md` with Issue #46 before any future live billing activation. That checklist is a non-mutating human handoff; it is not an AutoDev activation script.

## Public Subscription Contract

The active non-production-mutation contract is stored in `lib/billing/plans.ts` as `SUBSCRIPTION_PLAN_PUBLIC_CONTRACT`. It is safe public metadata for UI, docs, and tests. It does not create Stripe Prices, change live Stripe state, apply production migrations, or mutate production data.

`lib/billing/payment-copy.ts` supplies shared trial, returning-customer, cancellation and recovery disclosures. `/pricing` is the dedicated, server-rendered comparison and payment FAQ page. The homepage has a short teaser only. Both missing and false checkout-readiness fields keep its actions disabled; the backend remains authoritative on every attempt. Legacy `/#pricing` links reach the teaser, not an automatic checkout or modal.

Before launch, separately verify the legal seller, billing contact, tax treatment, purchase/refund terms, receipt configuration and hosted Stripe disclosures. Do not invent refund promises or tax-inclusive/exclusive claims. The local copy audit is not evidence that those commercial settings are complete.

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
