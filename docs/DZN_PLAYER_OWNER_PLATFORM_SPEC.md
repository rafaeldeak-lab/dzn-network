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

## Global / Group Chat And Support Bot Roadmap

DZN should eventually include chat as a community/support layer, not as a competitive or billing system.

The DZN Chat And Support Architecture Preflight Slice is captured in `docs/DZN_CHAT_SUPPORT_ARCHITECTURE_PREFLIGHT.md`. That document is the required design contract before any runtime chat or support bot implementation begins.

Future chat surfaces should include:

- A site-wide support chat available from most pages for setup help, account guidance, and public DZN feature questions.
- A global community chat for logged-in DZN players.
- Private group chat for approved communities, teams, event groups, or server-linked groups where the membership bridge is trusted.
- An automated support bot that can answer only from public DZN website content, setup/help copy, product documentation, public pricing copy, and public support policy.
- Clear escalation or fallback messaging when the bot cannot answer from approved public DZN information.
- Profanity filtering, warning, and timed-mute controls, plus timeout, report, and moderation hooks for community chat.
- Admin/owner moderation review surfaces for abuse handling, with cross-owner boundaries where chats are server/community scoped.

Rules:

- Chat must be logged-in for player/community participation, while support entry points may appear on public pages.
- Private group membership must come from a trusted DZN user/community/server bridge, not display-name matching.
- Moderation actions must be auditable, scoped, and reversible where practical.
- The AI support bot must not answer from private player data, private owner data, raw Discord IDs, Nitrado tokens, billing secrets, production D1 internals, retained export artifacts, raw award evidence, or hidden profile sections.
- The bot must not create checkout sessions, mutate billing, change owner entitlements, call Nitrado, mutate Discord resources, award XP/calling cards, change rankings, alter reviews, alter events, change Server Wars/CTF scoring, or affect competitive eligibility.
- No AI provider credential, paid API key, metered model call, vector store, training/eval job, or automated spend path may be added until a dedicated support-bot architecture slice explicitly approves the provider, cost controls, data boundary, prompt/source policy, abuse controls, logging policy, and rollback plan.

This roadmap item is now a design-only preflight. No runtime chat routes, support bot runtime, Durable Objects/WebSockets, moderation tables, bot prompts, vector stores, AI provider credentials, or metered model calls are implemented by this slice.

## DZN Chat And Support Architecture Preflight Slice

The DZN chat/support architecture preflight designs DZN Comms before implementation. It records the user-provided visual direction as non-executable product reference: a dark DZN command-center layout with Public Channels, Global Chat, New Players, Server Owners, Events, Private Groups, pinned guidance, DZN Assist, online members, group members, Channel Safety, and a visible Safety Ladder.

The preflight defines these future surfaces:

- Site-wide support chat: a compact DZN Assist support entry point that may be visible on most pages, with logged-out answers limited to public DZN/help content and account-specific help requiring login.
- logged-in global community chat: a free player feature after Discord login.
- Private group chat: invite-only or trusted-membership groups tied to community, team, event, or server bridges.
- Server-linked group management: an owner/admin management action that must pass the canonical owner entitlement boundary plus linked-server ownership or admin scope before implementation.
- Moderation surfaces: owner/admin scoped review of reports, warnings, timed mutes/timeouts, blocks, appeals, and staff-review queues.

Normal player chat access must remain free after Discord login. Starter and Pro plans must not give chat ranking priority, moderation immunity, scoring advantages, event advantages, XP advantages, badge advantages, or competitive eligibility advantages.

The preflight safety model requires:

- Profanity filter.
- Spam protection.
- Link protection.
- Invite approval for private groups.
- Rate limits and slow mode.
- Report message controls.
- Blocked-message feedback before publishing where practical.
- Friendly warning for low-severity first violations.
- Timed mute/timeout for repeated violations.
- Staff review for severe or repeated abuse.
- Scoped, reversible moderation audit where practical.

The safety ladder is:

1. Message blocked.
2. Friendly warning.
3. 10-minute timeout.
4. Staff review.

The public-DZN-info-only AI support bot is bounded to public DZN website content, setup-help content, pricing content, and public support policy. It must not use private player data, private owner data, hidden profile sections, raw Discord IDs, Discord OAuth tokens, Nitrado tokens, billing secrets, Stripe state, production D1 internals, retained export artifacts, raw award evidence, internal moderation notes, or private chat history outside the active support session.

The bot must not create checkout sessions, change billing, change owner entitlements, call Nitrado, mutate Discord resources, award XP, award calling cards, change rankings, change discovery score, change reviews or review score, change events/brackets/rosters/approvals, change Server Wars or CTF scoring, or affect competitive eligibility.

No migration is added in this slice. Future chat tables, support-session tables, Durable Object/WebSocket bindings, provider configuration, prompt registry, vector store, source index, analytics/tracking path, or stored support/chat history remain blocked until a later approved implementation slice.

The next implementation-safe step is a DZN Comms visual shell and support launcher prototype using static local mock data, disabled/non-sending composer states, and no runtime message storage or bot calls.

## DZN Comms Visual Shell Prototype Slice

The DZN Comms Visual Shell Prototype Slice may add a static `/community` visual route and a site-wide static DZN Assist support launcher. It exists to make the approved DZN Comms direction visible before any real chat system is built.

Allowed behavior:

- Use static local mock data only.
- Show Global Chat, New Players, Server Owners, Events, Private Groups, DZN Assist, Channel Safety, Online Members, Group Members, and Safety Ladder panels.
- Show disabled/non-sending composer controls that clearly state no messages are sent or stored.
- Mount a static support launcher on most pages with Website support only copy, disabled support input, and a link to the static DZN Comms route.
- Add Community to authenticated player navigation as a free player/community surface.

Blocked behavior:

- No runtime chat APIs.
- No support bot APIs.
- No Durable Objects/WebSockets.
- No message persistence.
- No moderation tables.
- No bot prompts.
- No vector stores.
- No AI provider credentials.
- No metered model calls.
- No analytics/tracking.
- No live checkout changes.
- No production service mutation.

The visual shell cannot affect billing, scoring, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars, CTF scoring, XP awards, calling-card awards, or competitive eligibility. Live checkout remains disabled and Issue #49 remains reserved for final live payment activation.

Next should be the DZN Comms interaction contract and moderation preflight before any sending, persistence, real-time transport, moderation database, support bot runtime, vector search, AI provider, or metered model work begins.

## DZN Comms Interaction Contract And Moderation Preflight

The DZN Comms Interaction Contract And Moderation Preflight Slice is documented in `docs/DZN_COMMS_INTERACTION_CONTRACT_PREFLIGHT.md`. It is the contract layer between the static visual shell and any future runtime implementation.

Allowed behavior:

- Define future client/server contracts for send attempts, filtering decisions, warning/timeout state, read-only history, message reports, owner/admin moderation scope, private group membership proofs, support source policy, logging, retention, and rollback.
- Record the future send attempt shape with `clientMutationId`, server-resolved channel scope, trusted membership checks, moderation checks before persistence, and explicit accepted/blocked/warning/timeout/rate-limited/muted/unauthenticated/forbidden responses.
- Require private group membership through a trusted DZN user ID bridge, not Discord display names, gamertags, review names, leaderboard names, profile handles alone, request-supplied IDs, or imported unresolved candidates.
- Require owner/community moderation actions to pass canonical owner entitlement plus linked-server ownership for owner-managed scopes, while DZN admins retain separately configured global moderation scope.
- Keep DZN Assist limited to public DZN website content, setup-help content, pricing content, public support policy, public event guides, and public feature documentation until a later approved support-bot implementation defines provider, cost, source, retention, refusal, and rollback controls.
- Define design-only future kill-switch names without adding them to production configuration.

Blocked behavior:

- No runtime chat APIs.
- No message tables.
- No chat message database migrations.
- No Durable Objects/WebSockets.
- No moderation tables.
- No bot prompts.
- No vector stores.
- No AI provider credentials.
- No metered model calls.
- No analytics/tracking.
- No stored support/chat history.
- No live checkout changes.
- No production service mutation.

Free logged-in players can participate in allowed DZN Comms player/community chat without Starter or Pro. Starter and Pro must not grant chat priority, moderation immunity, safety bypasses, scoring advantages, event advantages, XP advantages, calling-card advantages, badge advantages, Server Wars advantages, CTF advantages, ranking boosts, discovery boosts, review boosts, or competitive eligibility advantages.

Warnings, timeouts, mutes, reports, moderation status, private group visibility, DZN Assist support state, and future chat history must not affect billing, owner entitlements, server ownership, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars, CTF scoring, XP awards, calling-card awards, public profile visibility, retained exports, or competitive eligibility.

Next should be the DZN Comms runtime implementation approval preflight before any chat APIs, message tables, Durable Objects/WebSockets, AI provider credentials, vector stores, or metered model calls are implemented.

