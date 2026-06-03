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

## DZN AutoDev scope

DZN AutoDev is not limited solely to ADM tracking. DZN is a complete DayZ server competition platform, not solely an ADM automation project.

Allowed ADM systems:
- ADM discovery
- ADM imports
- ADM diagnostics
- ADM Worker health
- ADM Sync Health dashboard
- ADM automation
- Nitrado integrations
- ADM production monitoring

Allowed platform systems:
- Billing
- Stripe
- Subscription plans
- Plan enforcement
- Server achievements
- Badge systems
- Reputation systems
- Server profile enhancements
- Public leaderboard presentation
- Visibility ranking systems
- Server discovery systems
- Featured server systems
- Seasonal competitions
- Crown systems
- Server vs Server events
- Tournament systems
- Public statistics presentation

Allowed dashboard systems:
- Owner dashboards
- Subscription management
- Billing pages
- Plan comparison pages
- Achievement management
- Server profile management
- Analytics presentation

Still forbidden:
- Destructive migrations
- Resetting player_profiles
- Deleting kills
- Deleting deaths
- Deleting events
- Weakening authentication
- Weakening authorization
- Exposing secrets
- Copying Cloudflare secrets into GitHub
- Creating player_stats tables
- Replacing player_profiles
- Removing same-category matchmaking

Protected systems requiring extreme caution and human approval before major refactors:
- ADM ingestion pipeline
- Nitrado token handling
- Sync workers
- Cloudflare Worker infrastructure
- Authentication
- Discord OAuth
- Stripe webhook processing

All changes affecting billing, subscriptions, achievements, reputation, badges, visibility, rankings, or profiles must include tests.
