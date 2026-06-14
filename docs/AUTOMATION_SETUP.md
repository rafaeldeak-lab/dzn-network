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

Set these on the ADM sync Cloudflare Worker:

```text
TOKEN_ENCRYPTION_KEY=the-pages-token-encryption-key
DZN_CRON_SECRET=the-same-long-random-secret
```

The ADM Worker runs every minute and executes ADM sync only with its own D1 binding and subrequest budget. The backend decides which servers are actually due, so Starter, Pro, and Premium servers are not pulled every minute.

Set these on the auto-update Cloudflare Worker:

```text
DZN_CRON_SECRET=the-same-long-random-secret
DZN_APP_URL=https://dzn-network.pages.dev
```

The auto-update Worker runs every minute. It calls the protected metadata/player-count route on every tick, and calls Server Wars refresh/finalization/challenge expiry plus Discord post dispatch only on five-minute ticks. It must not run ADM imports and it does not need `TOKEN_ENCRYPTION_KEY`.

The manual deployment workflow `.github/workflows/dzn-auto-update-worker-deploy.yml` can deploy `dzn-auto-update-worker` and provision `DZN_CRON_SECRET` into that Worker from GitHub Actions without printing the secret. It requires a narrowly scoped `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

## 3. GitHub manual backup trigger

GitHub Actions is not the primary automatic ADM sync, metadata, Server Wars, or Discord runner. Normal automatic ADM sync runs through the Cloudflare ADM Worker scheduled trigger. Normal metadata, Server Wars, and Discord automation runs through the Cloudflare auto-update Worker scheduled trigger.

Set only these GitHub Actions secrets if you need to run the manual health/backup workflows:

```text
DZN_CRON_SECRET=the-same-long-random-secret
SYNC_CRON_SECRET=legacy-fallback-secret-if-needed
CLOUDFLARE_API_TOKEN=worker-deploy-token-for-the-auto-update-worker-workflow
```

Optional repository variable:

```text
DZN_APP_URL=https://dzn-network.pages.dev
CLOUDFLARE_ACCOUNT_ID=cloudflare-account-id
```

The DZN ADM GitHub workflow is manual-only. The DZN Auto Update Schedulers workflow is backup/monitoring only. Do not add Cloudflare runtime secrets such as Discord, Stripe, session, token encryption, or Nitrado tokens to GitHub unless a specific workflow explicitly requires them.

## 4. Stripe environment variables

Set these in Cloudflare Pages:

```text
STRIPE_SECRET_KEY=sk_test_or_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_or_live_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_PREMIUM=price_...
```

Active public plans are Starter, Pro, and Premium only. Premium is £19.99/month. Network and Partner are legacy aliases only and must not appear in public billing UI, pricing cards, checkout options, or plan comparison pages.

DZN Partner is archived in Stripe. Keep `STRIPE_PRICE_NETWORK` and `STRIPE_PRICE_PARTNER` only while existing legacy subscriptions can still emit Stripe webhook events using those archived Price IDs; they map to Premium for compatibility and are not used for new checkout. The old `NEXT_PUBLIC_STRIPE_NETWORK_PRICE_ID` and `NEXT_PUBLIC_STRIPE_PARTNER_PRICE_ID` variables are not needed by DZN and can be removed after this cleanup is deployed.

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
- Premium server status interval is 1 minute
- Premium ADM interval is 10 minutes
- No failed jobs are building up
- Stuck locks are zero
- Migration warning is gone after `npm run db:migrate:remote` succeeds

Healthy wording should say:

```text
Cloudflare Worker Cron is active. Automation is running.
```