## DZN Comms Runtime Implementation Approval Preflight

The DZN Comms Runtime Implementation Approval Preflight Slice is documented in `docs/DZN_COMMS_RUNTIME_IMPLEMENTATION_APPROVAL_PREFLIGHT.md`. It chooses the first real runtime slice shape before implementation begins.

Approved first runtime direction:

- Start with the DZN Comms live presence counter foundation, not chat message sending.
- Add a future public-safe aggregate "DZN online" counter that can show how many active page sessions are currently on DZN.
- Prefer the first placement on `/community` or the Global Chat shell because the static DZN Comms UI already has the visual context.
- Allow a later polish slice to show the same small counter in the shared site header or major public/player pages only after the privacy, retention, and fallback proof is complete.
- Treat the counter as presence, not analytics.
- Use short-lived server-owned presence state with automatic expiry.
- Return only aggregate counts and safe fallback copy.

Blocked behavior:

- No runtime chat APIs in this preflight.
- No support chat APIs in this preflight.
- No presence APIs in this preflight.
- No live visitor counter APIs in this preflight.
- No message tables.
- No presence tables.
- No database migrations.
- No Durable Objects/WebSockets.
- No moderation tables.
- No AI provider credentials.
- No vector stores.
- No metered model calls.
- No analytics/tracking.
- No live checkout changes.
- No production service mutation.

The future counter must not store browsing history, route history, user journeys, marketing events, tracking events, referrers, IP addresses, user agents, Discord identifiers, raw DZN user IDs, profile handles, billing state, owner entitlement, Nitrado identifiers, review identifiers, event identifiers, challenge identifiers, or competitive identifiers.

The future counter must not affect billing, owner entitlement, server ownership, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars, CTF scoring, XP awards, calling-card awards, public profile visibility, retained exports, moderation decisions, or competitive eligibility.

Next should be the DZN Comms live presence counter foundation: implement the first public-safe aggregate online counter behind disabled-by-default read/write flags, starting on `/community` or the Global Chat shell with a static fallback, short TTL, no identifying public output, no analytics/tracking, no chat message sending, no message persistence, no moderation tables, no Durable Objects/WebSockets unless separately approved in that slice, no AI provider credentials, no vector stores, no metered model calls, no live checkout, no production mutations, and no effect on competitive or billing systems.

## DZN Safe Monetisation And Supporter System Backlog

The durable backlog contract for safe monetisation is `docs/DZN_SAFE_MONETISATION_SUPPORTER_SYSTEM_BACKLOG.md`.

This decision supersedes the earlier paid-spin idea. DZN may add a real production Store and Supporter System later, but the Fair Progression Boundary controls it:

- Players must never be able to buy spins with real money, credits bought with money, Supporter Packs, subscriptions, or indirect bundles.
- Spins may only be earned from legitimate website activity such as daily activity, challenges, community missions, events, account milestones, and occasional free promotional awards.
- Wheel limits must be enforced server-side: maximum three total spins in any rolling 24-hour period and a minimum four-hour cooldown between spins.
- Purchases must never bypass spin limits, cooldowns, or reward odds.
- Every spin must produce a reward; there are no empty, failed, or lost spins.
- The full reward pool and probabilities must be displayed.
- Rewards must be account-bound, non-cash, non-transferable, non-tradeable, non-resellable, and non-redeemable.
- The wheel must not use fake near-misses, jackpots, spending prompts, or spin-again pressure.
- Spin results must be generated and recorded server-side in an auditable ledger containing player, source, outcome, and timestamp.

The one-off DZN Store may sell guaranteed digital items such as Supporter Packs, profile theme packs, calling-card packs, chat/profile cosmetic packs, group banner and insignia packs, and event presentation themes. Every product must show exactly what the customer receives before payment and must never provide XP, ranking advantages, better reward odds, additional spins, tournament advantages, review or discovery advantages, Server War scoring advantages, or competitive eligibility.

The planned first supporter product is `DZN FOUNDING SUPPORTER PACK`. It is not a charitable donation; it is a supporter purchase that helps fund DZN development. The price must be administrator-configurable, with a possible later pay-what-you-want option above a defined minimum. It includes one permanent unique DZN Supporter Card with a serial such as `DZN-SUP-002481`, player display name, Supporter Since date, pre-payment card theme choice, generated insignia/detailing, permanent Supporter profile badge, optional Supporter chat badge, Supporter profile frame, public badge hiding, and no competitive or gameplay advantages. Supporter Cards are one per qualifying account, permanent for the life of the account and service, recoverable for the same owner, protected against duplicate serials, non-transferable, non-tradeable, non-resellable, non-redeemable, revoked on refund/reversal/chargeback, and not split into artificial rarity tiers by payment amount.

Future payment implementation must use the existing payment provider and architecture. If Stripe remains configured, one-time Stripe Checkout Sessions are expected. Fulfilment must be webhook-verified and idempotent; success-page redirects must never grant entitlements by themselves. The future production feature needs signed webhook verification, duplicate-event protection, order and entitlement ledgers, refund/chargeback handling, tax/VAT-compatible records, clear purchase/refund terms, admin-configurable availability/pricing, and no storage of card information in DZN.

Suggested future entities are `products`, `prices`, `orders`, `order_items`, `payment_events`, `account_entitlements`, `supporter_cards`, `earned_spins`, `spin_ledger`, and `wheel_cooldowns`.

This backlog item is not implemented by the DZN Comms live presence counter foundation. No store route, checkout route, webhook route, product table, order table, entitlement table, supporter card, spin ledger, price change, Stripe product mutation, Cloudflare secret change, production D1 write, live checkout activation, or issue #49 merge is part of the presence-counter slice.

## DZN Comms Live Presence Counter Foundation Slice

The DZN Comms live presence counter foundation implements only the approved public-safe aggregate counter. It starts on `/community` and the Global Chat shell, behind disabled-by-default read/write flags:

- `DZN_COMMS_PUBLIC_ONLINE_COUNTER_ENABLED`
- `DZN_COMMS_PRESENCE_READ_ENABLED`
- `DZN_COMMS_PRESENCE_WRITE_ENABLED`
- `NEXT_PUBLIC_DZN_COMMS_PUBLIC_ONLINE_COUNTER_ENABLED`

When the flags are not enabled, the UI shows the existing static fallback counts and does not start runtime heartbeat requests from the client. When enabled in a later environment, the client may send a bounded heartbeat to `/api/dzn-comms/presence`, and the public response remains aggregate-only.

The counter stores only a hashed short-lived presence-session key, normalized scope, first seen time, last seen time, and expiry in `dzn_comms_presence_sessions`. It does not store names, Discord IDs, DZN user IDs, profile handles, IP addresses, user agents, referrers, routes, page history, journey history, billing state, owner entitlement, server ownership, Nitrado identifiers, review identifiers, event identifiers, challenge identifiers, scoring identifiers, or competitive identifiers.

The API exposes:

- `GET /api/dzn-comms/presence?scope=site|community|global_chat` for public aggregate read when read flags are enabled.
- `POST /api/dzn-comms/presence?scope=site|community|global_chat` for a short-lived heartbeat when write flags are enabled.

The client cannot set the displayed count. Invalid scopes fall back to `community`. Stale rows expire by TTL filtering and write-side cleanup. The response is no-store JSON with `label: "DZN online"`, `onlineCount`, `precision`, `updatedAt`, `ttlSeconds`, and status. It is presence, not analytics.

This slice still does not implement message sending, message persistence, message history, private group messages, reports, moderation mutations, DZN Assist AI runtime, bot prompts, vector stores, AI provider credentials, metered model calls, analytics/tracking events, retained exports, live checkout changes, or production service mutations.

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
15. DZN Safe Monetisation and Supporter System: real production Store and supporter purchases in later approved payment slices, with earned-only spins, guaranteed account-bound cosmetics/supporter items, idempotent provider-webhook fulfilment, refund/chargeback handling, and no competitive advantage.
16. Global/group chat and support bot architecture preflight: delivered as a design-only slice covering site-wide support chat, global player chat, private group chat, moderation/profanity warning/timeouts, and AI support limited to public DZN/help content only, with explicit zero-surprise spend and data-boundary review before any provider wiring.
17. DZN Comms visual shell and support launcher prototype: approved as a static local mock-data UI slice with a disabled/non-sending composer, DZN Comms layout, site-wide support launcher, authenticated Community nav, and no runtime chat APIs, Durable Objects/WebSockets, moderation tables, bot prompts, vector stores, AI provider credentials, metered calls, analytics/tracking, or message persistence.
18. DZN Comms interaction contract and moderation preflight: delivered as a design-only slice defining send/filter/warning/timeout/history/report/moderation/private-group/support-source/logging/retention/rollback contracts before any real chat runtime is implemented.
19. DZN Comms runtime implementation approval preflight: delivered as a design-only slice choosing the first runtime direction, transport plan, migration choices, feature-flag defaults, retention defaults, moderation separation, testing matrix, rollback path, and public-safe live website counter contract before implementing APIs, message tables, Durable Objects/WebSockets, AI provider credentials, vector stores, or metered model calls.
20. DZN Comms live presence counter foundation: delivered as the first runtime slice with a public-safe aggregate online counter behind disabled-by-default read/write flags, starting on `/community` and the Global Chat shell with a static fallback, short TTL, no identifying public output, no analytics/tracking, and no influence on billing, owner entitlement, rankings, discovery, reviews, badges, seasons, events, Server Wars, CTF scoring, XP, calling-card awards, public profile visibility, retained exports, moderation decisions, or competitive eligibility.
21. DZN Safe Monetisation and Supporter System implementation preflight: define the store/catalog/order/payment/spin-ledger/supporter-card implementation sequence, migrations, webhook safety, refund/chargeback handling, tax/receipt records, admin pricing controls, rollback, and security proof before any one-time Stripe Checkout Sessions, store routes, webhook fulfilment, supporter cards, earned-spin ledgers, or account entitlement writes are implemented.
22. Issue #49 live checkout activation: only after sandbox evidence, readiness review, production configuration review, migration safety, and explicit approval.

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

