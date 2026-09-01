# DZN Player + Owner Platform Specification

Last updated: 2026-09-01

This document is the durable product and engineering contract for DZN's split player and server-owner platform. Chat history is not the source of truth once this spec exists.

## Platform Shape

DZN has two connected but separate journeys:

- Public website: the homepage sells the network, shows the DZN pitch, highlights core features, and sends visitors to focused app pages.
- Free player platform: Discord login unlocks player-facing pages such as servers, leaderboards, events, communities, the Player Hub, and personal profile tools without payment.
- Paid owner platform: server setup, Nitrado linking, owner dashboards, server-management APIs, automation, promotion, analytics, and owner-only tools are behind the canonical billing entitlement layer.
- Competitive systems: rankings, discovery scoring, reviews, badges, seasons, Server Wars, CTF scoring, XP awards, calling-card awards, and competitive eligibility remain isolated from monetisation and private player preferences.

## Public Homepage And Pricing

The homepage must remain a clear DZN intro/sales page. It may show a short pricing teaser and action buttons, but it must not carry the full billing surface.

The dedicated `/pricing` page owns the full pricing/payment explanation:

- Starter: 2-day free trial, then `£2/month`.
- Pro: `£10/month`.
- Clear side-by-side comparison with green ticks and red Xs.
- Pro should have a richer feature list than Starter.
- Payment improves owner tools, presentation, publishing, promotion, and analytics only.
- Payment never buys competitive advantage.

Issue `#49` remains reserved for final live checkout activation. Do not merge or repurpose it for normal preview, test-mode, or local/sandbox billing work.

## Access Model

Player access:

- Normal Discord users get free access to logged-in player surfaces.
- Player surfaces include server listings/profiles, leaderboards, events/tournaments, community pages, saved/followed servers, profile tools, reviews, challenges, XP progress, calling-card showcases, and public-safe profile links.
- Player features may require login, but must not require Starter or Pro unless they become owner/server-management features.

Owner access:

- Owner/server-management actions are separate from player actions.
- `/setup`, Nitrado linking, onboarding/server-management APIs, owner dashboards, owner review reply/reporting tools, Discord publishing, promotion, and analytics must remain protected server-side by the canonical billing entitlement layer.
- Owner flow is: login, owner action, `/pricing`, Stripe Checkout when deliberately enabled, confirmed entitlement, setup.
- Player flow is: login, player/community surfaces, no payment required.

## Discord Communities

DZN should use minimal Discord OAuth guild access where compatible with the current codebase to match logged-in players to communities and connected DZN servers.

Community matching is presentation and discovery assistance only. It must not grant server ownership, bypass owner billing, change rankings, affect review scores, award XP, award calling cards, or change competitive eligibility.

## Saved And Followed Servers

Saved/followed servers are private player preferences:

- Stored in `player_saved_servers`.
- Owned by the current DZN user.
- Read through private no-store player APIs.
- Used for personal convenience, Player Hub surfacing, and future private notification preferences only.
- Never included in shared public server snapshots or cached public API payloads.
- Never used by ranking, discovery score, billing, ownership, reviews, events, badges, seasons, Server Wars, CTF, XP, calling-card awards, or competitive eligibility.

## Player Hub Roadmap

The Player Hub should become the free logged-in player home:

- Matched Discord communities.
- Followed/saved servers.
- Suggested public events and tournaments.
- Player profile entry points.
- Challenge progress.
- XP and calling-card progress.
- Public profile preview/share controls.
- "Where my public profile appears" controls.

The Player Hub must stay player-side and cannot unlock owner setup without going through `/pricing` and entitlement gates.

### Player Hub Real-Data Foundation

The first real-data Player Hub slice adds a private read-only `/api/player/hub` model and hydrates `/player` from it:

- `saved_servers`: current user's private rows from `player_saved_servers`, joined only to public-safe server display fields.
- `matched_communities`: cached Discord guild context for the current user, matched to public DZN server profiles where the existing OAuth/cache model supports it.
- `suggested_events`: public live/upcoming/registration event and tournament rows from `competitive_events`, without reading or applying paid-plan event access.
- `profile_entries`: private `/player` and `/player/profile` entry points for current and future profile/progression controls.
- `owner_setup`: a pricing-only CTA to `/pricing?intent=owner_setup&returnTo=%2Fsetup`.

