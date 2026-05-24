# DZN Network

Premium DayZ network landing page plus owner verification onboarding for Discord guild admins and Nitrado DayZ server owners.

## Deployment Model

- Frontend: Next.js App Router static export
- Backend API: Cloudflare Pages Functions in `functions/`
- Database: Cloudflare D1 bound as `DB`
- Build command: `npm run build`
- Pages output directory: `out`

`next.config.ts` must keep:

```ts
output: "export",
images: {
  unoptimized: true,
}
```

`wrangler.toml` must keep:

```toml
pages_build_output_dir = "./out"

[[d1_databases]]
binding = "DB"
database_name = "dzn_network_db"
database_id = "37515c66-2787-49e4-8568-a461517e975e"
```

## Required Environment Variables

Set these in Cloudflare Pages project settings.

- `DISCORD_CLIENT_ID`: Discord application client ID.
- `DISCORD_CLIENT_SECRET`: Discord application client secret.
- `DISCORD_REDIRECT_URI`: Full callback URL, for example `https://dzn-network.pages.dev/api/auth/discord/callback`.
- `SESSION_SECRET`: Long random secret used to HMAC session tokens.
- `TOKEN_ENCRYPTION_KEY`: Long random secret used to derive the AES-GCM key for Nitrado token encryption.
- `MOCK_AUTH`: Set to `true` only for local/dev mock login.
- `MOCK_NITRADO`: Set to `true` only for local/dev mock Nitrado services.

Do not expose `DISCORD_CLIENT_SECRET`, `SESSION_SECRET`, or `TOKEN_ENCRYPTION_KEY` in frontend code.

## Cloudflare D1

The D1 database is bound through `wrangler.toml` with binding name `DB`.

```bash
npm run db:migrate:local
npm run db:migrate:remote
```

The schema lives in `migrations/`.

## ADM Sync Worker

Automatic ADM sync runs from a separate Cloudflare Worker because Pages Functions do not run cron triggers.
GitHub Actions is not required for normal automatic ADM sync. The DZN ADM GitHub workflow is manual-only and exists as a backup/health trigger for `/api/sync/adm/run`; do not re-enable scheduled GitHub ADM sync unless intentionally using GitHub as a backup runner.

Worker config:

```toml
# wrangler.adm-sync.toml
name = "dzn-adm-sync-worker"
main = "workers/adm-sync-worker.ts"

[triggers]
crons = ["* * * * *"]
```

Before deploying the Worker, set the same Nitrado token encryption secret on the Worker:

```bash
npx wrangler secret put TOKEN_ENCRYPTION_KEY --config wrangler.adm-sync.toml
```

Optional health endpoint protection:

```bash
npx wrangler secret put SYNC_WORKER_HEALTH_TOKEN --config wrangler.adm-sync.toml
```

Useful commands:

```bash
npm run worker:adm-sync:dry-run
npm run worker:adm-sync:deploy
npm run worker:adm-sync:dev
```

When running `worker:adm-sync:dev`, test the scheduled handler at:

```bash
curl "http://localhost:8787/cdn-cgi/handler/scheduled"
```

## Discord OAuth

The Discord OAuth redirect URI in the Discord Developer Portal must exactly match `DISCORD_REDIRECT_URI`.

Scopes used:

- `identify`
- `guilds`

The app stores only guilds where the Discord user is owner or has the `ADMINISTRATOR` permission bit.

## Local Mock Mode

For local Pages Functions testing, set:

```bash
MOCK_AUTH=true
MOCK_NITRADO=true
```

Mock data:

- Guild: `Warlords Community`
- Nitrado services: `Pandora DayZ`, `Warlords PvP`, `Apocalypse DM`

Use Wrangler Pages dev when testing functions locally:

```bash
npx wrangler pages dev out --compatibility-date=2026-05-13
```

Run `npm run build` first so `out/` exists.
