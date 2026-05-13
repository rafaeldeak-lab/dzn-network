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

Create and bind a D1 database named `DB`.

```bash
npx wrangler d1 create dzn-network
npx wrangler d1 migrations apply dzn-network --remote
```

In Cloudflare Pages:

1. Open the Pages project.
2. Go to Settings -> Functions -> D1 database bindings.
3. Add binding name `DB`.
4. Select the D1 database.
5. Redeploy.

The schema lives in `migrations/0001_initial.sql`.

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
