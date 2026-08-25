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
- A DZN-themed animated background treatment using subtle slow pan/zoom motion so the pricing page feels alive, while respecting reduced-motion users.

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
3. Pricing page visual/comparison upgrade: delivered as its own slice with red X and green tick comparison, stronger Pro feature depth, bolder DZN styling, and subtle animated background treatment that respects reduced motion.
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

## Reviews Foundation Slice

The Reviews foundation slice makes reviews a free logged-in player feature with owner reply and moderation hooks. It builds on the existing `server_reviews` and `server_review_reports` tables, then adds owner reply fields and a `server_review_moderation_actions` audit table.

The slice adds:

- `POST /api/player/reviews` for free logged-in player review submission and updates.
- `/api/public/server-reviews?slug=...` as the public read path for approved review summaries.
- `POST /api/public/server-reviews/[reviewId]/report` as the logged-in player report hook.
- `PUT`/`DELETE /api/servers/[serverId]/reviews/[reviewId]/reply` as the owner/admin reply hook behind existing server-management access.
- Public display of safe owner replies without exposing owner user IDs or Discord IDs.

Review submission must require a normal Discord session through the player access layer. It must not require Starter, Pro, owner entitlement, server ownership, Stripe, Nitrado, Discord bot permissions, or billing state.

Owner replies are owner tooling and must remain behind server owner/admin access. A reply can be stored and displayed with an approved review, but it must not change the review rating, review count, leaderboard score, discovery sort, badge eligibility, season result, event outcome, Server Wars score, challenge outcome, XP, or competitive eligibility.

For fairness, reviews remain separate from paid plans. Starter, Pro, and legacy effective-Pro status may improve owner tooling and presentation elsewhere, but they must not buy reviews, suppress reviews, boost review scores, alter rating averages, affect rankings, change discovery score, grant badges, change seasons, change events, or change competitive eligibility.

## Reviews Moderation Dashboard Slice

The Reviews moderation dashboard slice turns the review/report hooks into a proper owner/admin queue without changing review submission, pricing, checkout, rankings, discovery, or competitive systems.

The slice adds:

- `/dashboard/reviews` as the owner-facing moderation dashboard. This path inherits the existing `/dashboard` page owner entitlement boundary.
- `/owner/reviews` as the DZN admin entry point. API authorization still decides what data and actions are allowed.
- `GET /api/reviews/moderation` for a private no-store queue of pending, reported, approved, replied, or all reviews.
- `POST /api/reviews/moderation/[reviewId]` for approve, hold, remove, dismiss-report, save-reply, and remove-reply actions.
- Owner console navigation for Review Control.
- DZN Pulse notification hooks when a review enters moderation through reports and when DZN admin moderation updates a server owner's queue.

Authorization rules:

- Normal Discord players cannot access the moderation queue.
- Normal server owners must pass the canonical owner entitlement layer before using `/dashboard/reviews` or `/api/reviews/moderation`.
- A paid/trialing owner can only moderate reviews for linked servers where `linked_servers.user_id` matches the session user.
- Configured DZN admins can use `/owner/reviews` and the same moderation API across servers.
- The action endpoint re-checks ownership/admin authority against the target review's linked server before every mutation.

Mutation scope:

- The queue may read `server_reviews`, `server_review_reports`, and `linked_servers`.
- Moderation actions may update `server_reviews` and append `server_review_moderation_actions`.
- Notification hooks may insert DZN Pulse rows into `user_notifications` only when DZN Pulse is enabled.
- No Discord notification dispatch, bot send, Nitrado call, Stripe call, checkout session creation, Cloudflare secret update, or production D1 migration application is part of this slice.

Fairness remains unchanged: reviews remain separate from paid plans, rankings, discovery score, badges, seasons, events, Server Wars, challenges, XP, calling cards, and competitive eligibility. Moderation state may hide, hold, or approve public review visibility, but it must not change rating formulas into competitive or discovery inputs.

## Reviews Notification And Workflow Polish Slice

