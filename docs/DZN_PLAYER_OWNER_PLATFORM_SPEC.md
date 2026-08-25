# DZN Player + Owner Platform Specification

This document is the durable architecture reference for the DZN Player + Owner Platform. It records the agreed product boundary before the first Player vs Owner Access Foundation PR and should be updated when future slices intentionally change that boundary.

## Product Model

DZN has two connected but separate product surfaces:

1. Public and player-facing DZN: discovery, community, leaderboards, events, tournaments, player identity, and social participation.
2. Server-owner DZN: server claiming, setup, Nitrado linking, owner dashboards, Discord posting, publishing, analytics, and paid owner tools.

The core model is:

```text
Public DZN -> free player ecosystem -> paid server-owner ecosystem -> competitive stats remain independent
```

Public visitors can learn what DZN is and start Discord login. Authenticated Discord users become free DZN players by default. Payment is only required when a user tries to own, claim, add, link, configure, publish, advertise, automate, or manage a server.

## Page Architecture

The homepage is the public sales and introduction page. It should stay focused and fast to scan:

- DZN intro and hero.
- Short explanation of what DZN does.
- Feature highlights.
- Community and Discord callout.
- A light Starter/Pro teaser.
- Clear navigation to Features, Pricing, Login, Discord, and relevant start actions.

The homepage must not carry the full billing experience:

- No full plan comparison table.
- No long payment rules.
- No Stripe/live-checkout explanation.
- No trial-abuse wording.
- No full FAQ or plan breakdown.

The dedicated `/pricing` page is the complete owner-plan and payment page:

- Starter: 2-day free trial, then £2/month.
- Pro: £10/month.
- Side-by-side feature comparison.
- Clear green ticks for included features and clear red X marks for unavailable features.
- Clear Starter and Pro owner checkout actions.
- Answers for fairness, bought badges, Starter server competition, and what Pro improves.
- Clear copy that payment improves owner tools, presentation, publishing, promotion, analytics, and automation, not competitive results.
- A visibly stronger Pro column/list than Starter, with more owner features and a bolder custom DZN presentation that makes the upgrade path obvious without claiming a competitive advantage.
- A future visual pass should use DZN-themed background art with subtle slow pan/zoom motion so the pricing page feels alive, while respecting reduced-motion users.

## Identity And Roles

DZN uses Discord identity as the primary login identity.

| Role | How the user gets it | Payment required | Main access |
| --- | --- | --- | --- |
| Visitor | No session | No | Homepage, pricing, public read-only APIs, public Discord link |
| Player | Discord login | No | Server listings, events, tournaments, leaderboards, player/community surfaces |
| Server owner / manager | Discord login plus active or trialing owner entitlement | Yes for owner tools | Setup, Nitrado linking, server-management APIs, dashboard owner tools |
| Platform owner / admin | Internal authorization | Not plan based | `/owner` and platform administration |

Authenticated users are players first. Owner status is an additional capability unlocked by the canonical billing entitlement layer.

## Player Flow

Normal Discord users must be able to use player-facing DZN without payment:

```text
Login with Discord -> Player Hub / Servers / Events / Tournaments / Leaderboards / Communities
```

Player access includes:

- Player Hub home at `/player`.
- Server listing and discovery pages.
- Events and tournament browsing.
- Leaderboards and public competitive views.
- Player profile and Player Hub roadmap surfaces.
- Community matching from Discord guild membership when available.
- Reviews, challenge participation, calling cards, check-ins, waitlists, and notification flows as future slices add them.

Player access must not require choosing Starter or Pro.

## Owner Flow

Owner/server-management actions cross the billing boundary:

```text
Login with Discord -> owner action -> /pricing -> Stripe Checkout -> confirmed entitlement -> /setup
```

Owner actions include:

- Add, claim, configure, or publish a server.
- Link Nitrado services or validate Nitrado tokens.
- Save onboarding/setup state.
- Open setup and owner dashboards.
- Register or match an owned server for events/tournaments.
- Mutate server settings, public listing configuration, gallery, Discord posting destinations, owner events, Server Wars hosting, seasons, CTF tools, cache refreshes, and other server-management APIs.
- Run manual sync or owner-triggered ingestion operations.

The canonical server-side billing entitlement layer must enforce this boundary. Hiding UI is only guidance; direct URLs and APIs must fail closed without an active or trialing owner entitlement.

## Billing Contract

Only the current owner plans are purchasable:

| Plan | Public label | Price | Trial | Owner capability |
| --- | --- | ---: | --- | --- |
| Starter | Starter - 2-day free trial | £0 today, then £2/month | 2 days | Entry owner setup and one linked server |
| Pro | Pro - Full DZN Access | £10/month | None | Expanded owner tooling and higher owner limits |

Rules:

- Starter must be described as a 2-day free trial that becomes £2/month.
- Pro must be described as £10/month.
- A plan grants owner access only when the canonical entitlement status is active or trialing.
- Existing stored Premium, Network, and Partner values are legacy compatibility inputs and continue to normalize to effective Pro capabilities when active or trialing.
- Legacy plans must not be offered as new checkout options.
- `DZN_LIVE_CHECKOUT_ENABLED` remains false until a later approved go-live step.
- Live Stripe products, prices, webhook endpoints, secrets, Cloudflare variables, production D1 rows, Nitrado resources, and Discord resources must not be mutated by this foundation slice.
- Issue #49 is reserved for the final live checkout activation and must remain separate from foundation work.

## Competitive Fairness Boundary

Monetisation must never affect competitive results.

Starter, Pro, and legacy-mapped owner entitlements may improve owner tooling, presentation, analytics, automation, publishing cadence, promotion, and management limits. They must not alter:

- Leaderboard calculations.
- Server ranking calculations.
- Player ranking calculations.
- Kills, deaths, K/D, longest kill, longest-lived, or other ADM statistics.
- Reviews and ratings.
- Event scoring.
- Tournament outcomes.
- Server Wars scoring.
- Season wins, crowns, or earned badges.
- Challenge results, XP, calling-card eligibility, or future player progression outcomes.

Badges, crowns, rank, score, and gameplay outcomes must be earned or calculated from gameplay/community rules, not purchased.

## Discord Guild And Community Matching

DZN should request the minimal Discord OAuth access needed for current behavior. The compatible foundation scope is:

```text
identify guilds
```

This supports:

- Confirming the authenticated Discord identity.
- Reading guild membership available through OAuth.
- Matching a player to DZN-connected communities when a linked server is associated with a Discord guild.
- Showing relevant community/server suggestions to logged-in players.

Manageable/admin guild filtering remains useful for owner setup. Player guild matching must not turn ordinary membership into server ownership, must not overwrite stored owner-guild rows, and must not grant management rights.

## Roadmap

Future slices should build on this foundation in this order unless product priorities change:

1. Player Hub: player home, followed communities, suggested servers/events, saved servers, profile entry points.
2. Saved/followed server interaction: `POST`/`DELETE /api/player/saved-servers`, save/follow buttons on public cards and profiles, and tests proving saved state is a private player preference only.
3. Pricing page visual/comparison upgrade: dedicated pricing page with red X and green tick comparison, stronger Pro feature depth, bolder DZN styling, and subtle animated background treatment that respects reduced motion.
4. Reviews: player reviews, owner replies, reporting/moderation, review fairness controls.
5. Challenges, XP, calling cards: earned progression, challenge participation, cosmetics, and fair unlock rules.
6. Events and tournaments: join requests, approvals, teams, schedules, brackets, reminders, and player history.
7. Check-ins, waitlists, and no-shows: event operations for communities and owners.
8. Discord approval embeds: tick/X owner controls, join request approvals, event reminders, and moderation handoffs.
9. Rich community systems: Discord community landing views, member matching, role-safe recommendations, and cross-server discovery.
10. Cosmetics and supporter monetisation: non-competitive profile presentation and optional supporter items that never affect rank, stats, scoring, or earned competitive rewards.
11. Issue #49 live checkout activation: only after sandbox evidence, readiness review, production configuration review, migration safety, and explicit approval.

## Player Hub Foundation Slice

The Player Hub foundation slice adds `/player` as the logged-in home for normal Discord users. It is a free player surface and must not require Starter, Pro, checkout, Nitrado access, server ownership, or owner billing state to render.

The foundation hub shows:

- Matched Discord communities from `/api/player/communities`.
- Followed and saved server state, also referred to as saved/followed server state, backed by the additive `player_saved_servers` table.
- Suggested public servers from safe linked-server discovery fields.
- Suggested public events and tournaments from the existing public event payload.
- Profile entry points for DZN Pulse, leaderboards, events, player-profile roadmap work, and owner setup.

The hub keeps owner setup behind the same owner boundary:

