# DZN Player + Owner Platform Specification

Last updated: 2026-08-31

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

Next recommended product slice after saved/followed servers:

- Player Hub real-data foundation: show matched Discord communities, followed/saved servers, suggested events/tournaments, and profile entry points for logged-in players while keeping owner setup behind `/pricing` and entitlement gates.
