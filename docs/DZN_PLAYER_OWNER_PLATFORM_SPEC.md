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
6. Player profile progression showcase: make earned XP, challenge progress, and calling cards visible from `/player/profile` and the Player Hub with privacy-aware display controls.
7. Persistent player profile privacy preferences: save player-owned public profile visibility and per-section display settings through a private player settings API.
8. Public profile publishing/viewer: publish opted-in public player profiles through a public-safe route/API that respects saved visibility preferences and hides private identifiers, source details, raw evidence, and exact award timestamps.
9. Public profile attribution expansion and controls polish: private "where my public profile appears" controls, plus opt-in attribution only on newly exposed public/player-safe rows with trusted user bridges.
10. CTF/event roster attribution proof: add display-only public profile links on read-only roster/member rows only where a unique trusted server/player account bridge exists.
11. Events and tournaments: join requests, approvals, teams, schedules, brackets, reminders, and player history.
12. Check-ins, waitlists, and no-shows: event operations for communities and owners.
13. Discord approval embeds: tick/X owner controls, join request approvals, event reminders, and moderation handoffs.
14. Rich community systems: Discord community landing views, member matching, role-safe recommendations, and cross-server discovery.
15. Cosmetics and supporter monetisation: non-competitive profile presentation and optional supporter items that never affect rank, stats, scoring, or earned competitive rewards.
16. Issue #49 live checkout activation: only after sandbox evidence, readiness review, production configuration review, migration safety, and explicit approval.

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

## Verified Activity Source Adapters And Award Audit Slice

The verified activity-source adapters slice connects specific trusted DZN activity producers into the authoritative progression award queue without creating any player/browser self-award path.

The slice adds:

- Adapter collection for ADM-derived player activity through `player_events`.
- Adapter collection for ADM-derived combat activity through `kill_events`.
- Adapter collection for owned-server event participation through `server_event_entries`.
- Adapter collection for approved community activity through approved `server_reviews`.
- Provenance metadata on `player_progression_award_sources`: linked server, source table, adapter key, processing attempts, retry count, last attempt timestamp, and last retry timestamp.
- `/api/owner/progression/award-audit` as an owner/admin-readable, read-only audit route for awarded, skipped, failed, pending, progressed, and duplicate source facts.
- Failed-row retry scheduling through the existing cron-secret-protected `/api/cron/player-progression/awards` job with `retry_failed: true`.

Authorization rules:

- Adapter collection and failed-row retry can run only from the cron-secret-protected award job.
- Normal players can still read/join challenges but cannot collect source facts, mark facts verified, retry failed rows, or award themselves XP/calling cards.
- Owners can read audit history only after the canonical owner entitlement gate passes, and only for source facts tied to their own linked servers.
- Configured DZN admins can read global source audit history.
- The audit route must not accept write methods and must return private no-store responses.

Mutation scope:

- Adapter collection may read `player_events`, `kill_events`, `server_event_entries`, `competitive_events`, `server_reviews`, `player_profiles`, `users`, and `linked_servers` only as trusted activity context.
- Adapter collection and retry may write only `player_progression_award_sources`.
- Award processing may continue to update only `player_challenge_participations` and insert idempotent rows into `player_xp_ledger` and `player_calling_card_awards`.
- The audit route is read-only and must not expose raw evidence blobs, Discord IDs, billing state, Nitrado tokens, Discord bot tokens, Stripe secrets, or checkout configuration.
- No adapter, retry, or audit path may create checkout sessions, update owner billing, change server ownership, update rankings/leaderboards, modify discovery score, mutate reviews, award server badges, change seasons, modify events, alter Server Wars scoring/results, touch Nitrado, send Discord bot messages, change Cloudflare secrets, apply production migrations, merge issue #49, or enable live checkout.

Fairness remains unchanged: verified activity adapters and their audit history are player-side progression plumbing only. They must not affect paid plans, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars scoring, server ownership, or competitive eligibility.

## Progression Award Audit UI Slice

The progression award audit UI slice surfaces owner/admin award-source history in dashboard views without creating a browser-side award or retry path.

The slice adds:

- A `Progression Audit` tab in the server owner dashboard.
- Dedicated `/dashboard/progression-awards` and `/owner/progression-awards` audit pages.
- Status, adapter, linked-server, and retry-state filters for `GET /api/owner/progression/award-audit`.
- Dashboard copy must explicitly describe status, adapter, linked-server, and retry-state filters.
- Owner/admin display of verified source rows, challenge names, player display names, linked servers, adapter keys, source tables, result status, attempt counts, retry counts, and timestamps.
- Clear dashboard copy that retry execution remains cron-secret-only.

Authorization rules:

- Normal players remain free to read/join challenges through `/api/player/challenges` but cannot read owner audit history without owner entitlement or configured DZN admin access.
- Normal owners must pass the canonical owner entitlement layer before reading audit history.
- Normal owners can only read source rows tied to their own linked servers, even when using linked-server filters.
- Configured DZN admins can read global audit history.
- The browser UI must not call the cron award job, submit `retry_failed`, create source facts, or grant XP/calling cards.

Mutation scope:

- The UI and `GET /api/owner/progression/award-audit` route are read-only.
- The audit route may read verified `player_progression_award_sources`, `users`, `player_challenges`, and `linked_servers` rows for display.
- Retry execution remains limited to the cron-secret-protected `/api/cron/player-progression/awards` job.
- No dashboard audit path may create checkout sessions, update owner billing, change server ownership, update rankings/leaderboards, modify discovery score, mutate reviews, award server badges, change seasons, modify events, alter Server Wars scoring/results, touch Nitrado, send Discord bot messages, change Cloudflare secrets, apply production migrations, merge issue #49, or enable live checkout.