## Community Member Import Audit-History Polish Slice

The community member import audit-history polish slice improves owner/admin visibility into bulk execution and source audit history without changing the source-management write model. It remains a private presentation-workflow improvement over the existing `community_member_candidates`, `community_member_source_audit`, `community_member_source_snapshots`, `community_members`, and `user_notifications` controls.

The slice adds:

- Per-candidate execution summaries on `bulkActOnCommunityMemberCandidates`, returned as `execution_summaries` for bulk partial success and full success.
- A bulk `summary` object that reports requested, processed, imported, rejected, blocked, failed, and partial-success counts.
- `audit_action` and `audit_result` read filters on `GET /api/owner/community-members`.
- Filterable bulk action audit grouping through `audit_groups`, derived from already-scoped audit rows by linked server, action, result, and execution window.
- An `export_safe_audit` view for owner/admin audit exports that omits raw actor user IDs, raw Discord IDs, raw community guild IDs, raw linked-server IDs, and raw DZN user IDs.
- Dashboard UI for bulk action summaries, audit action/result filters, grouped audit cards, and the export-safe owner/admin audit view.

Authorization and source rules:

- Normal owners must still pass the canonical owner entitlement boundary and may manage only their own linked servers.
- Configured DZN admins may still review global candidate source rows.
- Audit filters are applied only after the same owner/admin scope rules.
- Bulk action summaries are created from the server-side result for each selected row, not from browser trust.
- Export-safe audit rows are a sanitized view of private owner/admin audit rows; they are not a new public API and they do not widen source-management access.

Still excluded:

- Public profile visibility without the player's opt-in generated handle.
- Public profile handle creation, profile privacy updates, or player-owned display preference changes.
- CTF scoring rows, owner workflow decisions, approval decisions, bracket outcomes, event eligibility, scoring feeds, and accepted audit feeds.
- Billing, plan status, owner entitlement mutation, rankings, discovery score, reviews, review score, badges, seasons, Server Wars scoring, XP awards, calling-card awards, and competitive eligibility.
- Stripe checkout activation, Stripe product/price changes, Cloudflare secret changes, production D1 writes, Nitrado calls, Discord resource mutation, and issue #49.

Mutation scope:

- This slice may read the existing owner/admin community member source-management tables and private `user_notifications` counts.
- This slice may continue the existing selected-row import/reject writes to `community_member_candidates`, `community_member_source_audit`, and imported `community_members` rows through the canonical single-candidate action path.
- This slice does not add a migration or new tables.
- It must not add checkout sessions, profile handle generation, profile privacy updates, billing updates, server ownership changes, ranking updates, discovery score updates, review rating changes, event mutations, roster mutations, CTF scoring changes, badge awards, season changes, Server Wars score/result changes, XP awards, calling-card awards, Nitrado calls, Discord bot messages, Cloudflare secret changes, production D1 writes, live checkout activation, or issue #49 changes.

Fairness remains unchanged: per-candidate execution summaries, filterable bulk action audit grouping, and export-safe audit views are owner/admin presentation aids only. They cannot make a player publicly visible without the player's opt-in generated handle and must not affect CTF scoring rows, owner workflow decisions, approval decisions, bracket outcomes, billing, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility.

## Community Member Import Export Workflow Polish Slice

The community member import export workflow polish slice adds a bounded downloadable export action for the existing export-safe owner/admin audit rows. It is a private artifact workflow only; it does not add a public export surface, a new scoring input, or any source-management mutation path.

The slice adds:

- `exportCommunityMemberSourceAudit` as the server-side CSV export helper.
- `GET /api/owner/community-members/export` as the private owner/admin CSV attachment route.
- `date_from` and `date_to` filters for export date boundaries, accepting `YYYY-MM-DD` or valid ISO date/time input.
- `audit_action`, `audit_result`, `linked_server_id`, and bounded `limit` filters on the export request.
- Dashboard controls for `Export from`, `Export to`, `Export rows`, and `Download audit CSV`.
- Stable export-safe references for downloadable rows, generated from sanitized refs rather than raw actor, server, community, candidate, member, Discord, or DZN user IDs.
- Response metadata headers for row count, row limit, truncation, and export-safe status.

Authorization and export rules:

- Logged-out visitors and free logged-in players cannot download community member import audit exports.
- Normal owners must still pass the canonical owner entitlement boundary.
- Normal owners may export only already-scoped audit rows tied to their own linked servers.
- Configured DZN admins may export the admin-scoped source audit queue.
- Export date/action/result filters are applied after owner/admin scope.
- Export downloads are server-bounded; the route fetches one extra row only to report whether the export was truncated.
- CSV rows are built only from `export_safe_audit` data, not detailed private audit rows.

Still excluded:

- Public profile visibility without the player's opt-in generated handle.
- Public profile handle creation, profile privacy updates, or player-owned display preference changes.
- CTF scoring rows, owner workflow decisions, approval decisions, bracket outcomes, event eligibility, scoring feeds, and accepted audit feeds.
- Billing, plan status, owner entitlement mutation, rankings, discovery score, reviews, review score, badges, seasons, Server Wars scoring, XP awards, calling-card awards, and competitive eligibility.
- Stripe checkout activation, Stripe product/price changes, Cloudflare secret changes, production D1 writes, Nitrado calls, Discord resource mutation, and issue #49.

Mutation scope:

- This slice may read the existing owner/admin community member source audit rows through the canonical scoped helper.
- This slice may generate a private CSV `Response` for the authenticated owner/admin.
- This slice does not add a migration or new table.
- This slice does not add new database writes.
- It must not add checkout sessions, profile handle generation, profile privacy updates, billing updates, server ownership changes, ranking updates, discovery score updates, review rating changes, event mutations, roster mutations, CTF scoring changes, badge awards, season changes, Server Wars score/result changes, XP awards, calling-card awards, Nitrado calls, Discord bot messages, Cloudflare secret changes, production D1 writes, live checkout activation, or issue #49 changes.

Fairness remains unchanged: bounded downloadable audit exports, date/action/result filters, and export-safe CSV rows are private owner/admin artifacts only. They cannot make a player publicly visible without the player's opt-in generated handle and must not affect CTF scoring rows, owner workflow decisions, approval decisions, bracket outcomes, billing, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility.

## Community Member Export UX and Retention Controls Slice

The community member export UX and retention controls slice makes the private export workflow clearer inside the owner/admin dashboard without turning exports into a new persisted data model. It keeps the CSV route private, bounded, and download-only by default.

The slice adds:

- A visible private export panel in the owner/admin community member dashboard.
- Client-session-only recent export history that shows when a download was generated.
- Filter chips showing the community, action, result, date range, and row limit used for the downloaded file.
- A clear local-history control for removing the in-dashboard export history affordance.
- Export response metadata headers for `x-dzn-export-generated-at`, `x-dzn-export-artifact`, `x-dzn-export-retention`, `x-dzn-export-persisted-by-dzn`, and `x-dzn-export-dashboard-history`.
- Safeguards for client-only export history, non-persistent default export retention, private artifact notice, and export retention controls.

Authorization and retention rules:

- Logged-out visitors and free logged-in players still cannot download community member import audit exports.
- Normal owners must still pass the canonical owner entitlement boundary.
- Normal owners may view recent export history only in their current dashboard session and only for downloads they triggered in that view.
- Configured DZN admins may use the same client-session-only history affordance for the admin-scoped queue.
- The dashboard history is not written to D1, localStorage, sessionStorage, IndexedDB, cookies, billing tables, profile tables, or source-management audit tables.
- The downloaded file is a private owner/admin artifact and is non-persistent by default.
- DZN still keeps the underlying source audit rows, but does not create a separate stored export file or export-history record by default.

Still excluded:

