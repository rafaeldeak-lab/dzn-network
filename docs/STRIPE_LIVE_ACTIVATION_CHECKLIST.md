# Stripe Live Activation Checklist

Issue #46 tracks the future human-approved Stripe live billing activation for DZN. This document is the safe handoff checklist only. It does not approve live billing, create Stripe products, set Cloudflare secrets, apply D1 migrations, deploy production, or change payment state.

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
   - `DZN_PUBLIC_LEGAL_SELLER_NAME`
   - `DZN_PUBLIC_LEGAL_CONTACT_ADDRESS`
10. Confirm the seller name is the real legal seller behind the DZN Network trading name and the address is a legitimate public correspondence address that the owner has approved for publication. Do not infer or publish a home address from Stripe or any private account record.
    The configured name and ordered address lines must also match `DZN_PUBLISHED_SELLER`, the explicitly approved legal contact rendered on `/terms`. Configuration alone is not publication. General `DZN_PUBLIC_CONTACT` branding remains separate and cannot satisfy legal-seller validation. The owner approved limited sole-trader disclosure in this slice; that approval does not permit publishing a home address or personal phone, changing private verification records, or making the enable flag bypass validation.
11. Run the read-only readiness check as an authenticated admin/support/dev user.
12. Confirm `liveConfigurationReady: true`, `humanApprovalRequiredForLiveBilling: true`, and `productionMutationAllowedByReadinessCheck: false`.
13. Keep `DZN_LIVE_CHECKOUT_ENABLED` unset while performing sandbox/test readiness. In this state, live checkout should report `checkoutSessionCreationAllowed: false`.
14. Only after a separate explicit go-live approval, set `DZN_LIVE_CHECKOUT_ENABLED=true` to allow live customer checkout.
15. Run read-only production smoke after activation.

## Evidence Rules

The authenticated operator can use `/dashboard/admin/billing` or call `GET /api/billing/provider-readiness?expected_account=acct_...`
using the account shown in their Stripe dashboard. This bounded, read-only probe checks the actual
production-bound key, account capability flags, Starter/Pro Price contracts, default customer portal,
and canonical webhook destination/events. It returns boolean checks only, uses private no-store
responses, rejects mock authentication, and never creates sessions or changes billing state.
An optional `expected_webhook_fingerprint` accepts only a lowercase SHA-256 digest calculated locally
from the existing canonical Stripe endpoint secret. Never send the raw secret to this route. A
matching fingerprint verifies the saved signing-secret association without returning either value;
omitted, invalid, missing or mismatched proof cannot pass. This is not signed delivery evidence.
`providerConfigurationVerified` does not prove a completed payment: `endToEndPaymentVerified`
deliberately remains false. Keep separate delivery evidence before declaring end-to-end payment
verification complete. Never paste the account query, fingerprint or raw Stripe records
into public reports; retain the boolean result only.

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
