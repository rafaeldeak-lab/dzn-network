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
  Only for the manual `DZN Auto Update Worker Deploy` workflow. Scope it narrowly to deploy `dzn-auto-update-worker`, manage that Worker secret, and read Worker schedules.

- `CLOUDFLARE_ACCOUNT_ID`
  Only for the manual `DZN Auto Update Worker Deploy` workflow. This may be a repository variable instead of a secret.

Do not copy all Cloudflare runtime secrets into GitHub.

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

## Cloudflare ADM Worker secrets

The Cloudflare ADM Worker owns Worker runtime secrets.

Required:

- `TOKEN_ENCRYPTION_KEY`

Optional:

- `SYNC_WORKER_HEALTH_TOKEN`

The ADM Worker also requires the D1 DB binding.

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
- Cron: `*/5 * * * *`

GitHub Actions is backup/monitoring for these routes, not the primary five-minute scheduler.