The Player Hub now has a private ordinary-member bridge from Discord OAuth guild data. The older manageable/admin guild cache remains a compatibility fallback for setup-era sessions.

The Player Hub read model is `GET` only, returns private no-store responses, and must not write or alter billing, owner entitlement, Nitrado, server ownership, reviews, public discovery, rankings, badges, seasons, Server Wars, CTF scoring, XP awards, calling-card awards, event outcomes, or competitive eligibility.

### Broader Player-Community Matching Model

The ordinary-member matching slice adds `player_discord_community_memberships` as a private current-user bridge populated from the existing Discord OAuth `guilds` scope during login or explicit guild refresh.

- The bridge stores the current DZN user, Discord guild id, safe guild display name/icon, relationship (`member`, `administrator`, or `owner`), source, last-seen timestamp, and revocation timestamp.
- The bridge is private player context only. It is not a public member directory, not an owner/admin import table, and not a profile attribution table.
- Player Hub may read active rows for the current user and match them to public DZN server profiles through `linked_servers.guild_id`; unmatched memberships are not surfaced as a raw Discord guild list.
- Hidden, deleted, merged, or slugless server profiles stay hidden.
- Revoked or other-user membership rows must not appear.
- Public profile visibility and handles are not read or changed by this bridge.
- Owner setup, Nitrado linking, server ownership, Discord posting, moderation, billing, rankings, discovery, reviews, events, progression, and competitive eligibility remain isolated.

### Player Hub Community Matching UI Polish

The Player Hub matched-community panel should make the bridge understandable without exposing extra data or adding new workflows:

- Distinguish ordinary `Member`, `Admin`, and `Owner` relationship labels visually.
- Show relationship-specific copy that makes clear the match is private and presentation-only.
- Explain that a community match is not owner setup authority and does not unlock owner tools.
- Show only private matches that connect to public DZN server profiles; do not expose a raw Discord guild list.
- Provide source-aware empty states for unavailable matching, legacy manageable-guild fallback, and no public DZN matches.
- Keep the panel UI/read-only only: no setup action, no public directory, no profile opt-in bypass, no billing, no ranking/discovery/review/event/progression/scoring effect.

### Player Hub Discord Membership Refresh/Status UX

Players need a clear way to understand when DZN last checked their Discord community memberships and how to refresh the private Player Hub matching cache.

This slice adds a current-user-only refresh/status contract:

- `/api/player/hub` remains `GET` only and returns a private no-store `discord_membership_status` object with source, last checked timestamp when the private bridge has one, refresh href, method, and presentation-only/private flags.
- `/api/player/community-memberships/refresh` is a same-origin authenticated `POST` route.
- The refresh route uses the current user's saved Discord OAuth token, fetches `/users/@me/guilds`, and writes only `player_discord_community_memberships`.
- The refresh route must not return raw Discord guild lists, Discord permission bits, other-user data, hidden server data, owner entitlement data, or public profile visibility fields.
- The route may tell the current player to reconnect Discord if the saved token is missing, expired without a usable refresh token, or rejected by Discord.
- The route must not write `discord_guilds`; the older owner/setup guild cache remains owned by the existing `/api/discord/guilds?fresh=1` route.
- `/player` may show last checked copy, a refresh button, refresh progress, success, error, and reconnect states. It must reload the private Hub read model after a successful refresh.
- No production migration is required for this slice because `player_discord_community_memberships` already stores active memberships and `last_seen_at`.
- The refresh/status UI and route must not alter billing, owner entitlement, Nitrado, server ownership, rankings, discovery, reviews, events, progression, scoring, public profile visibility, retained exports, Store/payment state, live checkout, or competitive eligibility.

### Player Hub Suggested Event/Tournament Relevance Polish

This slice makes `/player` event suggestions more useful inside the private Player Hub read model:

- Prioritise public events connected to the player's privately followed servers.
- Prioritise public events connected to the player's privately matched Discord communities.
- Keep suggestions presentation-only with visible `Followed server`, `Matched community`, and `Public network` labels.
- Read a bounded set of public eligible events from `competitive_events`, then read only `competitive_event_servers` links that match the current player's followed or matched-community server ids.
- Derive private relevance from the current user's `player_saved_servers` rows and already-filtered matched-community server previews.
- Return private no-store relevance metadata only to the logged-in player; do not expose raw Discord guild ids through event suggestions.
- Do not write event registrations, owner workflow state, scoring rows, eligibility rows, billing, discovery formulas, rankings, reviews, progression, XP awards, calling-card awards, badges, seasons, Server Wars, CTF, or competitive eligibility.

### Player Hub Rendered QA/Release Polish

This slice proves the private `/player` experience in a browser before the next Player Hub product feature:

- Capture representative local/test desktop and mobile screenshots for followed servers, matched Discord communities, suggested events, relevance badges, profile entry points, empty states, unavailable states, and storage fallback states.
- Include a crowded-event case where many irrelevant registered servers do not hide the current player's followed-server or matched-community relevance labels.
- Keep the QA harness local and browser-intercepted with sanitized current-user JSON only.
- Do not write production D1, call Stripe, mutate Cloudflare secrets/config, call Nitrado or Discord runtime APIs, send chat messages, add reactions, report/moderate, call DZN Assist AI, use Durable Objects/WebSockets, change retained exports, deploy, enable live checkout, or change issue `#49`.
- Prove the rendered Player Hub remains private, presentation-only, and isolated from billing, owner entitlement, server ownership, scoring, ranking, discovery, reviews, progression, XP awards, calling-card awards, badges, seasons, Server Wars, CTF, and competitive eligibility.

## Reviews Roadmap

Reviews are free logged-in player actions:

- Players can submit/read reviews where allowed.
- Owners can reply and report from owner/admin tools.
- Admin/owner moderation queues, notification badges, read/unread state, bulk triage, status history, and delivery polish are separate slices.
- Review state must not alter paid plans, rankings, discovery score, badges, seasons, events, Server Wars scoring, XP, calling cards, or competitive eligibility.

## Progression Roadmap

Challenges, XP, and calling cards are earned player-side systems:

- Players can participate in challenges for profile progress.
- Trusted server-side award rules/jobs grant XP and calling cards from verified activity sources only.
- ADM gameplay imports, event participation, and approved community activity can become verified sources after adapter/audit slices.
- Players cannot self-award progression.
- Paid plans cannot influence earned progression, rankings, discovery, reviews, badges, seasons, events, Server Wars, CTF, XP awards, calling-card awards, or competitive eligibility.

## Public Profiles Roadmap

Public profiles must respect saved privacy preferences:

- Public profile routes/APIs show only approved sections.
- Hidden sections, private identifiers, and raw award evidence stay private.
- Public profile links are opt-in and only shown where a generated public handle exists.
- Attribution is presentation-only across review author rows, player-safe challenge/member rows, leaderboard/player mentions, public-safe community directories, and non-scoring member rows.
- CTF scoring rows, owner workflow rows, approval decisions, bracket outcomes, and competitive systems stay isolated unless a dedicated proof slice allows presentation-only linking.

## Community Member Roadmap

Community member directories are public-safe and read-only:

- A unique trusted DZN user bridge is required before profile attribution.
- Hidden players remain private.
- Owner/admin import controls are separate from public directory presentation.
- Import previews, candidate review, duplicate/ambiguous rejection, audit history, notifications, bulk actions, and export-safe audit views are owner/admin-only.
- Retained exports remain blocked unless a dedicated approval issue/PR defines approval authority, migration shape, expiry model, private storage plan, security review, rollback, and proof requirements.

## DZN Comms And Support Roadmap

DZN Comms is a future site-wide support and community communication system:

- Site-wide support launcher available across major pages.
- Logged-in global player chat.
- Private group chat.
- Public-DZN-info-only AI support bot for website/setup help.
- Profanity filtering, warnings, timed timeouts, report actions, moderation hooks, owner/admin scope, retention rules, and rollback controls.
- Public-safe aggregate online counter may appear on `/community` or global chat surfaces behind disabled-by-default flags.

