# DZN Billing Plans

## Active Public Plans

Only these plans are active and public:

| Plan | Price | Public publishing | Visibility weight |
| --- | ---: | --- | ---: |
| Starter | £4.99/month | Every 24 hours | 1 |
| Pro | £9.99/month | Every 4 hours | 2 |
| Premium | £19.99/month | Fastest/current publishing | 4 |

Premium uses plan key `premium`, price `19.99`, and derived Stripe minor units `1999`.

## Stripe Price Environment

Required active checkout variables:

```text
STRIPE_PRICE_STARTER
STRIPE_PRICE_PRO
STRIPE_PRICE_PREMIUM
```

`STRIPE_PRICE_PREMIUM` should point at the active Premium £19.99/month Price. In test mode this is currently:

```text
price_1TY4diJPrnZ0cnkHoqKk4pKc
```

Do not expose Stripe secret keys or webhook secrets in public code, logs, or docs.

## Legacy Aliases

`network` and `partner` are legacy aliases only. They must normalize to `premium` for old database rows and old Stripe subscriptions, but they must not appear in public billing UI, pricing cards, checkout buttons, plan comparison pages, or `/api/billing/plans` output.

DZN Partner is archived in Stripe.

Keep these Cloudflare variables only while old active legacy subscriptions may still emit webhook events with archived Price IDs:

```text
STRIPE_PRICE_NETWORK
STRIPE_PRICE_PARTNER
```

They are server-only compatibility variables for Stripe webhook plan mapping. They are not used for new checkout. Remove them only after confirming there are no active or trialing Stripe subscriptions on those archived Network/Partner Prices.

These old public variables are not needed and can be deleted after the cleanup deploy:

```text
NEXT_PUBLIC_STRIPE_NETWORK_PRICE_ID
NEXT_PUBLIC_STRIPE_PARTNER_PRICE_ID
```

## Protected Systems

Billing plan cleanup must not change ADM ingestion, Nitrado integration, Worker sync logic, player profiles, kills, deaths, events, sessions, token handling, or auth/session security.
