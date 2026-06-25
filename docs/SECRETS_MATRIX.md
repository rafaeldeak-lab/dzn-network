# DZN Secrets Matrix

## AutoDev scope

DZN AutoDev is ADM-only. It exists to keep ADM tracking, Nitrado log reading, file-read diagnostics, import jobs, retry/backoff, Sync Health, and ADM production verification reliable.

It does not manage billing, user accounts, Discord OAuth, subscriptions, Stripe, unrelated server settings, unrelated Events/Tournaments, or public marketing features.

## GitHub Actions secrets

GitHub Actions should only contain secrets needed by GitHub workflows.

Current allowed GitHub Actions secrets:

- `DZN_CRON_SECRET`
  Used by manual GitHub workflows to call protected DZN cron/admin endpoints.

- `SYNC_CRON_SECRET`
  Legacy/fallback cron secret for manual GitHub workflows.

- `OPENAI_API_KEY`
  Only if the ADM Codex Safe Fix workflow is explicitly enabled.

- `CLOUDFLARE_API_TOKEN`
  Only for the manual `DZN Auto Update Worker Deploy` and `DZN ADM Worker Deploy` workflows. Scope it narrowly to deploy the intended Worker, manage that Worker's `DZN_CRON_SECRET`, list Worker secret names, and read Worker schedules.

- `CLOUDFLARE_PULSE_PREVIEW_TOKEN`
  Optional least-privilege token for the manual `DZN Pulse Preview` workflow. If present, that workflow uses it instead of `CLOUDFLARE_API_TOKEN`; otherwise it falls back to `CLOUDFLARE_API_TOKEN`. Full preview requires Account -> D1 -> Edit and Account -> Cloudflare Pages -> Edit on the DZN Cloudflare account only. Add Account -> Workers Scripts -> Edit only if Cloudflare Pages preview deployment requires worker-style deployment. Do not grant Zone permissions unless a workflow step explicitly uses a Zone API.

- `CLOUDFLARE_ACCOUNT_ID`
  Only for the manual `DZN Auto Update Worker Deploy`, `DZN ADM Worker Deploy`, and `DZN Pulse Preview` workflows. This may be a repository variable instead of a secret.

Do not copy all Cloudflare runtime secrets into GitHub.

## DZN Pulse preview workflow

The manual `DZN Pulse Preview` GitHub workflow is preview-only. It may create or reuse a D1 database whose name contains `pulse_preview` or `dzn_pulse_preview`, apply migrations to that preview database, seed synthetic preview data, and deploy a dedicated preview Pages project. It refuses the production D1 name/id and refuses the production Pages project for feature-on preview.

Use `CLOUDFLARE_PULSE_PREVIEW_TOKEN` for least privilege where possible. The token must verify through Cloudflare `/user/tokens/verify` and must be able to list/create/edit D1 databases in the DZN Cloudflare account. If token verification fails, replace the token. If token verification passes but D1 list/create fails, add Account -> D1 -> Edit for the DZN Cloudflare account. If Pages deploy/configuration fails after D1 succeeds, add Account -> Cloudflare Pages -> Edit for the DZN Cloudflare account.

Do not add these to GitHub unless a workflow explicitly requires them:

- `DISCORD_BOT_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_REDIRECT_URI`
- `SESSION_SECRET`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `TOKEN_ENCRYPTION_KEY`
- Nitrado user tokens
- Nitrado service tokens
- `MOCK_AUTH`
- `MOCK_NITRADO`
- `NEXT_PUBLIC_*` values

## Cloudflare Pages secrets

Cloudflare Pages owns runtime app secrets such as:

- Discord OAuth secrets
- Stripe secrets
- `SESSION_SECRET`
- `DZN_CRON_SECRET`
- `SYNC_CRON_SECRET`
- `TOKEN_ENCRYPTION_KEY` if Pages Functions need to decrypt stored Nitrado tokens
- `NEXT_PUBLIC_*` variables required by the frontend

Feature flags owned by Cloudflare Pages environment variables:

- `DZN_PULSE_ENABLED`
  Enables the authenticated DZN Pulse bell, drawer, event popup manager, `/dzn-pulse` page data, and Pulse notification APIs. Defaults to off when unset or set to `false`.

- `DZN_DISCORD_NOTIFICATIONS_ENABLED`
  Enables optional Discord delivery for Pulse notifications only when a supported dispatcher and user preference also allow it. Defaults to off when unset or set to `false`.

These are booleans, not secrets. Do not expose Cloudflare runtime secrets through these flags, and do not add Nitrado browser/session tokens for Pulse.

## Cloudflare ADM Worker secrets

The Cloudflare ADM Worker owns Worker runtime secrets.

Required:

- `TOKEN_ENCRYPTION_KEY`
- `DZN_CRON_SECRET`

Optional:

- `SYNC_WORKER_HEALTH_TOKEN`

The ADM Worker also requires the D1 DB binding.

The manual `DZN ADM Worker Deploy` GitHub workflow deploys `dzn-adm-sync-worker` from `wrangler.adm-sync.toml`. It verifies that the existing Cloudflare Worker runtime secret name `TOKEN_ENCRYPTION_KEY` is present, but GitHub never receives `TOKEN_ENCRYPTION_KEY` and the workflow never prints its value. The workflow provisions `DZN_CRON_SECRET` safely from the existing GitHub cron secret through standard input.

## Cloudflare auto-update Worker secrets

The Cloudflare auto-update Worker owns only the cron secret needed to call protected Pages routes.

Required:

- `DZN_CRON_SECRET`

Optional fallback in code:

- `SYNC_CRON_SECRET`

Do not add `TOKEN_ENCRYPTION_KEY`, Discord tokens, Stripe secrets, session secrets, or Nitrado tokens to the auto-update Worker. It calls protected Pages routes and does not decrypt Nitrado tokens directly.

## Automatic ADM sync

Automatic ADM sync runs through the Cloudflare Worker:

- Worker name: `dzn-adm-sync-worker`
- Config: `wrangler.adm-sync.toml`
- Cron: Cloudflare Worker scheduled trigger

GitHub Actions is not the primary ADM auto-sync runner.

GitHub Actions may be used only for manual health checks or manual backup triggers.

## Automatic metadata, Server Wars, and Discord automation

Automatic metadata/player-count refresh, Server Wars score refresh/finalization/challenge expiry, and Discord post dispatch run through the Cloudflare auto-update Worker:

- Worker name: `dzn-auto-update-worker`
- Config: `wrangler.auto-update.toml`
- Cron: `* * * * *`
- Metadata/player counts run every minute; Server Wars and Discord tasks run every five minutes inside the Worker.

GitHub Actions is backup/monitoring for these routes, not the primary five-minute scheduler.