Fairness remains unchanged: audit visibility, source status, retry metadata, XP, and calling cards remain player-side progression and operational metadata only. They must not affect paid plans, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars scoring, server ownership, or competitive eligibility.

## Player Profile Progression Showcase Slice

The player profile progression showcase slice makes earned progression easier to see without creating a public publishing system yet. It adds `/player/profile` as a free logged-in player profile page and `/api/player/profile` as the private no-store profile progression payload.

The slice adds:

- A dedicated `/player/profile` page for earned XP, challenge progress, calling cards, and a short progression timeline.
- A prominent Player Profile Progression Showcase panel on `/player`.
- Privacy display controls for private view, public-safe preview, and hidden preview.
- Local preview toggles for showing XP, challenge progress, and calling cards.
- A profile payload derived from the existing player challenge/progression read model rather than a new award path.

Authorization rules:

- Normal Discord login is enough to open `/player/profile` and read `/api/player/profile`.
- The API must use `getRequestSessionUser`, private no-store responses, and `GET` only.
- It must not require Starter, Pro, owner entitlement, server ownership, Nitrado access, Stripe, Discord bot permissions, or billing state.
- Owner setup remains separate: `/player/profile` may link to `/pricing?intent=owner_setup&returnTo=%2Fsetup`, but the profile page is not an owner setup gate.

Privacy rules:

- Public profile publishing is off in this slice.
- Privacy controls are preview-only and persist as local UI state until a later profile settings slice adds saved preferences.
- The private payload may include display name, avatar URL, XP totals, challenge progress, calling-card summaries, and coarse profile timeline rows for the authenticated viewer.
- It must not expose Discord IDs, internal user IDs, source IDs, raw evidence blobs, ADM source rows, billing state, owner account state, Nitrado tokens, Discord bot tokens, Stripe state, or exact award timestamps in public-safe preview mode.

Mutation scope:

- `GET /api/player/profile` is read-only.
- The helper may read the existing player progression summary through `getPlayerChallengesPayload`.
- The slice must not add browser actions that award XP, award calling cards, mark source facts verified, retry source rows, create checkout sessions, update owner billing, change server ownership, update rankings/leaderboards, modify discovery score, mutate reviews, award server badges, change seasons, modify events, alter Server Wars scoring/results, touch Nitrado, send Discord bot messages, change Cloudflare secrets, apply production migrations, merge issue #49, or enable live checkout.

Fairness remains unchanged: profile progression showcase visibility, privacy preview mode, XP, challenge progress, timeline rows, and calling cards remain earned player-side display only. They must not affect paid plans, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars scoring, server ownership, or competitive eligibility.

## Persistent Player Profile Privacy Preferences Slice

The persistent player profile privacy preferences slice saves profile display choices without turning profile visibility into a ranking, billing, owner, moderation, award, or competitive input. It builds on the profile progression showcase and introduces a private player-owned settings model for public profile visibility and per-section display preferences.

The slice adds:

- The additive `player_profile_privacy_preferences` table keyed by the authenticated user's internal user ID.
- `GET /api/player/profile-privacy` to read the current player's saved settings or safe defaults.
- `PATCH /api/player/profile-privacy` to save the current player's public profile visibility, XP display, challenge progress display, calling-card display, and award-date display choices.
- Saved preference hydration in `/api/player/profile` and the `/player/profile` UI.
- A save action on `/player/profile` for the player to persist the same display choices used by the existing preview controls.

Authorization rules:

- Normal Discord login is enough to read or save profile privacy preferences.
- The API must use `getRequestSessionUser`, private no-store responses, bounded JSON parsing, and session-owned `user.id` binding.
- The API must reject logged-out visitors with `401` and reject methods other than `GET` and `PATCH`.
- The API must not accept `user_id`, `discord_id`, owner ID, server ID, plan, or billing fields from the request body as an authority source.
- The API must not require Starter, Pro, owner entitlement, server ownership, Nitrado access, Stripe, Discord bot permissions, or billing state.

Privacy rules:

- No public profile reader route is introduced in this slice.
- The settings API is private to the authenticated player and returns only safe preference metadata.
- Saved settings can decide whether the profile is intended for public display later, and which sections are displayable, but this slice does not publish a public profile.
- Discord identity display and source-detail display remain forced off until a later explicit public-profile slice defines a safe reader contract.
- Responses must not expose Discord IDs, internal user IDs, source IDs, raw evidence blobs, ADM source rows, billing state, owner account state, Nitrado tokens, Discord bot tokens, Stripe state, or exact award timestamps in public-safe preview mode.

Mutation scope:

- `GET /api/player/profile-privacy` is read-only.
- `PATCH /api/player/profile-privacy` may write only the current user's row in `player_profile_privacy_preferences`.
- The profile payload helper may read the privacy preference row while building the authenticated player's `/api/player/profile` payload.
- The slice must not add browser or API actions that award XP, award calling cards, alter challenge progress, mark source facts verified, retry source rows, create checkout sessions, update owner billing, change server ownership, update rankings/leaderboards, modify discovery score, mutate reviews, award server badges, change seasons, modify events, alter Server Wars scoring/results, touch Nitrado, send Discord bot messages, change Cloudflare secrets, apply production migrations, merge issue #49, or enable live checkout.

Fairness remains unchanged: profile display settings, public profile visibility, section visibility, and award-date visibility are presentation choices only. They must not affect billing, rankings, discovery, reviews, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility.

## Public Player Profile Publishing and Viewer Slice

The public player profile publishing/viewer slice turns opted-in profile visibility into a safe read-only public surface. It builds directly on the saved `player_profile_privacy_preferences` model and does not create any public write path, award path, owner path, or paid-plan benefit.

The slice adds:

- `public_handle` on `player_profile_privacy_preferences` as a generated, non-sensitive public profile handle.
- `/players/[handle]` as the public profile viewer page.
- `GET /players/[handle]` as a Cloudflare Pages shell route for arbitrary generated handles in the static-export app; the browser derives the actual path handle before reading the public API.
- `GET /api/public/player-profiles/[handle]` as the public-safe profile payload.
- Private `/player/profile` link display for players who have enabled publishing and saved a generated public handle.
- Public-safe profile sections for opted-in XP, joined/completed challenge progress, calling cards, and month-level award labels.

Authorization rules:

- Public profile viewing does not require login when the player has enabled public profile visibility.
- Private player settings still require normal Discord session auth through `/api/player/profile-privacy`.
- Publishing remains player-owned: public handles are generated from a display-name slug plus random suffix when the authenticated player enables public visibility, and request-body `public_handle`, `user_id`, or `discord_id` values are not authority.
- A hidden, missing, unpublished, invalid, or unconfigured profile returns an error without exposing whether an internal user or Discord account exists.
- The public viewer must not require Starter, Pro, owner entitlement, server ownership, Nitrado access, Stripe, Discord bot permissions, or billing state.

Privacy rules:

- Public responses may expose only a public handle, public display name, non-identifying avatar initial, public route/API hrefs, opted-in sections, coarse month/year award labels, and fairness metadata.
- Public responses must not expose Discord IDs, internal user IDs, Discord avatar hashes or derived avatar URLs, source IDs, source tables, raw evidence blobs, ADM source rows, billing rows, owner account state, Nitrado tokens, Discord bot tokens, Stripe state, or exact award timestamps.
- `show_xp = false` must remove public XP totals, profile level, XP-to-next-level, and XP text from public timeline details.
- `show_challenge_progress = false` must remove public challenge progress and challenge timeline items.
- `show_calling_cards = false` must remove public calling cards and calling-card timeline items.
- `show_award_dates = true` may show only coarse month/year labels; exact stored timestamps remain hidden.

Mutation scope:

- `GET /api/public/player-profiles/[handle]` is read-only.
- The public route may read `player_profile_privacy_preferences`, `users`, `player_challenges`, `player_challenge_participations`, `player_xp_ledger`, `player_calling_card_awards`, and `player_calling_cards`.
- The private settings save path may write only the current player's `player_profile_privacy_preferences` row and may check generated handle collisions in the same table.
- The slice must not add browser or API actions that award XP, award calling cards, alter challenge progress, mark source facts verified, retry source rows, create checkout sessions, update owner billing, change server ownership, update rankings/leaderboards, modify discovery score, mutate reviews, award server badges, change seasons, modify events, alter Server Wars scoring/results, touch Nitrado, send Discord bot messages, change Cloudflare secrets, apply production migrations, merge issue #49, or enable live checkout.

Fairness remains unchanged: Public profile display choices must not affect billing, rankings, discovery, reviews, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility.

## Public Profile Discovery and Linking Polish Slice

The public profile discovery/linking polish slice makes the existing published profile easier for players to find and share without turning public profiles into a ranking, billing, ownership, award, moderation, or competitive input.

The slice adds:

- Public profile entry links from `/player`, `/player/profile`, `/events/challenges`, and DZN Pulse.
- A `public_profile` summary on `GET /api/player/hub` sourced from the authenticated player's saved profile privacy preferences.
- Copy/share controls for the profile owner on private player surfaces when a generated public profile link exists.
- Clear private-player settings links when a public profile has not been published yet.
- Richer public viewer empty states for sections that are hidden by privacy settings or not yet earned.

Authorization rules:

- Normal Discord login remains enough to open the Player Hub, private profile, challenges, and DZN Pulse profile entry points.
- Copy/share controls are private player UI only; they use the saved public href already returned for the authenticated player.
- Public `/players/[handle]` viewing remains unauthenticated only for published handles and still reads through `GET /api/public/player-profiles/[handle]`.
- Owner setup remains separate through `/pricing?intent=owner_setup&returnTo=%2Fsetup`.
- The slice must not require Starter, Pro, owner entitlement, server ownership, Nitrado access, Stripe, Discord bot permissions, or billing state for player profile links.

Privacy rules:

- Public profile links may expose only the generated public handle URL.
- Private profile share controls must not expose Discord IDs, internal user IDs, avatar hashes, source IDs, source tables, raw award evidence, exact award timestamps, billing rows, owner account state, Nitrado tokens, Discord bot tokens, Stripe state, or Cloudflare secrets.
- Hidden public sections must render as hidden/pending states rather than revealing private profile evidence.

Mutation scope:

- `GET /api/player/hub` may read the current player's profile privacy row to show public profile link state, but it must not write profile privacy, create handles, award XP, award calling cards, alter challenge progress, create checkout sessions, update owner billing, change server ownership, update rankings/leaderboards, modify discovery score, mutate reviews, award server badges, change seasons, modify events, alter Server Wars scoring/results, touch Nitrado, send Discord bot messages, change Cloudflare secrets, apply production migrations, merge issue #49, or enable live checkout.
- Copy/share controls may only copy to the local clipboard or invoke the browser share sheet.
- Public profiles remain read-only.

Fairness remains unchanged: public profile discovery links, copy/share controls, hidden section empty states, and pending section empty states must not affect billing, rankings, discovery score, reviews, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility.

## Public Profile Cross-Surface Attribution Slice

The public profile cross-surface attribution slice lets published player profiles appear beside player mentions on existing public/player surfaces, but only when DZN can prove the mention belongs to a logged-in DZN user who has opted into a generated public profile handle.

The slice adds:

- A shared read-only `PublicProfileAttribution` helper for generated public profile handles.
- Optional public profile links on public server review author rows.
- Optional current-player profile attribution on player-facing challenge participation rows.
- Optional profile links on safe leaderboard player mentions when a unique trusted `users.id` bridge exists through `player_profiles.discord_id`, `kill_events.killer_profile_id`, or `kill_events.victim_profile_id`.
- Client-side validation that only exact generated-handle `/players/...` public profile hrefs and `/api/public/player-profiles/...` API hrefs are rendered.

Authorization rules:

- Public profile attribution is read-only and must never create handles. Handle creation remains private player-owned behavior on `/api/player/profile-privacy`.
- Review author links may be shown only when `server_reviews.reviewer_discord_id` resolves to a DZN user with `public_profile_enabled = 1` and a generated `public_handle`.
- Player challenge/member attribution may be shown only on player-facing challenge rows tied to the current authenticated player's session and saved public profile handle.
- Leaderboard mentions may be linked only when a trusted account binding already exists and the aggregate resolves to exactly one DZN user. Ambiguous aggregates or kill/death rows with conflicting user bindings must render as plain names. DZN must not infer profile ownership by matching display names, gamertags, review text, leaderboard names, Discord names, or public handles supplied by a request body.
- Hidden, unpublished, malformed, missing, or unconfigured profiles must render without public profile links. Public review authors without a published profile must remain generic DZN player rows.

Privacy rules:

- Attribution payloads may expose only a display name, generated `public_handle`, public profile href, and public profile API href.
- Attribution payloads must not expose Discord IDs, internal user IDs, Discord avatar hashes or derived avatar URLs, source IDs, source tables, raw award evidence, ADM rows, billing rows, owner account state, Nitrado tokens, Discord bot tokens, Stripe state, or Cloudflare secrets.
- Review author rows must not expose reviewer Discord IDs or cached Discord avatar URLs through the public review UI.
- Raw ADM leaderboard player names can remain competitive/stat display text, but they must not become clickable profile links without the trusted account bridge and saved public handle.

Mutation scope:

- Cross-surface attribution may read `player_profile_privacy_preferences` and `users`, plus the existing source tables needed by the already-rendered surface.
- The slice must not add writes, background jobs, checkout sessions, profile handle generation, profile privacy updates, billing updates, server ownership changes, ranking updates, discovery score updates, review rating changes, event mutations, badge awards, season changes, Server Wars score/result changes, XP awards, calling-card awards, Nitrado calls, Discord bot messages, Cloudflare secret changes, production D1 writes, live checkout activation, or issue #49 changes.

Fairness remains unchanged: public profile attribution links are presentation-only and must not affect billing, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility.

## Public Profile Attribution Expansion And Controls Polish Slice

The public profile attribution expansion and controls polish slice adds a private "where my public profile appears" preview/control surface for logged-in players, then extends opt-in attribution only where a newly exposed public/player-safe row has a unique trusted user bridge.

The slice adds:

- `profile_attribution` preview metadata from the canonical public profile attribution helper on `GET /api/player/profile`, `GET /api/player/profile-privacy`, `PATCH /api/player/profile-privacy`, and `GET /api/player/hub`.
- A private `/player/profile` control panel named "Where My Public Profile Appears" that shows possible link placements, excluded surfaces, and a "Hide All Public Links" action backed by the existing `public_profile_enabled` preference.
- A compact `/player` Player Hub summary named "Where My Profile Appears" that previews the same player-owned visibility state.
- Public event suggestion author attribution on `event_suggestion_author_rows` by resolving `event_suggestions.submitted_by_user_id` through `player_profile_privacy_preferences` and `users`.
- Player Hub challenge-row attribution for the current player's own `player_state.public_profile`, reusing the existing trusted session-owned player progression payload.
- Exact client-side generated-handle href validation before rendering profile links on the newly touched UI surfaces.

Authorization and privacy rules:

- Normal Discord login remains enough for the private preview/control surfaces; Starter, Pro, owner entitlement, server ownership, Nitrado access, Stripe, Discord bot permissions, and billing state are not required.
- The preview/control metadata is read-only on `GET` routes. The only allowed write remains the existing private player-owned `PATCH /api/player/profile-privacy`, and it may only update the current player's `player_profile_privacy_preferences`.
- Event suggestion author links may be shown only when `event_suggestions.submitted_by_user_id` resolves to exactly one DZN user with `public_profile_enabled = 1` and a generated `public_handle`.
- Hidden, unpublished, malformed, missing, or unconfigured author profiles must render as generic `DZN player` rows without public profile links.
- DZN must not infer attribution from display names, gamertags, suggested titles, review names, leaderboard names, Discord names, request-body handles, or public handles supplied by the browser.
- Attribution payloads may expose only display name, generated public handle, public profile href, and public profile API href.

Excluded unless a dedicated proof slice explicitly proves a read-only presentation use:

- CTF/event scoring rosters that perform roster writes, scoring gates, eligibility checks, accepted scoring feeds, and owner decision mutations.
- Event roster rows that touch scoring, eligibility, sign-up decisions, or owner workflow state.
- Owner event management rows.
- Owner/admin review tools and moderation queues.
- Any surface where a public profile link could be mistaken for scoring, eligibility, ownership, moderation authority, or paid-plan status.

Mutation scope:

- This slice may read `player_profile_privacy_preferences`, `users`, `event_suggestions`, public event suggestion vote state when already requested by the existing public suggestion route, and current-player challenge progress already returned by the player progression read model.
- It must not add writes, background jobs, checkout sessions, profile handle generation outside the existing profile-privacy settings flow, billing updates, server ownership changes, ranking updates, discovery score updates, review rating changes, event mutations, CTF scoring changes, badge awards, season changes, Server Wars score/result changes, XP awards, calling-card awards, Nitrado calls, Discord bot messages, Cloudflare secret changes, production D1 writes, live checkout activation, or issue #49 changes.

