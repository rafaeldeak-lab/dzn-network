<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Review guidelines

- Flag any auth/session/Discord OAuth changes as high risk.
- Flag any Stripe billing/subscription changes as high risk.
- Flag any `TOKEN_ENCRYPTION_KEY` or Nitrado token handling changes as high risk.
- Flag any destructive migration as P0.
- Flag any creation of `player_stats` as P0; DZN uses `player_profiles`.
- Flag any reset/delete of `player_profiles`, kills, events, sessions, or subscriptions as P0.
- Flag any change that weakens 401/403 endpoint protection as P0.
- Flag any workflow that copies Cloudflare runtime secrets into GitHub as P1.
- Flag any workflow that makes GitHub the primary ADM auto-sync runner as P1.
- Flag any dashboard Sync Health page that exposes manual owner controls as P1.
- Flag any removal of same-category matchmaking enforcement as P0.
- Flag any Worker change that may exceed Cloudflare subrequest limits as P1.
- Require tests for all API behavior changes.

## ADM-only AutoDev rules

DZN AutoDev is scoped only to ADM tracking automation.

Allowed:
- ADM discovery
- Nitrado ADM file read diagnostics
- unreadable retry/backoff
- ADM Worker health
- ADM import jobs
- ADM Sync Health dashboard display
- ADM production smoke
- ADM cycle watching
- ADM tests/docs

Forbidden:
- billing
- Stripe
- Discord OAuth
- sessions
- account management
- subscriptions
- unrelated Events/Tournaments
- server-owner private settings
- destructive migrations
- player_stats creation
- player_profiles reset/delete
- secrets handling unless explicitly human-reviewed

Codex must refuse out-of-scope fixes and create/report an issue instead.