This follow-on slice improves the owner/admin moderation workflow without changing the Reviews foundation contract, billing, checkout, discovery, or competitive systems.

The slice adds:

- Queue-wide counts from the protected moderation API so `/dashboard/reviews`, `/dashboard`, and `/owner` can show review badges without using public data.
- DZN Pulse unread/review-notification counts in the owner review workflow. These are read-only badge values; queue reads do not create notifications.
- Clear per-review `status_history` based on `server_review_moderation_actions`, returned without actor user IDs or actor Discord IDs.
- `POST /api/reviews/moderation/bulk` for DZN admin-only bulk triage of repeated report patterns.
- Admin-only repeated report pattern summaries on the review moderation dashboard.
- Owner dashboard and owner command-centre badges that degrade to unavailable states without bypassing the server-side API gates.

Authorization rules:

- Normal Discord players still cannot access review moderation APIs.
- Normal server owners must pass the canonical owner entitlement layer before reading counts, badges, history, or queue data.
- Normal owners can only see or act on reviews for linked servers where `linked_servers.user_id` matches the session user.
- Configured DZN admins can see repeated report patterns and use bulk triage across servers.
- Bulk triage is denied for non-admin owners even if they have an active Starter/Pro owner entitlement.
- Bulk triage only accepts repeated report patterns, not arbitrary review searches.

Mutation scope:

- Queue/count/history reads may read `server_reviews`, `server_review_reports`, `server_review_moderation_actions`, `linked_servers`, and `user_notifications`.
- Single-review moderation actions may update `server_reviews` and append `server_review_moderation_actions`.
- Admin bulk triage may update matching `server_reviews`, append `server_review_moderation_actions`, and create internal DZN Pulse rows in `user_notifications` when DZN Pulse is enabled.
- No Stripe product/price mutation, checkout activation, Cloudflare secret update, production D1 migration application, Nitrado call, Discord bot send, or issue #49 merge is part of this slice.

Fairness remains unchanged: notification badges, status history, repeated report pattern summaries, owner replies, and admin bulk triage must not affect paid plans, rankings, discovery score, review averages, badges, seasons, events, Server Wars, challenges, XP, calling cards, or competitive eligibility.

## Review Notification Read State And Delivery Audit Slice

The review notification read-state slice makes review-related DZN Pulse alerts easier to distinguish and clear without changing the general Pulse inbox, review moderation outcomes, billing, checkout, discovery, ranking, or competitive systems.

The slice adds:

- Dedicated DZN Pulse review notification types for review moderation alerts, review queue updates, and repeated report triage.
- A DZN Pulse `Reviews` filter/category so review alerts are visibly separate from news, events, scores, and achievement alerts.
- `POST /api/reviews/moderation/notifications/read` for explicitly marking unread review alerts read from the owner dashboard or review moderation queue.
- Owner dashboard and `/dashboard/reviews` controls labelled around review alerts rather than general alerts.
- Focused tests proving review-alert read state remains private per owner/admin and does not affect paid plans, rankings, discovery score, review score, badges, seasons, events, Server Wars, challenges, XP, calling cards, or competitive eligibility.

Authorization rules:

- Normal Discord players cannot clear review moderation alerts.
- Normal server owners must pass the canonical owner entitlement layer before clearing review alerts.
- Configured DZN admins can clear their own review moderation alerts without requiring an owner plan.
- The endpoint only updates `user_notifications` rows for the authenticated owner/admin user. It must not clear another owner/admin user's alert rows.
- The endpoint must use private no-store responses and must not expose notification read state publicly.

Mutation scope:

- The read action may update `user_notifications.read_at` for unread, unexpired review-alert rows owned by the authenticated user.
- The read action may count the same user's unread general Pulse rows and unread review Pulse rows after the update.
- General DZN Pulse alerts remain unread unless the user uses the separate general Pulse read controls.
- No `server_reviews`, `server_review_reports`, moderation-action rows, billing rows, ownership rows, ranking rows, discovery rows, badge rows, season rows, event rows, Server Wars rows, Nitrado resources, Discord resources, Cloudflare secrets, Stripe resources, production D1 rows, checkout activation, or issue #49 merge is part of this slice. issue #49 remains reserved for final live checkout activation.