Fairness remains unchanged: attribution controls and public/player-safe links are presentation-only and must not affect billing, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility.

## CTF/Event Roster Attribution Proof Slice

The CTF/event roster attribution proof slice permits public profile links only on read-only roster presentation rows after proving the links are metadata for display and cannot influence event operation or scoring.

The slice adds:

- A canonical `readPublicProfileAttributionsByRosterPlayerKeys` helper that resolves exact `(linked_server_id, player_id)` roster keys through `player_profiles.discord_id`, then `users.discord_id`, then `player_profile_privacy_preferences`.
- Optional `public_profile` metadata on `GET /api/servers/[serverId]/ctf/dashboard` roster rows only.
- A `profile_attribution` safeguards object on the CTF dashboard response documenting the trusted bridge, presentation-only link mode, no gamertag matching, no private identifier exposure, and no scoring, eligibility, owner-decision, or billing influence.
- A `Roster Display` panel on the CTF dashboard that renders linked public profile badges only after exact generated-handle href validation.

Authorization and bridge rules:

- The CTF dashboard remains an owner/admin dashboard route. This slice does not make CTF roster data public.
- Links may appear only when `ctf_tournament_rosters.linked_server_id` plus `ctf_tournament_rosters.player_id` resolves to exactly one `player_profiles` row with a Discord bridge to exactly one DZN `users` row.
- The linked user must have `public_profile_enabled = 1` and a generated `public_handle`.
- Hidden, unpublished, malformed, missing, cross-server, or ambiguous bridges render as plain roster names without profile links.
- DZN must not infer CTF/event roster attribution from player name, gamertag casing, display name, Discord username, request-body handle, or public handle supplied by the browser.

Still excluded:

- `POST /api/servers/[serverId]/ctf/roster` registration and roster writes.
- `isPlayerOnLockedRoster`, `evaluateCtfPointProgression`, `shouldCountBattleActiveEvent`, point increments, flag raising, and `ctf_event_audit` writes.
- Accepted scoring feed rows and verified action feed decisions.
- Event roster approval, eligibility, sign-up, matchmaking, bracket, owner decision, moderation, and admin workflow mutations.

Mutation scope:

- This slice may read `ctf_tournament_rosters`, `player_profiles`, `users`, and `player_profile_privacy_preferences` from the already-authorized dashboard read path.
- It must not add writes, background jobs, checkout sessions, profile handle generation, profile privacy updates, billing updates, server ownership changes, ranking updates, discovery score updates, review rating changes, event mutations, CTF scoring changes, badge awards, season changes, Server Wars score/result changes, XP awards, calling-card awards, Nitrado calls, Discord bot messages, Cloudflare secret changes, production D1 writes, live checkout activation, or issue #49 changes.

Fairness remains unchanged: CTF roster attribution links are presentation-only and must not affect billing, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, owner decisions, event eligibility, CTF scoring, or competitive eligibility.

## Event Roster/Member Public-Safe Expansion Slice

The event roster/member public-safe expansion slice adds the first public event/community member attribution outside the suggestion board. Because the current public event detail surfaces expose server/team participants as scored event rows, those rows remain excluded. The safe expansion is the event host/member badge on public event summaries and details, backed by the trusted `competitive_events.created_by` to `users.id` bridge.

The slice adds:

- Optional `creator_profile` metadata on public event summary payloads from `GET /api/events`, `GET /api/events/[slug]`, and server event profile event-card payloads.
- A `profile_attribution` safeguards object with placement `public_event_creator_member_rows`, `link_mode = presentation_only`, the trusted bridge, no gamertag matching, no private identifier exposure, and no scoring, eligibility, owner-decision, or billing influence.
- A reusable public event attribution badge that validates generated public profile hrefs and API hrefs before rendering.
- Event card, event table, and event detail hero display links only when the event creator has opted into public profile visibility and has a generated handle.

Authorization and bridge rules:

- Event host/member links may appear only when `competitive_events.created_by` resolves to a DZN `users.id` row whose saved `player_profile_privacy_preferences` has `public_profile_enabled = 1` and a valid generated `public_handle`.
- Hidden, unpublished, malformed, missing, or unconfigured event creators render without a profile link.
- Public event payloads must not expose raw `created_by`, internal user IDs, Discord IDs, public handles supplied by the browser, or any gamertag-derived identity.
- DZN must not infer event member attribution from server names, player names, gamertags, event titles, Discord usernames, request-body handles, public handles supplied by clients, review names, or leaderboard names.

Still excluded:

- Registered server rows, event leaderboards, match rows, CTF scoring rows, accepted CTF audit feeds, and bracket outcomes.
- Event roster rows that touch scoring, eligibility, sign-up/approval decisions, owner workflows, moderation, or admin operations.
- Billing, plan status, owner entitlement, rankings, discovery score, reviews, badges, seasons, Server Wars scoring, XP awards, calling-card awards, Nitrado, Discord bot mutations, Cloudflare secrets, production D1 writes, live checkout activation, and issue #49.

Mutation scope:

- This slice may read `competitive_events.created_by`, `users`, and `player_profile_privacy_preferences` from public event read paths.
- It must not add writes, background jobs, checkout sessions, profile handle generation, billing updates, server ownership changes, ranking updates, discovery score updates, review rating changes, event mutations, roster mutations, CTF scoring changes, badge awards, season changes, Server Wars score/result changes, XP awards, calling-card awards, Nitrado calls, Discord bot messages, Cloudflare secret changes, production D1 writes, live checkout activation, or issue #49 changes.