- Persistent export archive/storage, export sharing links, public export routes, and player-visible export records.
- Public profile visibility without the player's opt-in generated handle.
- Public profile handle creation, profile privacy updates, or player-owned display preference changes.
- CTF scoring rows, owner workflow decisions, approval decisions, bracket outcomes, event eligibility, scoring feeds, and accepted audit feeds.
- Billing, plan status, owner entitlement mutation, rankings, discovery score, reviews, review score, badges, seasons, Server Wars scoring, XP awards, calling-card awards, and competitive eligibility.
- Stripe checkout activation, Stripe product/price changes, Cloudflare secret changes, production D1 writes, Nitrado calls, Discord resource mutation, and issue #49.

Mutation scope:

- This slice may read already-scoped source audit rows through `/api/owner/community-members/export`.
- This slice may download a private CSV response for the authenticated owner/admin.
- This slice may keep up to five recent export metadata records in React component state for the current dashboard session.
- This slice does not add a migration, new database table, new database write, browser storage write, export storage bucket, or public export artifact.

Fairness remains unchanged: client-session-only recent export history, filter affordances, private-artifact notices, and download-only retention controls are owner/admin presentation aids only. They cannot make a player publicly visible without the player's opt-in generated handle and must not affect CTF scoring rows, owner workflow decisions, approval decisions, bracket outcomes, billing, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility.

## Community Member Export Policy and Optional Retention Settings Slice

The community member export policy and optional retention settings slice makes export-handling rules visible to owners/admins without enabling persistent export retention. The current product behavior remains private, bounded, download-only, and non-persistent by default.

The slice adds:

- An owner/admin-visible export policy surface in the community member source dashboard.
- Server-declared `export_policy` metadata alongside the existing export-safe audit read model.
- Download response headers for `x-dzn-export-policy`, `x-dzn-export-persistent-retention`, `x-dzn-export-retention-expiry-required-if-approved`, and `x-dzn-export-retention-audit-required-if-approved`.
- A visible `Optional retention settings` panel that shows persistent retention is disabled.
- A clear statement that any persistent export-retention model requires explicit approval before schema, storage, or sharing-link work.
- Requirements for that future model, if approved: owner/admin scope, expiry on every retained export, actor/scope/filter/result audit controls, export-safe rows only, and no raw Discord/user/server/guild identifiers.

Current export policy:

- Only signed-in owners with entitlement or configured DZN admins can request community member audit exports.
- Owner/admin scope is applied before community, action, result, date, and row-limit filters.
- Downloads remain capped by the server-side export limit.
- Downloaded CSV files are private owner/admin artifacts.
- Dashboard recent export history remains client-session-only and bounded.
- DZN does not persist export files, export sharing links, or export-history records by default.

Persistent export retention remains disabled. This slice does not add an export-retention migration, stored export file, export-history table, sharing link, browser persistence, retention setting write API, or retention setting save button.

Still excluded:

- Persistent export archive/storage without explicit approval.
- Public export routes or player-visible export records.
- Public profile visibility without the player's opt-in generated handle.
- Public profile handle creation, profile privacy updates, or player-owned display preference changes.
- CTF scoring rows, owner workflow decisions, approval decisions, bracket outcomes, event eligibility, scoring feeds, and accepted audit feeds.
- Billing, plan status, owner entitlement mutation, rankings, discovery score, reviews, review score, badges, seasons, Server Wars scoring, XP awards, calling-card awards, and competitive eligibility.
- Stripe checkout activation, Stripe product/price changes, Cloudflare secret changes, production D1 writes, Nitrado calls, Discord resource mutation, and issue #49.

Fairness remains unchanged: the owner/admin-visible export policy surface, optional retention settings display, disabled persistent-retention state, and future-model requirements are presentation and governance aids only. They cannot make a player publicly visible without the player's opt-in generated handle and must not affect CTF scoring rows, owner workflow decisions, approval decisions, bracket outcomes, billing, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility.

## Community Member Export Policy Review and Admin Guardrails Slice

The community member export policy review and admin guardrails slice adds an admin-only governance affordance for confirming the current export defaults across all owner scopes. It does not approve or implement retained exports. The current export behavior remains private, bounded, download-only, and non-persistent by default.

The slice adds:

- Server-declared `export_policy_review` metadata on the owner/admin source-management payload, returned only when the authenticated actor is a configured DZN admin.
- An admin-only policy review panel in the community member source dashboard.
- A clear `Current defaults confirmed` summary covering all owner scopes.
- A clear `Future retained-export work blocked` summary.
- Guardrail checks that future retained-export work remains blocked until a dedicated approval, migration, expiry model, storage plan, and security review exist.

Current export defaults confirmed by the admin-only policy review:

- `current_retention_mode = download_only`.
- `persisted_exports_enabled = false`.
- `export_file_retention = not_persisted_by_dzn`.
- `dashboard_history = client_session_only`.
- `sharing_links_enabled = false`.
- `browser_persistence_enabled = false`.

Future retained-export work remains blocked until all of the following exist:

- Dedicated approval required.
- Migration required.
- Expiry model required.
- Storage plan required.
- Security review required.

Still excluded:

- Persistent export archive/storage, export-history tables, export sharing links, browser persistence, retention setting write APIs, retention setting save buttons, and player-visible export records.
- Public profile visibility without the player's opt-in generated handle.
- Public profile handle creation, profile privacy updates, or player-owned display preference changes.
- CTF scoring rows, owner workflow decisions, approval decisions, bracket outcomes, event eligibility, scoring feeds, and accepted audit feeds.
- Billing, plan status, owner entitlement mutation, rankings, discovery score, reviews, review score, badges, seasons, Server Wars scoring, XP awards, calling-card awards, and competitive eligibility.
- Stripe checkout activation, Stripe product/price changes, Cloudflare secret changes, production D1 writes, Nitrado calls, Discord resource mutation, and issue #49.

Mutation scope:

- This slice may read the existing scoped source-management payload and export policy metadata.
- Configured DZN admins may receive `export_policy_review`; normal owners receive `null` for that admin-only review payload.
- This slice does not add a migration, database write, browser storage write, export file store, sharing link, retained-export policy save action, checkout session, or external service call.

Fairness remains unchanged: the admin-only policy review, all owner scopes default confirmation, and future-retention blocked state are governance and presentation aids only. They cannot make a player publicly visible without the player's opt-in generated handle and must not affect CTF scoring rows, owner workflow decisions, approval decisions, bracket outcomes, billing, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility.

## Community Member Retained Export Approval Design Slice

The community member retained export approval design slice is a design-only retained-export approval model. It deliberately does not approve retained exports and does not implement retained export files, export-history rows, sharing links, storage bindings, migrations, retention write APIs, or download links.

There are no retained export files, export-history rows, sharing links, or retention write APIs in this design-only slice.

Approval authority:

- Retained exports can be approved only by the `dzn_platform_owner`.
- The approval must include a security reviewer and a data retention owner.
- Approval must be recorded in a dedicated retained-export approval issue or PR, separate from issue #49.
- Issue #49 remains reserved for final live checkout activation.
- Owner self-approval is not allowed.
- Admin dashboard toggles are not allowed to approve or enable retention.

Future retained-export migration shape, if deliberately approved later:

- Proposed migration filename: `future_retained_community_member_audit_exports.sql`.
- Proposed policy table: `community_member_retained_export_policies`, for owner/admin-scoped approvals and disabled-by-default policy state.
- Proposed retained export table: `community_member_retained_exports`, for private retained export metadata with `expires_at`, `deleted_at`, object key, checksum, row count, scope, actor, and filter metadata.
- Proposed access audit table: `community_member_retained_export_access_audit`, for private create, download, expiry, delete, deny, disable, and failure history.
- No migration may be added until the dedicated approval, expiry model, storage plan, rollback plan, and security review are complete.

Expiry model:

- 7-day default retention.
- 30-day maximum retention.
- Every retained export must have `expires_at`.
- Expired, deleted, disabled, and out-of-scope downloads must be denied.
- Deletion or expiry jobs must be cron-secret-only.
- Deleted retained exports should leave tombstone metadata for audit without keeping a downloadable file.

Storage plan:

- Storage, if ever approved, must use a private R2 bucket.
- Proposed binding name: `COMMUNITY_MEMBER_EXPORTS_BUCKET`.
- Public URLs, public buckets, and unauthenticated sharing links are prohibited.
- Any signed download path must recheck owner/admin auth, linked-server scope, expiry, deletion state, and approval state before issuing access.
- Retained payloads may contain export-safe CSV rows only.
- Raw Discord IDs, raw DZN user IDs, raw linked-server IDs, raw community guild IDs, OAuth tokens, Nitrado tokens, Stripe secrets, raw award evidence, scoring state, and public-profile private settings are prohibited.

Security review checklist:

