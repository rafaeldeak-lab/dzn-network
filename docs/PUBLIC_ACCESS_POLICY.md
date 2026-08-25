# DZN Public Access Policy

This policy separates public entry points from authenticated product pages. It is intentionally conservative: hidden navigation is not enough; direct URLs must match the same access model.

## Logged-Out Visitors

Logged-out visitors may access:

- `/`
- `/#features`
- `/pricing`
- `/login`
- `/signup`
- the public Discord invite link

Logged-out navigation must only expose the public funnel: homepage/features, pricing, Login/Signup, and Discord. It must not show dashboard, server browser, leaderboards, stats, events, owner tools, or add-server controls before a session is known.

Logged-out visitors are redirected to `/login?returnTo=...` before app-page rendering for:

- `/dashboard`
- `/dzn-pulse`
- `/events`
- `/leaderboards`
- `/player`
- `/seasons`
- `/servers`
- `/setup`
- `/test`

Nested routes under those paths follow the same rule. Examples include `/events/suggest`, `/events/server-wars`, `/servers/profile?slug=...`, `/servers/[slug]`, `/dashboard/events`, and `/setup/...`.

## Logged-In Players

Logged-in Discord users are free DZN players by default. They may open player-facing authenticated app pages without choosing a paid owner plan:

- `/dzn-pulse`
- `/events`
- `/leaderboards`
- `/player`
- `/seasons`
- `/servers`

Player-facing and community surfaces may use the Discord OAuth `identify guilds` scope to match the player's Discord communities to DZN-connected servers. Player guild matching must not grant server-management rights and must not overwrite owner/admin guild records.

Starter trial and Pro behavior must continue to come from the billing/entitlement helpers and API responses. A page redirect must not replace owner authorization, plan enforcement, Stripe webhook checks, Nitrado ownership checks, or protected API 401/403 behavior.

Free player accounts should see player navigation plus a clear owner-plan action. Starter/trial accounts should see trial-safe owner navigation plus a clear Pro upgrade action. Pro-effective accounts should see Pro tools in the header. This header visibility is product guidance only; APIs and owner/product pages must continue enforcing access server-side.

Dashboard package visibility must follow the same split. Starter/trial users may see the normal setup, public listing, basic stats, events, billing comparison, and basic Discord posting surfaces, but any Pro-only analytics, promotion, Server VS Server hosting, or enhanced Discord post controls must read as locked or upgrade-gated. Pro-effective users may see those tools as active, while server-side entitlement checks remain authoritative.

Package copy must not imply a competitive advantage. Pro presentation, promotion, analytics, and owner tooling must not change leaderboard rank, K/D, score, reviews, crowns, badges, season wins, event outcomes, or gameplay results.

## Owner Setup And Server Management

Owner/server-management actions require Discord login plus an active or trialing owner entitlement from the canonical billing layer. Free Discord players must be redirected to `/pricing?intent=owner_setup&returnTo=%2Fsetup` for setup/dashboard pages and must receive an owner-plan-required API error for direct owner API calls.

Owner-gated pages include:

- `/setup`
- `/dashboard`

Owner-gated APIs include:

- `/api/onboarding/*`
- `/api/nitrado/*`
- `/api/server/*`
- `/api/servers/[serverId]/*`
- owner-triggered `/api/sync/*` calls, except cron-secret-authorized sync paths
- `/api/events/[slug]/join` and `/api/events/matchmaking` when acting on an owned server
- `/api/discord/bot-status`

Existing ownership, role, Nitrado, Discord admin, and Pro-feature checks still apply after the owner entitlement gate passes. A paid plan does not make a user the owner of someone else's linked server.

## Owner Pages

`/owner` and nested owner pages remain stricter than normal logged-in pages. They must continue to require platform-owner or platform-creator authorization through the owner page functions.

## Public APIs

The homepage and public preview surfaces still need public read-only JSON. These APIs remain callable without a session unless a later high-risk access redesign explicitly changes them:

- `/api/public/servers`
- `/api/public/home-stats`
- `/api/public/server-rail`
- `/api/public/leaderboards`
- `/api/public/leaderboards/advanced`
- `/api/public/server-wars`
- `/api/events`
- `/api/events/suggestions?sort=newest&limit=5`
- `/api/dzn-pulse/config`

Authenticated player APIs such as `/api/player/hub` and `/api/player/communities` may require a session while remaining free of owner billing requirements.

`/api/player/hub` is the free logged-in Player Hub payload. It may read matched Discord communities, saved/followed server preferences, public server suggestions, and public event/tournament suggestions. It must not create checkout sessions, call Nitrado, mutate Discord guild ownership, require owner entitlement, write billing state, or alter competitive/stat tables.

