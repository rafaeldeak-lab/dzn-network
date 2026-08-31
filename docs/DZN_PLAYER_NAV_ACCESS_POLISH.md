# DZN Player Navigation Access Polish

## Scope

This slice makes the logged-in personal player area easier to find.

It is a navigation and presentation slice only. No Store payment, Supporter Card reveal, checkout, entitlement, wheel, chat runtime, or competitive-system behavior is added.

## Delivered Player Entry Points

Logged-in users now have a clearer personal player action in the shared header:

- `My Player` opens `/player`.
- The action is rendered only after the header has an authenticated account state.
- The action carries a stable QA marker: `data-player-nav-access="authenticated-player-home"`.
- The action carries the private profile path for QA: `data-player-profile-href="/player/profile"`.
- The link is account-neutral and does not include user IDs, Discord IDs, handles, billing IDs, or other private identifiers.

The Player Hub hero also has a direct private profile action:

- `My Profile` opens `/player/profile`.
- The action carries a stable QA marker: `data-player-profile-entry="hero-private-profile"`.

The existing `/player/profile` page still links back to `/player`, keeps owner setup separated behind `/pricing?intent=owner_setup&returnTo=%2Fsetup`, and keeps the Fair Progression Boundary copy intact.

## Auth Summary Contract

`GET /api/auth/me` now includes two fixed player URLs in the read-only navigation summary:

- `player_home_url: "/player"`
- `player_profile_url: "/player/profile"`

These values let authenticated UI render explicit player navigation after account verification without creating account-specific public routes or exposing identifiers.

The auth summary remains read-only. It still does not call billing-status mutation helpers, upsert entitlement rows, create checkout sessions, or change owner access.

## Access Boundary

The page boundary is unchanged:

| Surface | Visitor | Free logged-in player | Starter/Pro owner | Enforcement |
| --- | --- | --- | --- | --- |
| `/player` | Login required | Allowed | Allowed | Page auth middleware |
| `/player/profile` | Login required | Allowed | Allowed | Page auth middleware plus private player API |
| `/setup` | Login required, then pricing if no owner entitlement | Owner pricing required | Allowed | Owner billing page middleware |
| `/dashboard` | Login required, then pricing if no owner entitlement | Owner pricing required | Allowed | Owner billing page middleware |

The navigation button is not authorization. Server-side middleware and APIs remain authoritative.

## Explicit Non-Goals

This slice does not add or alter:

- Store order creation.
- Store Checkout Session creation.
- Store webhooks.
- Store entitlement writes.
- Supporter Card issuance.
- Supporter Card public reveal.
- Supporter Card generated art.
- Supporter Card sharing, screenshot, or export controls.
- Live checkout activation.
- Stripe products, prices, customers, webhooks, or secrets.
- Cloudflare secrets, bindings, or production configuration.
- Production D1 data or migrations.
- Earned spins, spin ledgers, wheel cooldowns, or reward wheel runtime.
- Real DZN Comms reactions.
- Chat message sending.
- Chat message persistence.
- Chat moderation tables.
- Durable Objects or WebSockets.
- AI provider credentials, vector stores, or metered model calls.
- Analytics or tracking calls.
- Ranking, discovery, review-score, badge, season, event, CTF, Server Wars, XP, calling-card, or competitive eligibility logic.
- Issue `#49`.

## Comms Follow-Up Boundary

The next Comms slice should be the DZN Comms reaction interaction contract preflight.

That future slice should define reaction add/remove/list/read contracts, emoji allow-list rules, per-user idempotency, reaction count privacy, abuse/rate limits, moderation visibility, rollback, and proof requirements before any runtime reaction API, message table, Durable Object, WebSocket, persistence, analytics, AI provider, or metered model call is implemented.

## Acceptance Criteria

- Header exposes an authenticated-only `My Player` action to `/player`.
- Player Hub exposes a direct `My Profile` action to `/player/profile`.
- `GET /api/auth/me` returns fixed player home/profile URLs in its read-only navigation summary.
- Logged-out navigation remains public-only.
- `/player` and `/player/profile` remain free logged-in player surfaces.
- `/setup` and `/dashboard` remain owner-entitlement-gated.
- Store, Supporter Card, live checkout, production mutation, chat runtime, and competitive systems remain untouched.