Fairness remains unchanged: event host/member profile links are presentation-only and must not affect billing, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, owner decisions, event eligibility, CTF scoring, bracket outcomes, or competitive eligibility.

## Public-Safe Community Member Directory Foundation Slice

The public-safe community member directory foundation adds a dedicated read-only public community/player-member surface only after introducing a unique trusted DZN user bridge. It does not infer identity from Discord display names, player names, gamertags, review names, leaderboard names, or browser-supplied handles.

The slice adds:

- Additive `community_members` bridge table with unique `(community_guild_id, user_id)` membership, linked to `discord_guilds.id` and `users.id`.
- `GET /api/public/servers/[serverId]/community-members` as a public-safe read-only directory payload scoped to a public linked server.
- `/servers/[slug]/community` as the public community member page.
- Public server card/profile links to the community member page.
- A `profile_attribution` safeguards object with placement `public_community_member_directory`, `link_mode = presentation_only`, the trusted bridge, no gamertag or Discord-name matching, no private identifier exposure, and no scoring, owner-decision, approval, bracket, billing, ranking, review, badge, season, Server Wars, XP, calling-card, or competitive eligibility influence.
- Private profile-attribution preview metadata showing the community directory as an allowed public placement only when the player has an opted-in generated public profile handle and a unique trusted bridge.

Authorization and bridge rules:

- The directory is public read-only, but it may show only users present in `community_members` with `public_member_enabled = 1`, `source = 'trusted_dzn_bridge'`, and a published generated profile handle.
- `community_members.community_guild_id` must point to the linked server's `discord_guilds.id`; `community_members.user_id` must point to exactly one DZN `users.id` row.
- Hidden, unpublished, malformed, missing, disabled, unconfigured, or ambiguous members render as absent. They must not become fallback text with a clickable profile link.
- Payloads may expose only safe display name, role label, coarse member-since label, generated public handle, public profile href, and public profile API href.
- Payloads must not expose raw `community_guild_id`, raw `user_id`, Discord IDs, Discord OAuth tokens, raw award evidence, server ownership state, billing state, approval state, scoring state, or owner workflow state.

Still excluded:

- CTF scoring rows, accepted CTF audit feeds, locked roster checks, point progression, flag raises, and score writes.
- Owner workflow rows, community member source/import writes, approval decisions, moderation authority, Nitrado linking, Discord bot mutations, and bracket outcomes.
- Billing, plan status, owner entitlement, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, Cloudflare secrets, production D1 writes, live checkout activation, and issue #49.

Mutation scope:

- This slice may read `linked_servers`, `discord_guilds`, `community_members`, `users`, and `player_profile_privacy_preferences`.
- It must not add writes, background jobs, checkout sessions, profile handle generation, profile privacy updates, billing updates, server ownership changes, ranking updates, discovery score updates, review rating changes, event mutations, roster mutations, CTF scoring changes, badge awards, season changes, Server Wars score/result changes, XP awards, calling-card awards, Nitrado calls, Discord bot messages, Cloudflare secret changes, production D1 writes, live checkout activation, or issue #49 changes.

Fairness remains unchanged: public community member profile links are presentation-only and must not affect CTF scoring rows, owner workflow rows, approval decisions, bracket outcomes, billing, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility.

## Trusted Community Member Source Management and Audit Slice

The trusted community member source management and audit slice adds the private owner/admin workflow that can review candidate members and import them into the existing presentation-only `community_members` bridge. It does not make community member directories an owner-controlled public profile system. A player still appears publicly only when the player has opted into a generated public profile handle through the player-owned profile privacy settings.

The slice adds:

- Additive `community_member_candidates` rows for owner/admin-reviewed community member source candidates.
- Additive `community_member_source_audit` rows for candidate creation, import, rejection, duplicate rejection, ambiguous-user rejection, and no-match outcomes.
- `GET /api/owner/community-members` to list scoped servers, candidates, counts, safeguards, and audit history.
- `POST /api/owner/community-members` to save a candidate after resolving whether a unique trusted DZN user bridge exists.
- `POST /api/owner/community-members/[candidateId]` to import or reject a candidate.
- `/dashboard/community-members` and `/owner/community-members` as private owner/admin source-management pages.
- A dashboard `Community Members` tab alongside review moderation and progression audit.

Authorization and source rules:

- Normal owners must pass the canonical owner entitlement boundary and may manage only their own linked servers.
- Configured DZN admins may review candidate sources across linked servers.
- Candidate imports require either an exact Discord ID or an exact DZN user ID that resolves to exactly one existing `users` row.
- Discord display names, DZN display names, gamertags, review names, leaderboard names, and request-supplied public profile handles are not trusted identity bridges.
- Duplicate `community_members` rows for the same `(community_guild_id, user_id)` are rejected and recorded in the audit history.
- Ambiguous user bridges are rejected and recorded in the audit history.
- A successful import may write only a `community_members` row with `source = 'trusted_dzn_bridge'`; it may not write profile privacy preferences or generate a public profile handle.
- Public visibility still requires `community_members.public_member_enabled = 1`, `source = 'trusted_dzn_bridge'`, and the player's own opted-in generated `player_profile_privacy_preferences.public_handle`.

Still excluded:

- Public profile visibility without the player's opt-in generated handle.
- CTF scoring rows, owner workflow decisions, approval decisions, bracket outcomes, event eligibility, scoring feeds, and accepted audit feeds.
- Billing, plan status, owner entitlement mutation, rankings, discovery score, reviews, review score, badges, seasons, Server Wars scoring, XP awards, calling-card awards, and competitive eligibility.
- Stripe checkout activation, Stripe product/price changes, Cloudflare secret changes, production D1 writes, Nitrado calls, Discord resource mutation, and issue #49.

Mutation scope:

- This slice may read `linked_servers`, `discord_guilds`, `users`, `community_members`, `community_member_candidates`, `community_member_source_audit`, and `player_profile_privacy_preferences`.
- This slice may write only `community_member_candidates`, `community_member_source_audit`, and imported `community_members` rows after a unique trusted DZN user bridge is confirmed.
- It must not add background jobs, checkout sessions, profile handle generation, profile privacy updates, billing updates, server ownership changes, ranking updates, discovery score updates, review rating changes, event mutations, roster mutations, CTF scoring changes, badge awards, season changes, Server Wars score/result changes, XP awards, calling-card awards, Nitrado calls, Discord bot messages, Cloudflare secret changes, production D1 writes, live checkout activation, or issue #49 changes.

Fairness remains unchanged: source-management controls are owner/admin tools for presentation bridge review only. They cannot make a player publicly visible without the player's opt-in generated handle and must not affect CTF scoring rows, owner workflow decisions, approval decisions, bracket outcomes, billing, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility.

## Community Member Import Usability Polish Slice

The community member source import usability polish slice builds on the owner/admin source-management queue with safer import previews, trusted Discord/guild snapshot context where available, repeated no-match and repeated duplicate filters, and a private owner notification hook when a candidate becomes importable. It remains a presentation-only source review workflow. It does not publish a player profile, create a public profile handle, change source authority, or alter competitive systems.

The slice adds:

- Additive `community_member_source_snapshots` rows for trusted Discord/guild snapshot preview context. These rows are read as import preview evidence only and are not identity bridges by themselves.
- A refreshed import preview state for each `community_member_candidates` row that explains whether import is ready, blocked by no-match, blocked by duplicate state, blocked by ambiguity, already imported, or rejected.
- `refresh_preview` support on `POST /api/owner/community-members/[candidateId]` so owners/admins can re-check a stored candidate when a player later logs in and creates a unique DZN user bridge.
- Admin queue filters for `importable`, repeated no-match, and repeated duplicate source rows.
- `community_member_candidate_importable` DZN Pulse notifications written to `user_notifications` for the linked-server owner only when a previously blocked/pending candidate becomes importable.
- Dashboard UI for safer import previews, trusted snapshot details, refresh action, repeated no-match filtering, repeated duplicate filtering, and importable filtering.

Authorization and source rules:

- Normal owners must still pass the canonical owner entitlement boundary and may manage only their own linked servers.
- Configured DZN admins may still review global candidate source rows.
- Import readiness still requires exactly one trusted DZN user bridge and no existing `community_members` duplicate for `(community_guild_id, user_id)`.
- A trusted Discord/guild snapshot may improve owner/admin review context, but it cannot import a candidate without an exact DZN user bridge.
- Notification hooks are private DZN Pulse records only. They do not send Discord messages, mutate Discord guilds, or expose candidate Discord IDs to another owner.
- Notification read state remains private per owner/admin user and must not affect importability, public profile visibility, review state, billing, rankings, discovery, or progression.

Still excluded:

- Public profile visibility without the player's opt-in generated handle.
- Public profile handle creation, profile privacy updates, or player-owned display preference changes.
- CTF scoring rows, owner workflow decisions, approval decisions, bracket outcomes, event eligibility, scoring feeds, and accepted audit feeds.
- Billing, plan status, owner entitlement mutation, rankings, discovery score, reviews, review score, badges, seasons, Server Wars scoring, XP awards, calling-card awards, and competitive eligibility.
- Stripe checkout activation, Stripe product/price changes, Cloudflare secret changes, production D1 writes, Nitrado calls, Discord resource mutation, and issue #49.

Mutation scope:

- This slice may read `linked_servers`, `discord_guilds`, `users`, `community_members`, `community_member_candidates`, `community_member_source_audit`, `community_member_source_snapshots`, `player_profile_privacy_preferences`, and `user_notifications`.
- This slice may write only `community_member_source_snapshots` schema, `community_member_candidates` preview refresh fields, `community_member_source_audit` audit rows, imported `community_members` rows after a unique trusted DZN user bridge is confirmed, and private `user_notifications` rows for `community_member_candidate_importable`.
- It must not add checkout sessions, profile handle generation, profile privacy updates, billing updates, server ownership changes, ranking updates, discovery score updates, review rating changes, event mutations, roster mutations, CTF scoring changes, badge awards, season changes, Server Wars score/result changes, XP awards, calling-card awards, Nitrado calls, Discord bot messages, Cloudflare secret changes, production D1 writes, live checkout activation, or issue #49 changes.

Fairness remains unchanged: safer import previews, repeated source filters, and owner notification hooks are presentation workflow aids only. They cannot make a player publicly visible without the player's opt-in generated handle and must not affect CTF scoring rows, owner workflow decisions, approval decisions, bracket outcomes, billing, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility.

## Community Member Import Workflow Execution Polish Slice

The community member import workflow execution polish slice turns the reviewed candidate queue into a safer owner/admin workflow with selected-row bulk execution and private import-alert read controls. It remains a presentation-only source-management workflow and keeps every decision server-side.

The slice adds:

- Selected-row bulk import and bulk reject actions from the owner/admin dashboard.
- `bulkActOnCommunityMemberCandidates` as the server-side execution helper.
- `POST /api/owner/community-members/bulk` for selected candidate IDs, capped to a bounded request size and authenticated before the request body is read.
- A server-side recheck for every selected row by reusing the existing single-candidate import/reject path, including owner/admin scope, candidate status, unique trusted DZN user bridge resolution, duplicate community-member rejection, and audit writes.
- Private unread counts for `community_member_candidate_importable` alerts on the community member source-management payload.
- `POST /api/owner/community-members/notifications/read` for marking only active `community_member_candidate_importable` alerts read for the current owner/admin user.
- Dashboard UI for selecting pending rows, importing or rejecting the selected queue entries, and marking import alerts read without clearing general Pulse alerts.

