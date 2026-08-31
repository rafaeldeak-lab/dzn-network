# DZN Comms Message/Read Model Local/Test Foundation

## Scope

This slice implements the first approved DZN Comms message/read foundation from `docs/DZN_COMMS_MESSAGE_READ_MODEL_APPROVAL_PREFLIGHT.md`.

It adds a disabled-by-default, local/test-only read-only message-history route and the approved read-focused schema. The `/community` route remains on the static local mock-data shell unless a later UI integration slice enables runtime fetching.

Implemented route:

```text
GET /api/dzn-comms/channels/:channelId/messages
```

Implemented schema:

```text
dzn_comms_channels
dzn_comms_channel_memberships
dzn_comms_messages
dzn_comms_message_visibility_events
```

This slice does not add chat sending, reaction runtime, report routes, moderation mutations, DZN Assist AI runtime, Durable Objects, WebSockets, analytics/tracking, Store/payment changes, live checkout activation, production mutations, retained exports, deployment, or issue #49 changes.

## Feature Flags

All message history remains disabled by default.

Server flags:

```text
DZN_COMMS_MESSAGE_READ_ENABLED=false
DZN_COMMS_MESSAGE_READ_LOCAL_TEST_RUNTIME=false
DZN_COMMS_PUBLIC_CHANNEL_HISTORY_ENABLED=false
DZN_COMMS_PRIVATE_GROUP_HISTORY_ENABLED=false
```

The implementation intentionally accepts only these explicit local/test runtime values:

```text
DZN_COMMS_MESSAGE_READ_LOCAL_TEST_RUNTIME=local
DZN_COMMS_MESSAGE_READ_LOCAL_TEST_RUNTIME=test
```

Values such as `true`, `production`, `preview`, `remote`, and missing values do not enable the route.

Client UI flag remains future-only in this slice:

```text
NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED=false
```

No Wrangler config, Cloudflare secret, Cloudflare variable, production D1, or deployment change is made by this source slice.

## Access Matrix

| Actor | Public channel read | Private group read | Message write |
| --- | --- | --- | --- |
| Logged-out visitor | Denied by the API; `/community` static fallback remains visible | Denied | Denied |
| Free logged-in Discord player | Allowed for visible public-channel messages only when local/test read flags are enabled | Only with active trusted private-group membership | Denied |
| Starter owner | Same as free player; no read advantage | Same membership proof required | Denied |
| Pro owner | Same as Starter; no read advantage | Same membership proof required | Denied |
| DZN admin/moderator | Same as normal player unless a later staff-read slice is approved | Same membership proof required unless a later staff-read slice is approved | Denied |

Free logged-in Discord players may read visible public-channel messages without Starter or Pro when the route is explicitly enabled in local/test.

Private group reads require active trusted membership in `dzn_comms_channel_memberships` for the current server-resolved DZN user ID. Owner entitlement alone is not private group membership.

## Public Channels

The first approved public channel keys are:

```text
global
new-players
server-owners
events
```

Public reads return only visible or locked messages from enabled public channels. The route does not read billing, owner entitlement, rankings, discovery, reviews, events, XP, calling-card awards, Store, Nitrado, Discord OAuth token, retained export, analytics, or competitive tables.

## Private Groups

Private group reads:

- Resolve the current session server-side.
- Resolve the requested channel server-side.
- Require `channel_type = private_group`.
- Require `membership_state = active`.
- Reject expired, removed, pending, missing, cross-group, and cross-owner membership attempts.
- Return a safe unavailable/forbidden response without exposing private message bodies.

Client-submitted user IDs, Discord IDs, owner IDs, server IDs, roles, plans, entitlements, public profile handles, display names, gamertags, and review author names are never accepted as membership proof.

## Message Visibility

Returned:

- `visible`
- `locked`

Not returned:

- `hidden`
- `deleted`
- `quarantined`
- `expired`
- `staff_only`
- `unavailable`
- messages whose `expires_at` has passed
- rejected send attempts
- blocked/profanity-filtered bodies
- timeout-triggering bodies
- support prompts
- support answers
- moderation notes
- report notes
- raw evidence

