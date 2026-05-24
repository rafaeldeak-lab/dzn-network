# DZN Secrets Matrix

## GitHub Actions secrets

GitHub Actions should only contain secrets needed by GitHub workflows.

Current allowed GitHub Actions secrets:

- `DZN_CRON_SECRET`
  Used by manual GitHub workflows to call protected DZN cron/admin endpoints.

- `SYNC_CRON_SECRET`
  Legacy/fallback cron secret for manual GitHub workflows.

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

## Automatic ADM sync

Automatic ADM sync runs through the Cloudflare Worker:

- Worker name: `dzn-adm-sync-worker`
- Config: `wrangler.adm-sync.toml`
- Cron: Cloudflare Worker scheduled trigger

GitHub Actions is not the primary ADM auto-sync runner.

GitHub Actions may be used only for manual health checks or manual backup triggers.
