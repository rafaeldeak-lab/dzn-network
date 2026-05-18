# DZN Automation Setup

This is the simple checklist for keeping DZN automatic server updates running in production.

## 1. Cloudflare Pages environment variables

Set these on the DZN Network Pages project:

```text
DZN_CRON_SECRET=use-one-long-random-secret
DZN_APP_URL=https://dzn-network.pages.dev
```

`DZN_CRON_SECRET` must match the Worker secret exactly. `DZN_APP_URL` should point to production, not a preview deploy.

## 2. Cloudflare Worker environment variables

Set these on the Cloudflare Worker cron project:

```text
DZN_CRON_SECRET=the-same-long-random-secret
DZN_APP_URL=https://dzn-network.pages.dev
```

The Worker runs every minute and calls the Pages sync endpoints. The backend decides which servers are actually due, so Starter/Pro/Network servers are not pulled every minute.

## 3. GitHub backup cron

Set this GitHub Actions secret:

```text
DZN_CRON_SECRET=the-same-long-random-secret
```

Optional repository variable:

```text
DZN_APP_URL=https://dzn-network.pages.dev
```

Cloudflare Worker Cron is the primary 1-minute trigger. GitHub Actions is backup only and runs every 5 minutes.

## 4. Stripe environment variables

Set these in Cloudflare Pages:

```text
STRIPE_SECRET_KEY=sk_test_or_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_or_live_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_NETWORK=price_...
STRIPE_PRICE_PARTNER=price_...
```

The older `NEXT_PUBLIC_STRIPE_*_PRICE_ID` names still work during rollout, but the server-side `STRIPE_PRICE_*` names are preferred.

## 5. Run the D1 migration after account access is fixed

Run:

```bash
npm run db:migrate:remote
```

If this fails with Cloudflare API code `7403`, the code is not the issue. The Cloudflare API token or account permissions need fixing.

Until that migration history is clean, the app can runtime-create the automation table and the dashboard will show a warning:

```text
Automation is running, but D1 migration history needs attention. Rerun npm run db:migrate:remote once Cloudflare account permissions are fixed.
```

## 6. Local verification commands

Run:

```bash
npm run lint
npm run test
npm run build
npm run test:automation-health
npm run worker:adm-sync:dry-run
```

## 7. Dashboard verification

Open Dashboard -> Automation Health.

Confirm:

- Latest source is `Cloudflare`
- Partner server status interval is 1 minute
- Partner ADM interval is 10 minutes
- No failed jobs are building up
- Stuck locks are zero
- Migration warning is gone after `npm run db:migrate:remote` succeeds

Healthy wording should say:

```text
Cloudflare Worker Cron is active. Automation is running.
```