```text
Player Hub -> Add Server -> /pricing?intent=owner_setup&returnTo=%2Fsetup -> guarded checkout -> entitlement -> /setup
```

The Player Hub API is `/api/player/hub`. It requires a logged-in Discord session, but it must not call `requireOwnerRequestAccess`, return owner-plan-required errors, mutate guild ownership, create checkout sessions, write Stripe state, call Nitrado, or modify competitive/stat tables. Saved/followed server storage is additive player preference state only and must not affect discovery rank, leaderboard score, event scoring, reviews, badges, XP, challenge outcomes, or competitive eligibility.

## Saved/Followed Server Interaction Slice

The saved/followed server interaction slice turns the additive `player_saved_servers` table into a real player action. It remains a free logged-in player feature and is not an owner capability.

The slice adds:

- `GET /api/player/saved-servers` to return the current player's saved public servers.
- `POST /api/player/saved-servers` to save/follow a visible public server for the current player.
- `DELETE /api/player/saved-servers` to remove the current player's saved preference.
- Save/follow buttons on public server cards, discovery cards, and public server profiles.

The endpoint must require a normal Discord session through `getRequestSessionUser`. It must not require `requireOwnerRequestAccess`, Starter, Pro, server ownership, Nitrado access, or billing state.

Saved server state is private preference data:

- It writes only to `player_saved_servers`.
- It may read `linked_servers` to confirm the target is a visible public server.
- It must not write or recalculate rankings, discovery score, billing, server ownership, reviews, events, tournaments, Server Wars, badges, XP, challenge results, or competitive eligibility.
- Public discovery and leaderboard APIs must not consume `player_saved_servers` as a ranking input.
- Saving a server must not make the player an owner/manager of that server.

## Access Matrix

| Surface | Visitor | Free Discord player | Starter trial/active | Pro active or legacy effective Pro | Enforcement |
| --- | --- | --- | --- | --- | --- |
| `/` homepage | Allowed | Allowed | Allowed | Allowed | Public page |
| `/pricing` | Allowed | Allowed | Allowed | Allowed | Public page and checkout API |
| `/player`, `/servers`, `/events`, `/seasons`, `/leaderboards`, `/dzn-pulse` | Login required | Allowed | Allowed | Allowed | Page auth middleware |
| Player Hub and community matching APIs | Login required | Allowed | Allowed | Allowed | Session auth, no owner grant |
| `/api/player/saved-servers` | 401 | Allowed | Allowed | Allowed | Session auth, player preference only |
| `/setup` | Login required | Redirect to owner pricing | Allowed | Allowed | Page auth plus owner entitlement |
| `/dashboard` owner tools | Login required | Redirect to owner pricing | Allowed | Allowed | Page auth plus owner entitlement |
| `/api/onboarding/*` | 401 | 402 owner plan required | Allowed | Allowed | Owner entitlement middleware |
| `/api/nitrado/*` | 401 | 402 owner plan required | Allowed | Allowed | Owner entitlement middleware |
| `/api/server/*` and `/api/servers/[serverId]/*` management APIs | 401 | 402 owner plan required | Allowed, then ownership checks still apply | Allowed, then ownership checks still apply | Owner entitlement plus existing ownership checks |
| Manual sync/ingestion APIs | 401 unless cron-secret path applies | 402 owner plan required | Allowed, then existing checks still apply | Allowed, then existing checks still apply | Cron secret or owner entitlement |
| `/owner` platform admin | Platform-owner auth required | Platform-owner auth required | Platform-owner auth required | Platform-owner auth required | Existing platform-owner authorization |

## Foundation Acceptance Criteria

The Player vs Owner Access Foundation PR is complete when:

- The homepage only teases plans and links to `/pricing`.
- `/pricing` contains the full owner-plan/payment explanation and checkout actions.
- Free Discord login continues to grant player access to player-facing pages and APIs.
- `/setup`, Nitrado, onboarding, dashboard/server-management, and owner-triggered sync APIs are gated server-side by active or trialing owner entitlement.
- Owner gating uses the canonical billing entitlement logic and preserves Starter/Pro plus legacy effective-Pro normalization.
- Discord guild matching supports player community recommendations without granting owner permissions or rewriting owner guild records.
- Live checkout remains disabled unless a later approved go-live explicitly sets `DZN_LIVE_CHECKOUT_ENABLED=true`.
- Tests and static safety checks prove the page split, owner gate, player access, billing readiness, and no-live-mutation posture.