- Owner/admin scope must be enforced before retained export creation, listing, download, expiry, or deletion.
- Cross-owner denial must be tested for retained export metadata and storage object access.
- Retained payloads must be export-safe only and must not expose raw Discord/user/server/guild identifiers.
- Retained export creation must not write billing, ranking, review, profile visibility, scoring, award, season, badge, event, or eligibility state.
- R2 storage must be private-only, with no public URL generation or unauthenticated sharing link.
- Expiry, deletion, tombstone, and rollback behavior must be tested before any migration is applied.

Rollback rules:

- Disable retained export creation before any data rollback.
- Keep the current download-only export path as the fallback.
- Deny downloads for disabled, deleted, expired, or out-of-scope retained exports.
- Delete retained export objects before removing storage bindings.
- Tombstone deleted export metadata for audit without preserving downloadable files.
- Rollback proof must show no public profile, scoring, billing, ranking, review, badge, season, event, Server Wars, XP, calling-card, or eligibility state changed.

Proof requirements before any future implementation:

- The dedicated approval record must name the DZN platform owner approver and security reviewer.
- Migration review must prove exact table shape, indexes, foreign keys, expiry fields, and rollback path before apply.
- Storage review must prove private R2 only, no public bucket, no public URL, and no unauthenticated sharing link.
- API tests must prove owner/admin scope, cross-owner denial, expired-download denial, deleted-download denial, and admin-only policy visibility.
- Mutation scans must prove no retained export files, export-history rows, sharing links, retention write APIs, live checkout activation, Stripe product or price changes, Cloudflare secret changes, production D1 writes, Nitrado calls, Discord mutation, or issue #49 merge.

Still excluded:

- Retained export files, export-history rows, sharing links, retention write APIs, storage bindings, retained-export migrations, browser persistence, and public export records.
- Public profile visibility without the player's opt-in generated handle.
- CTF scoring rows, owner workflow decisions, approval decisions, bracket outcomes, event eligibility, scoring feeds, and accepted audit feeds.
- Billing, plan status, owner entitlement mutation, rankings, discovery score, reviews, review score, badges, seasons, Server Wars scoring, XP awards, calling-card awards, and competitive eligibility.
- Stripe checkout activation, Stripe product/price changes, Cloudflare secret changes, production D1 writes, Nitrado calls, Discord resource mutation, and issue #49.

Mutation scope:

- This slice may expose admin-only retained-export approval design metadata through the existing `export_policy_review` payload.
- Configured DZN admins may review the proposed approval, migration, expiry, storage, security, rollback, and proof requirements.
- Normal owners still receive `null` for the admin-only `export_policy_review` payload.
- This slice does not add a migration, database write, browser storage write, export file store, sharing link, retained-export policy save action, checkout session, or external service call.

Fairness remains unchanged: the retained-export approval design is a governance aid only. It cannot make a player publicly visible without the player's opt-in generated handle and must not affect CTF scoring rows, owner workflow decisions, approval decisions, bracket outcomes, billing, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility.

## Community Member Directory and Player Hub Surfacing Polish Slice

This slice improves the already-approved public-safe community member directory and the free logged-in Player Hub. It does not introduce a new migration, owner import write path, retained export feature, scoring hook, billing hook, or live-payment behavior.

The slice adds:

- A `community_href` read model on Player Hub server summaries so server profile links and public member-directory links remain distinct.
- A Player Hub "Community Member Directories" section sourced only from matched, saved, or suggested servers that already have a safe public slug.
- Direct "Members" actions on matched community rows and server cards, pointing to `/servers/[slug]/community`.
- Public directory search and role filtering across already-public profile rows only.
- Public community page copy/share affordances for the public directory URL only, not for private exports or owner/admin artifacts.
- Clear empty states explaining that hidden members remain hidden unless DZN has the trusted `community_members` bridge and the player has opted into a generated public profile handle.
- Owner/admin candidate cards with a "Public directory status" preview showing whether an imported bridge can appear publicly or stays hidden until player opt-in.
- A `public_directory_preview_presentation_only` source-management safeguard.

This slice keeps these boundaries:

- The public community directory remains read-only and may expose only public profile hrefs generated by the profile privacy system.
- The owner/admin public directory preview is presentation-only and cannot publish a player profile.
- Public directory search/filtering never searches raw Discord IDs, raw user IDs, private source records, scoring rows, billing rows, review internals, award evidence, or owner workflow state.
- Retained export files, export-history rows, sharing links, storage bindings, retention write APIs, retained-export migrations, live checkout activation, Stripe product/price changes, Cloudflare secret changes, production D1 writes, Nitrado calls, Discord mutations, and issue #49 remain out of scope.
- Billing, rankings, discovery score, reviews, review score, badges, seasons, events, CTF scoring rows, bracket outcomes, owner workflow decisions, Server Wars scoring, XP awards, calling-card awards, and competitive eligibility remain isolated.

## Public Community Directory Discovery Polish Slice

This slice improves `/servers/[slug]/community` as a public discovery surface without changing the public-safe data contract, owner/admin import workflows, retained export policy, billing, checkout, scoring, or profile publication behavior.

The slice adds:

- richer public sorting for featured order, name, role label, and newest public month;
- public grouping by role group, joined month, or no grouping;
- safe context cards for visible profile count, public role-group count, newest visible month, and the no-influence guarantee;
- richer member cards that show only already-public role labels, public role-group labels, opt-in public state, and generated public handles;
- explicit `discovery_polish_presentation_only` and `sorts_and_groups_public_rows_only` safeguards.

The discovery polish sorts and groups already-visible public rows only. It must not request, search, infer, or expose hidden members, raw Discord IDs, raw DZN user IDs, raw linked-server IDs, raw community guild IDs, OAuth tokens, Nitrado tokens, Stripe state, source candidate rows, owner/admin import rows, raw award evidence, scoring state, approval state, owner workflow state, billing state, or private profile settings.

Retained export files, export-history rows, sharing links, storage bindings, retention write APIs, retained-export migrations, owner/admin import workflow changes, community member source-management writes, live checkout activation, Stripe product/price changes, Cloudflare secret changes, production D1 writes, Nitrado calls, Discord mutations, and issue #49 remain out of scope. Live checkout remains disabled, and Issue #49 remains reserved for final live payment activation.

Billing, rankings, discovery score, reviews, review score, badges, seasons, events, CTF scoring rows, bracket outcomes, owner workflow decisions, Server Wars scoring, XP awards, calling-card awards, and competitive eligibility remain isolated.

## Public Community Member Card Preview Polish Slice

This slice enriches the public community member cards with small public-safe previews from each member's already-published profile sections only when those sections are visible under that player's saved privacy settings.

The slice adds:

- A `PublicPlayerProfileDirectoryPreview` read model sourced from the public profile privacy contract.
- Batched public profile section summary reads for visible opted-in community members.
- Preview highlights for visible XP, challenge progress, and calling-card sections only.
- Card UI that validates the preview contract before rendering any preview metadata.
- Empty-state copy when a public profile exists but its sections are hidden or not yet earned.
- `preview_uses_published_profile_sections_only` and `preview_omits_hidden_profile_sections` safeguards on the public community member directory contract.

The preview may show only public-safe labels and counts that match already-published profile sections: level label, month-free XP total label, challenge joined/completed counts, calling-card count, and one public calling-card name when that section is visible. It must not expose internal user IDs, Discord IDs, raw source rows, raw award evidence, exact award timestamps, raw source IDs, owner/admin import records, retained export artifacts, billing state, scoring state, approval state, or private profile settings.

Hidden profile sections stay private. A hidden XP section must not be queried for the card preview. Hidden challenge progress must not be queried for the card preview. Hidden calling-card sections must not be queried for the card preview. Public profile visibility still requires the player's opt-in generated handle.

Retained exports remain blocked unless separately approved. Owner/admin import controls stay separate. This slice must not add migrations, retained export files, export-history rows, sharing links, storage bindings, retention write APIs, owner/admin import writes, checkout sessions, profile handle generation, profile privacy writes, billing updates, server ownership changes, ranking updates, discovery score updates, review mutations, badge awards, season changes, event mutations, roster mutations, CTF scoring changes, Server Wars score/result changes, XP awards, calling-card awards, Nitrado calls, Discord mutations, Cloudflare secret changes, production D1 writes, live checkout activation, or issue #49 changes.

Live checkout remains disabled, and Issue #49 remains reserved for final live payment activation.

Billing, rankings, discovery score, reviews, review score, badges, seasons, events, CTF scoring rows, bracket outcomes, owner workflow decisions, Server Wars scoring, XP awards, calling-card awards, and competitive eligibility remain isolated.

## Player Public Profile Visual Polish Slice

This slice improves `/players/[handle]` as a richer DZN-branded public profile viewer after public community cards can preview visible sections. It is a presentation-only slice: the public profile API, public handle generation, privacy settings model, progression read model, billing gates, scoring systems, and owner/admin workflows remain unchanged.

The slice adds:

- A DZN-branded public profile shell with cinematic background layers, public dossier styling, and subtle slow pan/zoom motion.
- Reduced-motion fallbacks for animated public profile background and profile signal treatments.
- A stronger identity card showing public handle, safe section counts, published XP, challenge clears, and calling-card count derived only from the existing public profile response.
- Richer public-safe cards for visible XP, challenge progress, calling cards, and activity timeline sections.
- Static guard tests that prove visual classes and presentation helpers do not become dependencies of billing, scoring, ranking, review, badge, season, Server Wars, XP-award, calling-card-award, CTF, event, or owner/community import systems.

The page may show only the public-safe profile payload already returned by `GET /api/public/player-profiles/[handle]`. It must not create profile handles, write profile privacy settings, award XP, award calling cards, change challenge progress, create checkout sessions, update owner billing, change server ownership, update rankings or leaderboards, modify discovery score, mutate reviews, award badges, change seasons, modify events, alter CTF or Server Wars scoring/results, touch retained exports, call Nitrado, mutate Discord resources, change Cloudflare secrets, apply production migrations, enable live checkout, or merge issue #49.

Privacy controls remain authoritative. Hidden profile sections stay hidden, private identifiers and raw award evidence remain unavailable to the viewer, and public profile styling cannot affect billing, scoring, rankings, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, or competitive eligibility.

Live checkout remains disabled, and Issue #49 remains reserved for final live payment activation.

## Public Profile Owner Preview and Share Polish Slice

This slice improves the private `/player/profile` public-profile owner experience after `/players/[handle]` has received the richer DZN-branded viewer treatment. It is a presentation-only slice for logged-in players who own their profile. It does not change the public profile API, profile privacy persistence model, public handle generation, progression award model, billing gates, scoring systems, or owner/admin workflows.

The slice adds:

- A private owner preview card labelled "How My Public Profile Looks" inside the existing `PublicProfileSharePanel`.
- A public-safe preview projection built from the player profile payload already loaded by `/player/profile` and the current local visibility controls.
- Clear hidden-section and unsaved-change warnings so players understand what visitors can see now versus what is only a local preview until they press Save Preferences.
- Improved copy/share controls: open public page, copy public link, copy public handle, and use the browser share sheet where available.
- DZN-branded owner-preview styling that matches the public profile visual system without creating a new API route or storage model.
- `test:public-profile-owner-preview-share-polish` to prove the preview/share UI remains local browser presentation and does not become a dependency of protected influence systems.

Authorization and privacy rules:

- Normal Discord login remains enough to open `/player/profile`; Starter, Pro, server ownership, Nitrado access, Stripe, Discord bot permissions, and billing state are not required.
- The private owner preview may show only public-safe labels and counts that the player can already see in their private profile payload: display name, generated public handle when present, public href when present, XP total, joined/completed challenge counts, calling-card count, visible/hidden section states, and month-level award-date messaging.
- The private owner preview must not expose Discord IDs, internal user IDs, Discord avatar hashes or derived public avatar URLs, source IDs, source tables, raw award evidence, ADM source rows, billing rows, owner account state, Nitrado tokens, Discord bot tokens, Stripe state, Cloudflare secrets, retained export artifacts, or exact award timestamps.
- If local toggles are dirty, the preview must explain that unsaved changes are local only until the existing Save Preferences action writes the player's privacy row.
- Opening the public page remains the exact visitor-view check when a saved public href exists.

Mutation scope:

- Copy/share controls may only copy to the local clipboard, copy the generated handle, navigate to the existing public href, or invoke the browser share sheet.
- The owner preview/share component must not fetch data, create handles, write profile privacy settings, award XP, award calling cards, alter challenge progress, create checkout sessions, update owner billing, change server ownership, update rankings or leaderboards, modify discovery score, mutate reviews, award badges, change seasons, modify events, alter CTF or Server Wars scoring/results, touch retained exports, call Nitrado, mutate Discord resources, change Cloudflare secrets, apply production migrations, enable live checkout, or merge issue #49.
- The only write on `/player/profile` remains the existing explicit Save Preferences action against `/api/player/profile-privacy`.

Fairness remains unchanged: owner preview/share UI and copy/share controls cannot affect profile privacy settings, billing, scoring, rankings, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, events, or competitive eligibility.

Live checkout remains disabled, and Issue #49 remains reserved for final live payment activation.

## Public Profile Share Session Feedback Slice

This slice adds lightweight feedback to the private `/player/profile` public-profile share panel so players can see what they last did with their generated public profile link during the current browser tab session. It is deliberately analytics-free and audit-free: the feedback is held only in React state for the mounted page and is lost on reload, navigation, tab close, or remount.

The slice adds:

- A "This Page Session" panel inside `PublicProfileSharePanel`.
- Local rows for the last public page open, public link copy, public handle copy, and browser share-sheet open during this tab session.
- A clear "Private to this tab. It is not saved or sent to DZN." message.
- `test:public-profile-share-session-feedback` to prove the feature does not introduce persistence, analytics, server writes, or protected-system dependencies.

Rules:

- The session feedback may use only local component state.
- The session feedback must not use `localStorage`, `sessionStorage`, IndexedDB, cookies, beacons, analytics events, tracking events, audit-log calls, public-profile API fetches, profile-privacy writes, or any server route.
- Opening the public page may record an in-memory `opened` timestamp before opening the existing public href in a new tab.
- Copying the public link or generated handle may record an in-memory copy timestamp only after clipboard copy succeeds.
- Browser share feedback may record an in-memory share timestamp only after the browser share sheet opens successfully; user-aborted shares should not be treated as a completed share.
- The timestamp is user-facing feedback only. It must not become evidence of sharing, moderation state, attribution state, profile publication state, or account activity.

Fairness remains unchanged: public profile share session feedback cannot affect profile privacy settings, billing, scoring, rankings, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, events, or competitive eligibility.

Live checkout remains disabled, and Issue #49 remains reserved for final live payment activation.

## Public Profile Share Accessibility/Fallback Polish Slice

This slice improves the private `/player/profile` public-profile share panel so copy/open/share controls are clearer for keyboard and screen-reader users, and unavailable browser capabilities have explicit fallback guidance. It remains a client-only presentation slice layered on top of the share session feedback.

The slice adds:

- Stable accessible labels, descriptions, and focus-visible states for opening the public profile page, copying the public link, copying the generated public handle, and opening the browser share sheet.
- An `aria-live` status region so copy, handle-copy, browser-share, clipboard-unavailable, browser-share-unavailable, and generic failure states are announced without requiring a page refresh.
- Local browser capability checks for clipboard and native share support after mount.
- Clear fallback guidance when Clipboard copy is unavailable, Browser share is unavailable, or the generated public handle is not available.
- `test:public-profile-share-a11y-fallback-polish` to prove the controls remain local UI presentation and do not become a dependency of protected influence systems.

Rules:

- The accessibility/fallback polish may use only local component state and browser capability checks.
- The controls may add ARIA labels, `aria-describedby`, `aria-live`, disabled states, titles, and visible fallback guidance.
- Clipboard fallback guidance may tell the player to open the public page and copy from the address bar.
- Browser-share fallback guidance may point the player back to Copy Link when clipboard access works.
- The slice must not add stored share history, tracking events, analytics calls, audit-log calls, localStorage, sessionStorage, IndexedDB, cookies, beacons, fetches, API calls, privacy-setting writes, or any server route.
- The only write on `/player/profile` remains the existing explicit Save Preferences action against `/api/player/profile-privacy`.

Fairness remains unchanged: public profile share accessibility/fallback polish cannot affect profile privacy settings, billing, scoring, rankings, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, events, or competitive eligibility.

Live checkout remains disabled, and Issue #49 remains reserved for final live payment activation.

## Public Profile Share Preview Metadata Polish Slice

This slice improves `/players/[handle]` link previews with public-safe Open Graph/Twitter-style metadata and fallback preview copy. Because the app is statically exported and arbitrary player handles are served by the Cloudflare Pages function at `functions/players/[handle].ts`, the Next route keeps generic static fallback metadata while the Pages function rewrites the returned profile shell with per-handle metadata at request time.

The slice adds:

- A `PublicPlayerProfileSharePreviewMetadata` projection built from the already-filtered public profile payload returned by `getPublicPlayerProfilePayload`.
- Per-handle `<title>`, canonical URL, `description`, Open Graph, Twitter card, preview image, and DZN fallback preview-copy metadata for `/players/[handle]`.
- Generic `noindex,nofollow` fallback metadata for invalid, hidden, unpublished, unavailable, or failed profile lookups.
- Visibility-aware metadata summaries that use only visible public profile sections: XP, challenge progress, and calling cards.
- Static guard tests proving hidden sections are omitted even if contradictory section data is present in a synthetic payload.

Rules:

- Metadata may use only already-public profile fields and saved visibility preferences from the public profile read model.
- Hidden XP, hidden challenge progress, hidden calling cards, private identifiers, Discord IDs, internal user IDs, source IDs, raw award evidence, exact award timestamps, private profile settings, owner/admin rows, retained export artifacts, billing rows, scoring rows, and event internals must not appear in metadata.
- The metadata path must not store share history, create tracking events, call analytics, write profile privacy settings, create profile handles, create checkout sessions, update billing, update rankings, modify discovery score, mutate reviews, award badges, alter seasons, mutate events, change Server Wars or CTF scoring, award XP, award calling cards, call Nitrado, mutate Discord resources, change Cloudflare secrets, apply production migrations, enable live checkout, or merge issue #49.
- The Cloudflare Pages shell function may read the public profile payload and rewrite the static shell response, but it must not introduce new write routes, cookies, browser storage, beacon calls, analytics calls, audit-log calls, or live-service mutations.

Fairness remains unchanged: public profile share preview metadata cannot expose hidden sections, store share history, create tracking events, call analytics, write profile privacy settings, alter billing, scoring, rankings, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, events, or affect competitive eligibility.

Live checkout remains disabled, and Issue #49 remains reserved for final live payment activation.

## Public Profile Share Preview Crawler QA Slice

This slice adds a local smoke harness for the rewritten `/players/[handle]` shell. It does not change public profile behavior; it proves that crawler-style requests receive the intended public-safe `<head>` metadata after the Cloudflare Pages shell rewrite.

The slice adds:

- A local crawler/rendered QA script that calls the real `functions/players/[handle].ts` `onRequestGet` handler.
- A fake exported `/players/preview.html` asset shell with stale static metadata, so the test proves managed tags are actually replaced.
- A read-only fake D1 binding for published and hidden profile cases, with write SQL rejected by design.
- Snapshot assertions for published, hidden, invalid, and unavailable profiles.
- Final `<head>` metadata snapshots covering title, description, canonical, robots, Open Graph, Twitter, DZN fallback preview copy, preview source, content/cache headers, duplicate managed tags, asset-shell path, body-shell preservation, and write-query count.
- Static dependency checks proving crawler preview metadata does not become an input to billing, rankings, discovery score, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, events, CTF, retained exports, Nitrado, Discord, or owner/admin source-management code.

Rules:

- The QA harness may render the profile shell locally and compare final `<head>` snapshots.
- The QA harness may use fake public profile rows and fake static assets only.
- The QA harness must not use production D1, Cloudflare secrets, real Nitrado, real Discord, live Stripe, live checkout, production deployments, retained export storage, or issue #49.
- Published-profile snapshots must show only fields that the public profile payload already exposes under saved visibility preferences.
- Hidden, invalid, unpublished, unavailable, or failed-profile snapshots must use generic `noindex,nofollow` metadata.
- Crawler-visible metadata must not include hidden profile sections, private identifiers, Discord IDs, internal user IDs, source IDs, raw award evidence, exact award timestamps, private settings, owner/admin rows, retained export artifacts, billing rows, scoring rows, review internals, approval state, event internals, CTF scoring, or Server Wars scoring.

Fairness remains unchanged: public profile share preview crawler QA proves the rewritten shell works without hidden fields, analytics/tracking calls, share-history storage, privacy writes, billing changes, scoring changes, ranking changes, review changes, badge/season/Server Wars changes, XP/calling-card award changes, event changes, or competitive eligibility impact.

Live checkout remains disabled, and Issue #49 remains reserved for final live payment activation.

## Public Profile Share Preview Image/Card Polish Slice

This slice adds a public-safe social preview image/card quality check for `/players/[handle]`. It keeps the Open Graph/Twitter metadata behavior unchanged, but makes the preview image contract explicit so the current `/media/dzn-cinematic-survivor.png` asset and any future DZN share-card asset references are validated before release.

The slice adds:

- `PUBLIC_PLAYER_PROFILE_SHARE_PREVIEW_IMAGE_CARDS` as the canonical catalog of public-safe static share-card assets for public player profile metadata.
- `resolvePublicPlayerProfileSharePreviewImageCard` as the metadata resolver for selecting a configured card or falling back to the default DZN survivor card when a future candidate is unavailable or misconfigured.
- `image_card` metadata on `PublicPlayerProfileSharePreviewMetadata`, keeping `image_href`, `image_alt`, Open Graph image tags, and Twitter image tags tied to the same resolved card contract.
- A local image/card QA script that parses PNG, JPEG, and WebP dimensions directly from static asset bytes.
- Static checks that `/media/dzn-cinematic-survivor.png` exists under `public/media`, is a crawler-friendly PNG at `1983x793`, meets the declared `1200x630` minimum, has non-empty public-safe alt text, and is copied under `out/` whenever an exported build is present.
- Static dependency checks proving the share-card catalog does not become an input to protected billing, scoring, ranking, discovery, review, badge, season, Server Wars, XP, calling-card, event, Nitrado, Discord, or checkout paths.

Rules:

- Share-card assets must be root-relative `/media/*` PNG, JPEG, or WebP files with no query string, fragment, traversal, remote host, or tracking URL.
- Share-card assets must be public-safe static assets and must not embed private profile fields, Discord IDs, internal DZN user IDs, source IDs, raw award evidence, exact award timestamps, billing state, scoring rows, review internals, owner/admin records, retained exports, event internals, CTF scoring, or Server Wars scoring.
- Alt text must describe the card generically and must not include private identifiers, hidden progression, raw evidence, tracking, or analytics language.
- Future DZN share-card references must be added to `PUBLIC_PLAYER_PROFILE_SHARE_PREVIEW_IMAGE_CARDS` and must pass the same static source/export checks before they can be used by `/players/[handle]` metadata.
- Missing or unsafe future candidates must fall back to the default DZN cinematic survivor card rather than leaking profile data, calling trackers, or creating server-side state.
- The QA path may inspect local `public/` assets, inspect `out/` only when a static export exists locally, and build metadata in memory with synthetic public profile payloads.
- The QA path must not call production D1, Cloudflare secrets, live Stripe, Nitrado, Discord, analytics, tracking, share-history storage, privacy writes, retained export storage, deployments, or issue #49.

Fairness remains unchanged: public profile share preview image/card polish cannot expose hidden profile sections, store share history, create tracking events, call analytics, write privacy settings, alter billing, scoring, rankings, discovery, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, events, or affect competitive eligibility.

Live checkout remains disabled, and Issue #49 remains reserved for final live payment activation.

## Public Profile Share-Card Crawler Visual QA Slice

This slice adds a local rendered social-card preview QA check for `/players/[handle]`. It does not change the public profile route or profile data model; it proves the existing route output can be rendered into crawler-friendly Open Graph and Twitter preview-card models from the final rewritten `<head>`.

The slice adds:

- A local QA script that renders `/players/[handle]` through the real Pages Function with fake ASSETS and a fake read-only public profile DB.
- Coverage for published, hidden, invalid, unavailable, and fallback-image states.
- Deterministic rendered social-card preview models for Open Graph and Twitter, built from the final head tags only.
- Checks that rendered cards use the correct final image URL and alt text.
- Checks that `/media/dzn-cinematic-survivor.png` remains the crawler-friendly default static card and satisfies the `1200x630` social-card contract.
- Checks that a missing future card candidate falls back to the default DZN static card instead of exposing data, calling trackers, or creating state.
- Checks that hidden profile sections, private identifiers, raw award evidence, private settings, owner/admin rows, retained export references, billing state, scoring rows, review internals, event internals, CTF scoring, and Server Wars scoring do not appear in the rendered head or rendered preview-card HTML.
- Static dependency checks proving the visual QA path does not become an input to protected billing, scoring, ranking, discovery, review, badge, season, Server Wars, XP, calling-card, event, CTF, community-member, Nitrado, Discord, or checkout paths.

Rules:

- The visual QA harness may render final head tags locally and build in-memory social-card preview HTML.
- The visual QA harness may use fake public profile rows, fake read-only DB bindings, and fake static assets only.
- Published-profile rendered previews must use only fields exposed by the public profile payload under saved visibility preferences.
- Hidden, invalid, unavailable, or failed-profile rendered previews must use generic `noindex,nofollow` fallback metadata.
- Fallback-image rendered previews must still use the default `/media/dzn-cinematic-survivor.png` image URL and public-safe alt text.
- The visual QA path must not store share history, create tracking events, call analytics, write profile privacy settings, create profile handles, create checkout sessions, update billing, mutate rankings, change discovery score, mutate reviews, award badges, alter seasons, mutate events, change Server Wars or CTF scoring, award XP, award calling cards, call Nitrado, mutate Discord resources, change Cloudflare secrets, apply production D1 migrations, enable live checkout, or merge Issue #49.

Fairness remains unchanged: public profile share-card crawler visual QA is presentation-proof only with no hidden sections, no analytics/tracking calls, no stored share history, no privacy writes, and no billing, scoring, ranking, discovery, review, badge, season, Server Wars, XP/calling-card award, event, or competitive eligibility impact.