Do not implement runtime chat routes, sending, message persistence, reaction persistence, reports, moderation mutations, Durable Objects/WebSockets, AI provider credentials, vector stores, analytics/tracking, metered model calls, or production mutations until each part has its own approval slice.

## Store And Safe Monetisation Roadmap

The safe monetisation direction supersedes any paid-spin idea:

- Players must never buy spins directly or indirectly.
- Spins are earned only through legitimate website activity.
- Wheel runtime must enforce server-side rolling limits, cooldowns, guaranteed non-cash rewards, complete probabilities, no fake near-misses, and an auditable spin ledger.
- One-off DZN Store purchases can sell guaranteed account-bound digital cosmetics only.
- The DZN Founding Supporter Pack is a one-time account-bound supporter product with a permanent serialised Supporter Card, profile badge/frame, optional chat badge, and no competitive/gameplay advantage.
- Store payment work must use existing payment architecture, signed Stripe webhook verification, idempotent fulfilment, duplicate-event protection, refund/chargeback rollback, tax/receipt-compatible records, admin pricing controls, and no card data storage in DZN.

Store runtime remains disabled until deliberately approved. Store work must not enable live checkout, mutate Stripe Products/Prices, mutate Cloudflare secrets/config, write production D1, mint earned spins, run the wheel, or change issue `#49` without explicit approval.

## Fair Progression Boundary

The following must remain independent from paid plans, private saved/followed state, profile visibility, public profile attribution, Store purchases, Supporter status, chat participation, and community imports/exports:

- Server rankings and discovery scores.
- Player rankings.
- Kills, deaths, K/D, longest kill, activity formulas, and standings.
- Review scores and review visibility.
- Badges, seasons, crowns, and earned recognition.
- Event outcomes, brackets, CTF scoring, and Server Wars scoring.
- XP awards and calling-card awards.
- Competitive eligibility.

## Current Implementation Slices

Completed or active foundation slices:

- Player vs Owner Access Foundation: free player access separated from owner/billing gates.
- Dedicated pricing page: full payment content moved away from the homepage.
- Player navigation access polish: `/player`, `/player/profile`, and logged-in Player Hub navigation.
- Saved/followed server interaction foundation: private player saved-server actions behind `player_saved_servers`.
- Player Hub real-data foundation: private read-only hub payload plus `/player` panels for followed/saved servers, matched cached Discord communities, public event/tournament suggestions, and profile entry points while keeping owner setup behind `/pricing` and entitlement gates.
- Broader player-community matching model: private ordinary-member Discord membership bridge for Player Hub community matching.
- Player Hub community matching UI polish: clearer private matched-community cards, relationship badges, source-aware empty states, and presentation-only boundary copy.
- Player Hub Discord membership refresh/status UX: current-user-only refresh button/status copy backed by a same-origin player membership refresh route, without owner guild-cache, payment, profile-publication, analytics, production migration, or competitive-system changes.
- Shared header command bar visual polish: DZN command-deck styling for the root header, animated corner logo preserved, icon-based nav/action controls, hover/focus highlighting, and bright red DZN Pulse unread badges; visual only with no payment, Store, chat runtime, production, or competitive-system changes.
- Player Hub suggested event/tournament relevance polish: private no-store suggestions now prioritise public events connected to followed servers and matched-community server previews, with presentation-only labels and no event registration, scoring, eligibility, billing, owner workflow, progression, review, ranking, discovery, or competitive-system changes.
- Player Hub event relevance query cap fix: private relevance server-link reads are now filtered to the current player's followed or matched-community server ids so crowded event registrations cannot hide a relevant match.
- Player Hub rendered QA/release polish: local browser artifact captures representative saved-server, matched-community, crowded-event, empty, unavailable, and storage-fallback states before the next Player Hub product feature.

Next recommended product slice after Player Hub rendered QA:

- Player Hub profile/progression entry-point real-data polish: make the private `/player` entry points more useful by surfacing safe current-user profile/progression summaries and next actions while keeping visibility, awards, billing, scoring, rankings, reviews, events, Server Wars, CTF, and competitive eligibility isolated.