`/api/player/saved-servers` is the free logged-in save/follow preference endpoint. `GET` returns only the current player's saved public servers. `POST` and `DELETE` may write only the current player's row in `player_saved_servers` after resolving the target as a visible public server. Saving a server must not affect rankings, discovery score, billing, server ownership, reviews, events, tournaments, Server Wars, badges, XP, challenge outcomes, or competitive eligibility.

`/api/player/reviews` is the free logged-in review submission endpoint. It may create or update only the current player's review row in `server_reviews` for a visible public server, subject to review validation, moderation checks, owner self-review blocking, and cooldown rules. Review submission must not require Starter, Pro, owner entitlement, server ownership, Nitrado access, Stripe, Discord bot permissions, or billing state. Review submission must not affect rankings, discovery score, billing, server ownership, events, tournaments, Server Wars, badges, seasons, XP, challenge outcomes, calling cards, or competitive eligibility.

`/api/player/challenges` is the free logged-in challenge participation and progression endpoint. `GET` returns player challenge catalog rows, the current player's private joined/completed state, earned XP summary, and earned calling-card hooks. `POST` may join an active challenge by writing only the current player's row in `player_challenge_participations`. Player challenge participation must not affect rankings, discovery score, billing, server ownership, reviews, review score, events, tournaments, Server Wars scoring, badges, seasons, XP self-awards, calling-card self-awards, or competitive eligibility.

`/player/profile` and `/api/player/profile` are free logged-in player progression showcase surfaces. The page shows earned XP, challenge progress, calling cards, and a progression timeline from the existing player progression read model, with privacy display controls for private view, public-safe preview, and hidden preview. Public profile publishing stays off. The API must be `GET` only, private/no-store, session-scoped through `getRequestSessionUser`, and read-only. It may hydrate saved display choices from the current player's private profile privacy preferences. It must not require Starter, Pro, owner entitlement, server ownership, Nitrado access, Stripe, Discord bot permissions, or billing state, and must not expose Discord IDs, internal user IDs, source IDs, raw evidence blobs, billing rows, Nitrado tokens, Discord bot tokens, or Stripe state. Profile progression showcase visibility must not affect paid plans, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars scoring, server ownership, XP awards, calling-card awards, or competitive eligibility.

`/api/player/profile-privacy` is the private player-owned settings API for persistent profile visibility preferences. `GET` returns only the current player's saved privacy settings or safe defaults, and `PATCH` may write only the current player's row in `player_profile_privacy_preferences`. The endpoint must use `getRequestSessionUser`, private/no-store responses, bounded JSON parsing, and session-owned user binding. It must reject logged-out visitors, reject non-`GET`/`PATCH` methods, ignore body-supplied `user_id` or `discord_id` values, and must not require Starter, Pro, owner entitlement, server ownership, Nitrado access, Stripe, Discord bot permissions, or billing state. No public profile reader route is introduced by this settings API. Display preferences must not affect billing, rankings, discovery, reviews, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility.

`/api/cron/player-progression/awards` is not a public or player endpoint. It is a cron-secret-protected trusted job for converting verified activity facts into player XP and calling-card awards. It may accept only explicitly verified source facts, process pending verified source rows, update existing player challenge participation progress/completion, and insert idempotent player XP/calling-card rows. It must not accept normal session auth, owner entitlement, Starter, Pro, server ownership, Nitrado, Stripe, or Discord bot permissions as a substitute for the cron secret. Progression awards must remain player profile progression only and must not affect rankings, discovery score, billing, server ownership, reviews, review score, events, tournaments, Server Wars scoring, badges, seasons, or competitive eligibility.

The protected progression award job may also collect verified source facts from trusted DZN activity adapters: ADM `player_events`, ADM `kill_events`, server event entries, and approved review/community activity. Those adapter reads can feed `player_progression_award_sources` and the same job can schedule failed source rows for retry. Adapter collection and retry must stay cron-secret-only, bounded, idempotent, and limited to progression-owned writes.

`GET /api/owner/progression/award-audit` is a private owner/admin audit surface, not a player progression mutation path. Normal owners must pass the canonical owner entitlement boundary and can read only award-source history tied to their own linked servers; configured DZN admins may read the global audit history. The route may show awarded, skipped, failed, progressed, duplicate, and pending source status with attempt/retry metadata, but it must be read-only, private/no-store, and must not expose raw evidence blobs, Discord IDs, billing state, Nitrado tokens, Discord bot tokens, Stripe secrets, or checkout configuration.