Live checkout remains disabled, and Issue #49 remains reserved for final live payment activation.

## Public Profile Social Preview Validation Package Slice

This slice creates a durable local reviewer artifact for the `/players/[handle]` social preview contract. It does not change runtime public profile behavior, metadata generation, the profile data model, image assets, or any live service integration.

The slice adds:

- A deterministic package generator/test that reuses the local share-card crawler visual QA render path.
- Sanitized rendered head/card snapshots for published, hidden, invalid, unavailable, and fallback-image states.
- A committed JSON artifact at `docs/artifacts/public-profile-social-preview-validation-package/public-profile-social-preview-validation-package.json`.
- A committed static HTML reviewer artifact at `docs/artifacts/public-profile-social-preview-validation-package/index.html`.
- Checks that the package can be regenerated locally without production services and without timestamp churn.
- Checks that every packaged state includes the final crawler image URL and public-safe image alt text.
- Checks that hidden profile sections, private identifiers, raw award evidence, private settings, owner/admin rows, retained export references, billing state, scoring rows, review internals, event internals, CTF scoring, and Server Wars scoring do not appear in the packaged JSON or HTML.
- Static dependency checks proving the package path does not become an input to protected billing, scoring, ranking, discovery, review, badge, season, Server Wars, XP, calling-card, event, CTF, community-member, Nitrado, Discord, checkout, Cloudflare secret, production D1, retained-export, analytics, tracking, or share-history paths.

Rules:

- The artifact may contain sanitized final `<head>` HTML, sanitized metadata fields, deterministic Open Graph/Twitter card preview fields, reviewer notes, local image preview references, and explicit false safety flags.
- The artifact must remain bounded and deterministic.
- The artifact must not contain scripts, forms, remote asset loaders, browser storage, beacons, analytics calls, tracking calls, audit-share calls, API write methods, checkout creation paths, live-service token names, raw SQL write operations, or production mutation commands.
- The artifact must not require production D1, Cloudflare secrets, Stripe, Nitrado, Discord, retained export storage, deployment, or issue #49.

Fairness remains unchanged: social preview validation packaging is review evidence only with no hidden sections, no analytics/tracking calls, no stored share history, no privacy writes, and no billing, scoring, ranking, discovery, review, badge, season, Server Wars, XP/calling-card award, event, or competitive eligibility impact.

Live checkout remains disabled, and Issue #49 remains reserved for final live payment activation.

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
| `/player/profile` and `/api/player/profile` | 401/login redirect | Allowed | Allowed | Allowed | Session auth, private no-store profile progression showcase, read-only; public-profile owner preview/share UI, share session feedback, and share accessibility/fallback guidance are local presentation only |
| `/api/player/profile-privacy` | 401 | Allowed | Allowed | Allowed | Private player-owned settings API; GET/PATCH only; writes only `player_profile_privacy_preferences` |
| `/players/[handle]` and `/api/public/player-profiles/[handle]` | Published profiles only | Published profiles only | Published profiles only | Published profiles only | Public-safe read-only profile viewer; respects saved player visibility preferences; DZN-branded visual shell and Open Graph/Twitter share-preview metadata are presentation-only; per-handle metadata uses only the already-filtered public payload; crawler QA snapshots published, hidden, invalid, and unavailable route states; share-card image QA validates `PUBLIC_PLAYER_PROFILE_SHARE_PREVIEW_IMAGE_CARDS`, `/media/dzn-cinematic-survivor.png`, static/exported asset presence, dimensions, alt text, and fallback behavior for future card references; share-card crawler visual QA renders published, hidden, invalid, unavailable, and fallback-image final head states into deterministic social-card previews and proves the correct image URL and alt text remain public-safe; social-preview validation packaging commits sanitized JSON/HTML reviewer artifacts for those states without production services; metadata, image/card, visual QA, and validation packaging cannot expose hidden sections, store share history, create tracking events, call analytics, write privacy settings, alter billing, scoring, rankings, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, events, or competitive eligibility |
| `/api/dzn-comms/presence` and `/community` DZN online counter | Static fallback unless public read flag is enabled; aggregate read only when enabled | Same public aggregate, no Starter or Pro required | Same public aggregate; owner entitlement does not change count | Same public aggregate; Pro does not change count | Presence-only; read/write flags default disabled; stores only hashed short-lived presence-session key, scope, timestamps, and expiry; no names, raw user IDs, Discord IDs, profile handles, IPs, user agents, routes, referrers, billing state, owner entitlement, server ownership, or competitive identifiers; cannot affect billing, owner entitlement, server ownership, rankings, discovery, reviews, badges, seasons, events, Server Wars, CTF scoring, XP, calling-card awards, public profile visibility, retained exports, moderation decisions, or competitive eligibility |
| Future global/support/private chat | Future public support entry point only | Future logged-in player chat/support | Future owner/community chat where scoped | Future owner/community chat where scoped | Not implemented yet; future architecture must keep AI support limited to public DZN website and setup-help content, require moderation/profanity filtering, warning, and timed-mute controls plus report controls, avoid surprise metered AI spend, and remain isolated from billing, scoring, rankings, discovery, reviews, badges, seasons, Server Wars, XP/calling-card awards, events, and competitive eligibility |
| Public profile attribution on reviews/challenges/leaderboards | Published profiles only | Published profiles only | Published profiles only | Published profiles only | Read-only generated-handle attribution; no name-only matching; ambiguous/hidden/unpublished profiles are not linked |
| Public profile attribution preview/control and safe event-suggestion author links | Public event suggestion links only when published | Allowed on private player surfaces; event suggestion links only when published | Allowed on private player surfaces; event suggestion links only when published | Allowed on private player surfaces; event suggestion links only when published | Player-owned visibility control; trusted user bridge required; roster scoring gates and owner mutations excluded |
| CTF/event presentation roster profile links | 401/login boundary | Owner/admin dashboard access required | Own server dashboard read-only, if owner/admin checks pass | Own server dashboard read-only, if owner/admin checks pass | Exact roster server/player bridge; generated handle required; presentation-only; registration, scoring, eligibility, and owner decisions unaffected |
| Public event host/member profile links | Published profiles only | Published profiles only | Published profiles only | Published profiles only | `competitive_events.created_by` trusted user bridge; presentation-only; event leaderboards, scoring rows, approvals, brackets, and owner workflows excluded |
| Public community member directory profile links | Published profiles only | Published profiles only; Player Hub may link to matched/saved/suggested public directories | Published profiles only; Player Hub may link to matched/saved/suggested public directories | Published profiles only; Player Hub may link to matched/saved/suggested public directories | `community_members.community_guild_id` plus `community_members.user_id` trusted bridge; presentation-only; public directory search, role filtering, sorting, grouping, and safe context cards cover already-public profile rows only; CTF scoring rows, owner workflow rows, approvals, brackets, billing, rankings, discovery, reviews, badges, seasons, Server Wars, XP, calling cards, and eligibility unaffected |
| Public community member card profile previews | Already-published visible profile sections only | Already-published visible profile sections only | Already-published visible profile sections only | Already-published visible profile sections only | Public card preview validates the `published_profile_sections` contract, renders only visible XP/challenge/calling-card section labels and counts, omits hidden sections, does not query hidden section sources, and cannot affect billing, scoring, rankings, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, or competitive eligibility |
| `/api/owner/community-members`, `/api/owner/community-members/export`, `/dashboard/community-members`, and `/owner/community-members` | Login/pricing boundary | Owner plan required | Own linked-server source management and export-safe audit downloads | Own linked-server source management and export-safe audit downloads, or global if DZN admin | Owner entitlement/admin plus linked-server scope; writes only candidates, source audit, trusted snapshot previews, private importable notifications, and imported `community_members`; duplicate and ambiguous user bridges are rejected; repeated no-match/duplicate filters are review-only; bulk partial-success summaries, audit groups, export-safe audit views, bounded CSV downloads, client-session-only recent export history, and the owner/admin-visible export policy surface are private read models; public directory preview is presentation-only and cannot publish a player profile; export date/action/result filters apply only after scope; downloaded CSV files are private owner/admin artifacts and non-persistent by default; optional retention settings are visible but persistent retention is disabled unless a later approved slice adds expiry and audit controls; configured DZN admins also receive an admin-only policy review confirming current export defaults across all owner scopes, flagging future retained-export work as blocked until dedicated approval, migration, expiry model, storage plan, and security review exist, and exposing a design-only retained-export approval model requiring the `dzn_platform_owner`, a dedicated retained-export approval issue or PR, future retained-export migration shape, 7-day default retention, 30-day maximum retention, private R2 bucket storage through `COMMUNITY_MEMBER_EXPORTS_BUCKET`, rollback rules, and proof requirements before any retained export files, export-history rows, sharing links, or retention write APIs exist; cannot make a player publicly visible without the player's opt-in generated handle |
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