This first implementation omits unsafe messages instead of returning tombstones.

## Response Boundary

Every response is private/no-store:

```text
Cache-Control: private, no-store, no-cache, must-revalidate
Vary: Cookie
X-DZN-Comms-Message-Read-Contract: read-only-local-test
```

Responses return public-safe display fields only:

- display name
- approved role label
- initials
- message body for visible/locked messages
- read-only presentation kind

This slice intentionally returns `profileHref: null` because the route does not yet re-check saved public-profile visibility preferences at read time. Public profile author links should be added only by a later attribution slice that joins against the existing player privacy controls.

Responses never expose raw DZN user IDs, Discord IDs, Discord OAuth tokens, private emails, hidden profile fields, billing identifiers, owner entitlement identifiers, Nitrado identifiers, IP addresses, user agents, referrers, route history, moderation evidence, report details, support transcripts, retained exports, or raw ledger rows.

## Cursor And Page Boundaries

The route supports:

```text
limit
cursor
direction
```

Rules:

- default limit is 25
- maximum limit is 50
- invalid limits fall back to safe bounds
- cursors are opaque URL-safe server-issued values
- invalid cursors return a safe `400`
- reads do not create read receipts
- reads do not persist last-read cursors
- reads do not track views

## Isolation Contract

Message reads are presentation-only. They cannot affect:

- billing
- owner entitlement
- server ownership
- Store purchases
- live checkout
- Supporter Cards
- rankings
- discovery score
- reviews or review score
- badges
- seasons
- events
- Server Wars scoring
- CTF scoring
- XP awards
- calling-card awards
- public profile visibility
- retained exports
- analytics/tracking
- DZN Assist AI state
- moderation decisions outside already-stored message visibility
- competitive eligibility

Starter, Pro, legacy Premium, Network, and Partner plan values do not alter visibility, ordering, page size, retention, private group access, current-user state, fallback behavior, or author display treatment.

## Still Blocked

Still blocked after this slice:

- runtime chat sending
- runtime emoji reactions
- report routes
- moderation mutation routes
- staff-only message reading
- DZN Assist AI runtime
- support transcript persistence
- Durable Objects
- WebSockets
- real-time fanout
- analytics/tracking
- vector stores
- AI provider credentials
- metered model calls
- Store order or payment changes
- Store webhook changes
- account entitlement writes
- Supporter Card changes
- earned spins
- reward wheel runtime
- live checkout activation
- Stripe Product/Price mutation
- Cloudflare secret/config mutation
- production D1 migration apply or write
- Nitrado mutation
- Discord mutation
- retained export changes
- deployment to `https://dayz-network.com/`
- issue #49 changes

Live checkout remains disabled. Issue #49 remains reserved for final live payment activation.

## Rollback

Rollback is source-level and flag-level:

- keep `DZN_COMMS_MESSAGE_READ_ENABLED` disabled
- keep `DZN_COMMS_MESSAGE_READ_LOCAL_TEST_RUNTIME` unset or false
- keep `DZN_COMMS_PUBLIC_CHANNEL_HISTORY_ENABLED` disabled
- keep `DZN_COMMS_PRIVATE_GROUP_HISTORY_ENABLED` disabled
- keep `NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED` disabled
- keep `/community` rendering static mock data

No unrelated player, owner, billing, Store, review, event, progression, public profile, retained export, presence, Nitrado, Discord, Stripe, Cloudflare, or competitive data should be deleted during rollback.

## Next Recommended Slice

Next should be DZN Comms message-history UI integration approval preflight: define whether `/community` may fetch the local/test read-only route behind `NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED`, how fallback/error states should render, and how reviewers prove the UI still cannot send messages, create reactions, report/moderate, call DZN Assist AI, use Durable Objects/WebSockets, track analytics, alter Store/payment/live checkout, mutate production services, change retained exports, or affect competitive systems. Only after that UI contract is approved should a UI integration slice be implemented.