`/dashboard/progression-awards` and `/owner/progression-awards` are private owner/admin UI surfaces for the same audit route. They may filter by status, adapter key, linked server, and retry availability, but those filters must remain additive to the canonical owner/admin scope. The UI may display retry metadata and failed-row counts only; retry execution must remain cron-secret-only through `/api/cron/player-progression/awards` and must not be available as a browser action.

`/api/public/server-reviews` remains the public/read path for review summaries and approved review bodies. Logged-out users can receive a locked preview summary; logged-in players can read approved reviews and see their own review state. Public review responses must not expose reviewer Discord IDs or owner reply author user IDs.

`/api/public/server-reviews/[reviewId]/report` is a logged-in player moderation hook. It may write a report row, increment the reported review count, and move a repeatedly reported review to pending review. It must not write billing, ownership, ranking, discovery, badge, season, event, or competitive tables.

Owner replies are server-management actions. `PUT`/`DELETE /api/servers/[serverId]/reviews/[reviewId]/reply` must stay behind the owner entitlement boundary and existing server owner/admin checks. Owner replies may be displayed publicly with approved reviews, but they must not change the review rating, review count, average, ranking, discovery score, badge eligibility, seasons, events, or competitive eligibility.

`/dashboard/reviews`, `/owner/reviews`, and `/api/reviews/moderation` are private moderation surfaces. Normal owners must pass the canonical owner entitlement boundary and can only see or act on reviews for their own linked servers. Configured DZN admins can triage across servers through the same API. Moderation may approve, hold, remove, dismiss reports, save owner replies, remove owner replies, read safe status history, show owner dashboard badges, and create internal DZN Pulse notification rows. It must not change ratings, rankings, discovery score, billing, server ownership, badges, seasons, events, Server Wars, challenge outcomes, XP, calling cards, or competitive eligibility.

`POST /api/reviews/moderation/bulk` is stricter than the normal queue. It is DZN-admin-only and only accepts repeated report patterns returned by the private moderation API. It may update matching review moderation state, append moderation audit rows, and create internal DZN Pulse owner notifications. It must not be available to normal owners, must not expose actor user IDs or Discord IDs in status history, and must not write billing, ownership, ranking, discovery, badge, season, event, or competitive tables.

`POST` `/api/reviews/moderation/notifications/read` is the private review-alert read-state endpoint for the owner dashboard and review moderation queue. Normal owners must pass the canonical owner entitlement boundary, configured DZN admins may clear their own admin review alerts, and normal free players must be rejected. The endpoint may update only unread, unexpired `user_notifications.read_at` rows belonging to the authenticated owner/admin and matching review moderation notification types or `/dashboard/reviews` action URLs. Review notification read state is private per owner/admin, does not clear general DZN Pulse alerts, does not send Discord notifications, and must not affect billing, rankings, discovery score, review score, badges, seasons, events, Server Wars, challenge outcomes, XP, calling cards, or competitive eligibility.

Event browsing, event detail pages, event suggestions, votes, and reports remain player/community surfaces. Registering or matching an owned server for an event is an owner action and must cross the billing entitlement boundary first.

These APIs must keep their existing preview redaction and `Vary: Cookie` behavior where applicable. Public API availability does not mean the corresponding app page is public.

## Production Verification

Post-merge verification should expect:

- `/` returns `200`.
- `/pricing` returns `200` and opens the dedicated Starter/Pro pricing page.
- Logged-out direct app pages such as `/player`, `/events`, `/leaderboards`, `/servers`, `/dashboard`, `/setup`, `/dzn-pulse`, and `/seasons` return a login redirect.
- Logged-in free players can open player surfaces such as `/player`, `/events`, `/leaderboards`, `/servers`, `/dzn-pulse`, and `/seasons` without payment.
- Logged-in free players who open `/setup` or `/dashboard` are redirected to the dedicated owner pricing page.
- Logged-out header/navigation does not expose app/product controls, while authenticated headers show player/owner package-appropriate actions.
- The dashboard sidebar shows package-aware guidance: trial-safe tools, Pro locks/upgrade prompts, or active Pro tools based on the authenticated account summary.
- Public APIs above return `200` and no unexpected 5xx.
- Owner/protected APIs such as `/api/owner/events`, `/api/billing/status`, and `/api/nitrado/services` remain `401` without authentication. Owner-management APIs return owner-plan-required errors for authenticated free players.
- No production D1, Stripe, Nitrado, Discord, or secrets mutation is required for this policy.
