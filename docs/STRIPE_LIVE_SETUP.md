# Stripe Live Setup

Use this checklist before taking real DZN subscription payments.

## Test Mode vs Live Mode

Stripe test products, test Price IDs, test secret keys, and test webhook secrets do not process real payments. Production must use live-mode Stripe products, live Price IDs, a live `STRIPE_SECRET_KEY`, and the live webhook signing secret.

Never expose `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET` in public pages, client bundles, screenshots, support threads, or browser-visible configuration.

The repository can validate DZN's configuration shape, public plan contract, checkout/webhook code paths, and secret presence hints. It cannot create Stripe products, change Stripe billing mode, set Cloudflare secrets, apply production migrations, or decide that live billing is approved by itself. Live billing remains a high-risk human-approved operation.

## Live Products

Create these live-mode recurring monthly products in Stripe:

- `DZN Starter` at GBP 2/month, configured with a two-day trial in Checkout
- `DZN Pro` at GBP 10/month

Copy the live recurring Price ID for each product. Price IDs usually start with `price_`.

## Cloudflare Production Variables

Set these Cloudflare production vars for the Pages project:

- `STRIPE_PRICE_STARTER`
- `STRIPE_PRICE_PRO`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

For live billing readiness, Starter and Pro must use the server-side `STRIPE_PRICE_*` names above. `NEXT_PUBLIC_STRIPE_*_PRICE_ID` values are compatibility fallbacks only and must not be treated as proof that live billing is ready.

Keep the legacy Premium/Network/Partner price variables only if needed for existing old subscriptions or historical Stripe mapping:

- `STRIPE_PRICE_PREMIUM`
- `STRIPE_PRICE_NETWORK`
- `STRIPE_PRICE_PARTNER`

Premium, Network, and Partner must not be public checkout options. Legacy aliases map to effective Pro compatibility only.

## Webhook

Create a live Stripe webhook endpoint for the production DZN domain and copy the live signing secret into `STRIPE_WEBHOOK_SECRET`.

The webhook secret normally starts with `whsec_`. Do not reuse a test webhook signing secret in live production.

At minimum, verify live delivery for:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

Use Stripe test mode first with test products, test Price IDs, a test secret key, and a test webhook signing secret. Only after the test path works should the same shape be mirrored in live mode.

## Legacy Products

Archive old Partner or Network products when they are no longer sold. Do not delete old Stripe products, customers, invoices, payments, or subscription history.

## Readiness Check

Admin/support/dev users can call:

```text
GET /api/billing/readiness
```

The endpoint reports only safe booleans, active plan names/prices, missing required variable names, legacy variable names, public fallback alias names, readiness check labels, and a non-secret mode hint. It does not expose Stripe secret values or Price IDs.

For live billing, `liveConfigurationReady` is only true when all blocker checks pass:

- `STRIPE_PRICE_STARTER` exists as a server-side production variable.
- `STRIPE_PRICE_PRO` exists as a server-side production variable.
- `STRIPE_SECRET_KEY` looks like live mode.
- `STRIPE_WEBHOOK_SECRET` is configured.
- `DZN_APP_URL` or `NEXT_PUBLIC_APP_URL` points to the production DZN domain, not a preview deployment.

Even when `liveConfigurationReady` is true, the endpoint is read-only. Creating live Stripe products, changing live Price IDs, changing webhook endpoints, setting production secrets, importing customers, applying D1 migrations, or enabling live payments still requires a separate explicit high-risk human approval.

Local devs can run:

```text
npm run check:billing-config
```

That command uses the same readiness model and prints only variable names/status, never secret values or Price IDs.
