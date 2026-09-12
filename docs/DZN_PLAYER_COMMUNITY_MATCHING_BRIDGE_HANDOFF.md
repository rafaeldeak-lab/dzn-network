# DZN Player Community Matching Bridge Handoff

Date: 2026-08-31

Branch: `codex/player-community-matching-bridge-20260831`

Base: `origin/main` after PR #126.

## Scope

This slice adds the broader player-community matching model for ordinary logged-in Discord users:

- Adds `player_discord_community_memberships`.
- Stores the current user's own Discord guild memberships during Discord login and explicit guild refresh.
- Keeps the existing `discord_guilds` owner/admin cache for setup authority.
- Updates `GET /api/player/hub` to prefer the private membership bridge, with the existing manageable guild cache as a compatibility fallback.
- Shows ordinary member matches in Player Hub when a private current-user membership matches a public DZN server profile.

## Access Contract

`player_discord_community_memberships` is private player context:

- Rows are scoped by current DZN `user_id`.
- Rows come from Discord OAuth `guilds` data for the authenticated user.
- Active rows have `revoked_at IS NULL`.
- Guilds no longer returned by Discord are revoked instead of deleted.
- Player Hub reads active rows for the current user only.
- Player Hub surfaces matched communities only when those rows connect to public DZN server profiles; it does not expose a raw Discord guild list.
- Player Hub responses are still `private, no-store` and `Vary: Cookie`.
- The route remains `GET` only.

## Server-Side Boundaries

This bridge may write only from the existing Discord login/refresh paths:

- `player_discord_community_memberships`
- existing `users`, `sessions`, `discord_oauth_tokens`, and manageable `discord_guilds` flows

The Player Hub API may read:

- current session user
- current user's saved servers
- current user's active player community memberships
- public linked-server display fields
- public event suggestions

The bridge and Player Hub read model must not write, read from, or alter:

- billing, Stripe, Store, Supporter Cards, live checkout, or issue `#49`
- owner entitlement, setup, Nitrado, server ownership, Discord posting, or server-management state
- profile privacy settings, public handles, public profile visibility, or public attribution
- reviews, review scores, replies, reports, or moderation state
- rankings, discovery scores, leaderboard formulas, ADM stats, K/D, kills, deaths, or player profiles
- badges, seasons, crowns, XP awards, calling-card awards, or progression ledgers
- event outcomes, registrations, brackets, CTF scoring, Server Wars scoring, or competitive eligibility

## Entitlement And Fairness Matrix

| Surface | Logged-out | Free logged-in player | Starter owner | Pro owner |
| --- | --- | --- | --- | --- |
| `/player` app page | Redirects to login | Loads Player Hub | Loads Player Hub | Loads Player Hub |
| `GET /api/player/hub` | `401` | Own private hub data only | Own private hub data only | Own private hub data only |
| Ordinary-member community matches | Not available | Own active Discord memberships only | Own active Discord memberships only | Own active Discord memberships only |
| Managed guild setup authority | Not available | No setup authority from member bridge | Existing owner/admin checks only | Existing owner/admin checks only |
| Public profile visibility | No effect | No effect | No effect | No effect |
| Competitive systems | No effect | No effect | No effect | No effect |

## Validation

Completed locally in this isolated worktree on 2026-08-31:

- `npm run test:player-community-matching` passed.
- `npm run test:player-hub-real-data` passed.
- `npm run test:discord-guilds` passed.
- `npm run test:player-saved-servers` passed.
- `npm run test:public-access-gating` passed.
- `npm run test:events` passed.
- `npm run check:billing-config` passed and reported live checkout remains disabled/not configured.
- `npx tsc --noEmit --incremental false` passed.
- `npm run lint -- --ignore-pattern .wrangler/**` passed with existing warnings only.
- `npm run build` passed.
- `npm test` passed.
- `git diff --check` passed.

`npm ci` reported dependency audit warnings in the existing dependency tree; this slice does not change package versions.

Release-review update on 2026-09-01:

- The Player Hub read model now reads a wider bounded candidate set of private Discord memberships before filtering to communities with public DZN server matches.
- Visible matched communities are capped only after unmatched private Discord guilds are removed.
- `npm run test:player-community-matching` includes coverage proving a valid match still appears even when earlier private Discord guilds do not match public DZN server profiles.

## Manual QA Notes

Expected rendered behavior:

- `/player` still requires login.
- Logged-in players can see matched communities based on their own stored Discord memberships.
- Ordinary `Member` relationships can appear without owner/admin setup authority.
- Hidden/deleted/merged/slugless server profiles do not appear as matches.
- Owner setup remains routed through `/pricing?intent=owner_setup&returnTo=%2Fsetup`.
- No Store, payment, live checkout, Nitrado, owner-management, chat, report, moderation, profile visibility, or competitive mutation controls are introduced.

## Next Slice

Next recommended product slice:

- Player Hub community matching UI polish: make the matched-community panel clearer for ordinary members, admins, and owners, including stronger empty states and safe explanations that matches are private and presentation-only.