Authorization and source rules:

- Normal owners must still pass the canonical owner entitlement boundary and may manage only their own linked servers.
- Configured DZN admins may still review global candidate source rows.
- Browser selection is never trusted as authorization or import readiness. Every selected row is re-read and rechecked server-side.
- Only pending candidates can be rejected from review.
- Import still requires exactly one trusted DZN user bridge and no existing `community_members` duplicate for `(community_guild_id, user_id)`.
- Notification read state is private per owner/admin user. Marking import alerts read cannot clear another owner's alerts and cannot clear unrelated general DZN Pulse alerts.

Still excluded:

- Public profile visibility without the player's opt-in generated handle.
- Public profile handle creation, profile privacy updates, or player-owned display preference changes.
- CTF scoring rows, owner workflow decisions, approval decisions, bracket outcomes, event eligibility, scoring feeds, and accepted audit feeds.
- Billing, plan status, owner entitlement mutation, rankings, discovery score, reviews, review score, badges, seasons, Server Wars scoring, XP awards, calling-card awards, and competitive eligibility.
- Stripe checkout activation, Stripe product/price changes, Cloudflare secret changes, production D1 writes, Nitrado calls, Discord resource mutation, and issue #49.

Mutation scope:

- This slice may read `linked_servers`, `discord_guilds`, `users`, `community_members`, `community_member_candidates`, `community_member_source_audit`, `community_member_source_snapshots`, `player_profile_privacy_preferences`, and `user_notifications`.
- This slice may write only `community_member_candidates` review/import state, `community_member_source_audit` audit rows, imported `community_members` rows after a unique trusted DZN user bridge is confirmed, and private `user_notifications.read_at` values for the current owner/admin user's active `community_member_candidate_importable` alerts.
- It must not add checkout sessions, profile handle generation, profile privacy updates, billing updates, server ownership changes, ranking updates, discovery score updates, review rating changes, event mutations, roster mutations, CTF scoring changes, badge awards, season changes, Server Wars score/result changes, XP awards, calling-card awards, Nitrado calls, Discord bot messages, Cloudflare secret changes, production D1 writes, live checkout activation, or issue #49 changes.

Fairness remains unchanged: selected-row bulk actions and import-alert read controls are owner/admin workflow aids only. They cannot make a player publicly visible without the player's opt-in generated handle and must not affect CTF scoring rows, owner workflow decisions, approval decisions, bracket outcomes, billing, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility.

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
| `/player/profile` and `/api/player/profile` | 401/login redirect | Allowed | Allowed | Allowed | Session auth, private no-store profile progression showcase, read-only |
| `/api/player/profile-privacy` | 401 | Allowed | Allowed | Allowed | Private player-owned settings API; GET/PATCH only; writes only `player_profile_privacy_preferences` |
| `/players/[handle]` and `/api/public/player-profiles/[handle]` | Published profiles only | Published profiles only | Published profiles only | Published profiles only | Public-safe read-only profile viewer; respects saved player visibility preferences |
| Public profile attribution on reviews/challenges/leaderboards | Published profiles only | Published profiles only | Published profiles only | Published profiles only | Read-only generated-handle attribution; no name-only matching; ambiguous/hidden/unpublished profiles are not linked |
| Public profile attribution preview/control and safe event-suggestion author links | Public event suggestion links only when published | Allowed on private player surfaces; event suggestion links only when published | Allowed on private player surfaces; event suggestion links only when published | Allowed on private player surfaces; event suggestion links only when published | Player-owned visibility control; trusted user bridge required; roster scoring gates and owner mutations excluded |
| CTF/event presentation roster profile links | 401/login boundary | Owner/admin dashboard access required | Own server dashboard read-only, if owner/admin checks pass | Own server dashboard read-only, if owner/admin checks pass | Exact roster server/player bridge; generated handle required; presentation-only; registration, scoring, eligibility, and owner decisions unaffected |
| Public event host/member profile links | Published profiles only | Published profiles only | Published profiles only | Published profiles only | `competitive_events.created_by` trusted user bridge; presentation-only; event leaderboards, scoring rows, approvals, brackets, and owner workflows excluded |
| Public community member directory profile links | Published profiles only | Published profiles only | Published profiles only | Published profiles only | `community_members.community_guild_id` plus `community_members.user_id` trusted bridge; presentation-only; CTF scoring rows, owner workflow rows, approvals, brackets, billing, rankings, discovery, reviews, badges, seasons, Server Wars, XP, calling cards, and eligibility unaffected |
| `/api/owner/community-members`, `/dashboard/community-members`, and `/owner/community-members` | Login/pricing boundary | Owner plan required | Own linked-server source management | Own linked-server source management, or global if DZN admin | Owner entitlement/admin plus linked-server scope; writes only candidates, source audit, trusted snapshot previews, private importable notifications, and imported `community_members`; duplicate and ambiguous user bridges are rejected; repeated no-match/duplicate filters are review-only; cannot make a player publicly visible without the player's opt-in generated handle |
| `/api/cron/player-progression/awards` | 401 | 401 | 401 | 401 | Cron secret only, verified award fact collection, retry, and award processing |
| `/api/owner/progression/award-audit` | Login/pricing boundary | Owner plan required | Own linked-server award-source history | Own linked-server award-source history, or global if DZN admin | Owner entitlement/admin plus linked-server audit scope; read-only |
| `/dashboard/progression-awards` and `/owner/progression-awards` | Login/pricing boundary | Owner plan required | Own linked-server award-source history | Own linked-server award-source history, or global if DZN admin | Same private audit API; status/adapter/linked-server/retry filters only |
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
