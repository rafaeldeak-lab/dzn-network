# Stripe Live Setup

Use this checklist before taking real DZN subscription payments.

## Test Mode vs Live Mode

Stripe test products, test Price IDs, test secret keys, and test webhook secrets do not process real payments. Production must use live-mode Stripe products, live Price IDs, a live `STRIPE_SECRET_KEY`, and the live webhook signing secret.

Never expose `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET` in public pages, client bundles, screenshots, support threads, or browser-visible configuration.

## Live Products

Create these live-mode recurring monthly products in Stripe:

- `DZN Starter` at GBP 4.99/month
- `DZN Pro` at GBP 9.99/month
- `DZN Premium` at GBP 19.99/month

Copy the live recurring Price ID for each product. Price IDs usually start with `price_`.

## Cloudflare Production Variables

Set these Cloudflare production vars for the Pages project:

- `STRIPE_PRICE_STARTER`
- `STRIPE_PRICE_PRO`
- `STRIPE_PRICE_PREMIUM`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

Keep the legacy Network/Partner price variables only if needed for existing old subscriptions or historical Stripe mapping:

- `STRIPE_PRICE_NETWORK`
- `STRIPE_PRICE_PARTNER`

Network and Partner must not be public checkout options. Legacy aliases map to Premium for old subscription compatibility only.

## Webhook

Create a live Stripe webhook endpoint for the production DZN domain and copy the live signing secret into `STRIPE_WEBHOOK_SECRET`.

The webhook secret normally starts with `whsec_`. Do not reuse a test webhook signing secret in live production.

## Legacy Products

Archive old Partner or Network products when they are no longer sold. Do not delete old Stripe products, customers, invoices, payments, or subscription history.

## Readiness Check

Admin/support/dev users can call:

```text
GET /api/billing/readiness
```

The endpoint reports only safe booleans, active plan names/prices, missing required variable names, legacy variable names, and a non-secret mode hint. It does not expose Stripe secret values or Price IDs.