Delivery audit:

- Review moderation notifications are internal DZN Pulse records unless a later explicit Discord delivery slice enables and audits delivery.
- This slice must not call Discord bot send helpers, mutate Discord channels, mutate Nitrado, create checkout sessions, or enable live checkout.
- Review notification delivery and read state must stay operational metadata only; they must not feed review score, discovery score, rank, competitive eligibility, or paid-plan status.

## Challenges / XP / Calling Cards Foundation Slice

The Challenges / XP / Calling Cards foundation slice turns player progression into a real free logged-in player surface without connecting it to owner monetisation or competitive systems.

The slice adds:

- `/api/player/challenges` as the free logged-in player challenge payload and participation endpoint.
- Additive `player_challenges`, `player_challenge_participations`, `player_xp_ledger`, `player_calling_cards`, and `player_calling_card_awards` tables.
- Foundation challenge catalog rows for survival, community, and combat player tracks.
- Join buttons and private joined-state display on `/events/challenges`.
- Player Hub progress entry points showing earned XP, joined/completed challenge counts, recent challenge state, and earned calling cards.

Authorization rules:

- Normal Discord login is enough to read the player challenge payload and join a player challenge.
- The endpoint must use the player session layer through `getRequestSessionUser`.
- It must not require Starter, Pro, owner entitlement, server ownership, Nitrado access, Stripe, Discord bot permissions, or billing state.
- Owner setup remains separate: owner actions still flow through `/pricing?intent=owner_setup&returnTo=%2Fsetup` and the canonical owner entitlement gate.

Mutation scope:

- `GET /api/player/challenges` is read-only.
- `POST /api/player/challenges` may create only the authenticated player's row in `player_challenge_participations`.
- The self-join action must not self-award XP or calling cards; XP ledger rows and calling-card awards are hooks for later verified progression/rule engines.
- No checkout session, Stripe mutation, Cloudflare secret update, production D1 migration application, Nitrado call, Discord bot send, issue #49 merge, or live payment activation is part of this slice.

Fairness remains unchanged: player challenge participation, XP, and calling cards remain earned/player-side progression. They must not affect paid plans, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars scoring, server ownership, or competitive eligibility.

## Authoritative Progression Awards Slice

The authoritative progression awards slice connects XP and calling-card awards to trusted server-side evidence only. It keeps player progression free to join/read while ensuring rewards cannot be self-awarded by browser/client requests.

The slice adds:

- `/api/cron/player-progression/awards` as a protected server-side award job endpoint.
- `player_progression_award_sources` as the verified source queue/audit table for progression facts.
- `runPlayerProgressionAwardJob` as the canonical helper for accepting verified source facts, processing pending facts, and writing earned XP/calling-card awards.
- Idempotency based on `UNIQUE(user_id, source_type, source_id)` for verified award facts and `challenge_completion` ledger/card source keys for one completion award per player challenge.
- Player Hub and `/events/challenges` copy that explains XP and calling cards unlock from verified DZN activity only.

Authorization rules:

- Normal players can still read challenge/progression state and join challenges through `/api/player/challenges`.
- Normal players must not be able to mark challenges complete, write XP, write calling-card awards, or submit trusted award evidence.
- `/api/cron/player-progression/awards` must require the shared cron secret and must not accept session auth, owner entitlement, Starter, Pro, Nitrado, Stripe, or Discord bot permissions as substitutes.
- Source facts accepted through the protected job must include `verified: true`, an allowed source type, a stable source id, a player id, and an active player challenge id or slug.

Mutation scope:

- The protected award job may write `player_progression_award_sources`, update the authenticated target player's existing `player_challenge_participations` row, and insert idempotent rows into `player_xp_ledger` and `player_calling_card_awards`.
- The protected award job must not create checkout sessions, update owner billing, change server ownership, update rankings/leaderboards, modify discovery score, mutate reviews, award server badges, change seasons, modify events, alter Server Wars scoring/results, touch Nitrado, send Discord bot messages, change Cloudflare secrets, apply production migrations, merge issue #49, or enable live checkout.

Fairness remains unchanged: XP and calling cards are earned player-side profile progression only. They must not affect paid plans, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars scoring, server ownership, or competitive eligibility.

## Pricing Visual Comparison Upgrade Slice

The pricing visual/comparison upgrade is a dedicated `/pricing` page slice. It does not change billing plans, entitlement normalization, checkout safety, owner gating, production configuration, or issue #49.

The slice adds:

- Clear green ticks and red X marks for the Starter vs Pro comparison table.
- A visibly richer Pro plan list than Starter, focused on owner tooling, presentation, publishing cadence, promotion, analytics, Discord destinations, visual treatment, and upgrade paths.
- DZN-specific card artwork and a DZN-themed animated background using slow pan/zoom motion with reduced-motion fallback.
- Fairness rows that make paid leaderboard, review-score, and season/crown boosts explicitly unavailable on both plans.

Live checkout remains disabled by default. The page may explain that a later approved go-live can enable `DZN_LIVE_CHECKOUT_ENABLED=true`, but this slice must not assign that value, mutate Stripe, update Cloudflare secrets, write production D1, call Nitrado, change Discord resources, or merge the live-payment activation path. Issue #49 remains reserved for final live checkout activation.

## Access Matrix

| Surface | Visitor | Free Discord player | Starter trial/active | Pro active or legacy effective Pro | Enforcement |
| --- | --- | --- | --- | --- | --- |
| `/` homepage | Allowed | Allowed | Allowed | Allowed | Public page |
| `/pricing` | Allowed | Allowed | Allowed | Allowed | Public page and checkout API |
| `/player`, `/servers`, `/events`, `/seasons`, `/leaderboards`, `/dzn-pulse` | Login required | Allowed | Allowed | Allowed | Page auth middleware |
| Player Hub and community matching APIs | Login required | Allowed | Allowed | Allowed | Session auth, no owner grant |
| `/api/player/saved-servers` | 401 | Allowed | Allowed | Allowed | Session auth, player preference only |
| `/api/player/reviews` | 401 | Allowed | Allowed | Allowed | Session auth, review mutation only |
| `/api/player/challenges` | 401 | Allowed | Allowed | Allowed | Session auth, player participation only |
| `/api/cron/player-progression/awards` | 401 | 401 | 401 | 401 | Cron secret only, verified award facts |
| `/api/public/server-reviews` | Preview/locked summary | Allowed | Allowed | Allowed | Public/read with session-aware redaction |
| `/api/public/server-reviews/[reviewId]/report` | 401 | Allowed | Allowed | Allowed | Session auth, report/moderation hook only |
| `/api/servers/[serverId]/reviews/[reviewId]/reply` | Login/pricing boundary | Owner plan required | Allowed, then ownership checks still apply | Allowed, then ownership checks still apply | Owner entitlement plus server owner/admin checks |
| `/dashboard/reviews` and `/api/reviews/moderation` | Login/pricing boundary | Owner plan required | Allowed for own linked servers only | Allowed for own linked servers only | Owner entitlement plus per-review server ownership/admin checks |
| `/api/reviews/moderation/bulk` | Login/pricing boundary | Denied | Denied unless configured DZN admin | Denied unless configured DZN admin | DZN admin-only repeated report pattern triage |
| `/api/reviews/moderation/notifications/read` | 401 | Owner plan required | Marks own review-alert notifications read | Marks own review-alert notifications read | Owner entitlement or DZN admin; user-scoped `user_notifications.read_at` only |
| `/owner/reviews` | Data denied by API | Own reviews only if entitled, or global if DZN admin | Own reviews only, or global if DZN admin | Own reviews only, or global if DZN admin | Same moderation API; per-review ownership/admin checks |
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
