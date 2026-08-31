# DZN Comms Message-History UI Integration Approval Preflight

## Scope

This slice is message-history UI integration approval preflight only.

It decides that `/community` may later read the approved local/test message-history route only when the client UI flag and the server read flags are explicitly enabled. This slice does not implement that UI fetch.

Approved future route:

```text
GET /api/dzn-comms/channels/:channelId/messages
```

The future UI integration must stay read-only. It must not send messages, add reactions, report/moderate messages, call DZN Assist AI, use Durable Objects/WebSockets, track analytics, alter Store/payment/live checkout, mutate production services, change retained exports, or affect competitive systems.

The `/community` route remains on the static local mock-data shell in this preflight.

## Decision

`/community` may fetch message history in a later implementation slice only when all of these are true:

- `NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED=true`
- `DZN_COMMS_MESSAGE_READ_ENABLED=true`
- `DZN_COMMS_MESSAGE_READ_LOCAL_TEST_RUNTIME=local` or `test`
- `DZN_COMMS_PUBLIC_CHANNEL_HISTORY_ENABLED=true` for public channels
- `DZN_COMMS_PRIVATE_GROUP_HISTORY_ENABLED=true` for private groups

All flags default disabled. No Wrangler config, Cloudflare secret, production variable, production D1 database, or deployment is changed by this preflight.

When the client flag is absent, false, malformed, or not bundled into the page as `true`, the UI must not call the message-history route. It must render the current static DZN Comms shell and disabled composer.

## Channel Mapping

The future UI channel mapping is explicit:

| UI surface key | Future route channel id |
| --- | --- |
| `global` | `global` |
| `new_players` | `new-players` |
| `server_owners` | `server-owners` |
| `events` | `events` |
| `pandora_squad` | `pandora-squad` |
| `support` | no message-history fetch |

The support surface stays static until a separate DZN Assist support-bot runtime approval defines provider, source policy, logging, cost controls, refusal behavior, and rollback.

## Fetch Contract

The future `/community` client may call only:

```text
GET /api/dzn-comms/channels/:channelId/messages?limit=25
GET /api/dzn-comms/channels/:channelId/messages?limit=25&cursor=<opaque>&direction=older
GET /api/dzn-comms/channels/:channelId/messages?limit=25&cursor=<opaque>&direction=newer
```

Rules:

- Use same-origin requests.
- Include credentials only through the normal browser session cookie.
- Use `Accept: application/json`.
- Use `cache: "no-store"` or equivalent.
- Use an `AbortController` timeout, recommended maximum 5 seconds.
- Treat missing, malformed, overlarge, or unexpected payloads as unavailable.
- Never persist fetched messages to `localStorage`, `sessionStorage`, `IndexedDB`, Cache API, service workers, cookies, analytics events, or retained exports.
- Never create read receipts, last-read cursors, route-history rows, browsing-history rows, notification-read rows, or moderation rows from a message-history read.

The UI must never call POST, PUT, PATCH, or DELETE Comms endpoints in this slice family.

## UI States

The future implementation must render these states without changing the disabled composer or static safety controls:

| State | UI behavior |
| --- | --- |
| Client flag disabled | Keep current static mock messages and static prototype markers. No message-history request is made. |
| Loading | Keep the current shell mounted, show a compact loading/syncing state inside the active feed, and avoid layout shift. |
| Success | Render returned `visible` and `locked` messages only, using sanitized author display fields from the route. |
| 400 invalid cursor | Reset pagination for that channel and fall back to the first page or static messages. |
| 401 unauthenticated | Keep public static fallback and, where appropriate, show a calm login prompt for saved history. |
| 403 private group denied | Do not render private message bodies, private member names, hidden counts, or the denied channel's stored history. |
| 404 disabled/not configured | Treat as static fallback, not a site failure. |
| 503 unavailable | Treat as static fallback with no retry storm. |
| Network timeout/error | Treat as static fallback and allow manual retry only in the active page session. |
| Malformed response | Discard it and render static fallback. |

The fallback is the safety baseline, not an error state. The page must remain usable and non-sending.

## Access Matrix

| Actor | Public channel history | Private group history | Message send | Reaction runtime |
| --- | --- | --- | --- | --- |
| Logged-out visitor | Static fallback only | Denied | Denied | Static preview only |
| Free Discord player | Allowed for visible public messages only when all local/test flags are enabled | Active trusted membership required | Denied | Blocked until separate runtime approval |
| Starter owner | Same as free player; no paid read advantage | Same trusted membership requirement | Denied | No paid reaction advantage |
| Pro owner or legacy effective Pro | Same as Starter; no paid read advantage | Same trusted membership requirement | Denied | No paid reaction advantage |
| DZN admin/moderator | Same as normal player unless a later staff-read slice is approved | Same membership requirement unless a later staff-read slice is approved | Denied | Blocked until separate runtime approval |

Owner entitlement alone is not private group membership. Starter, Pro, legacy Premium, Network, and Partner plan values must not change message visibility, ordering, page size, fallback behavior, author display, private group access, reaction availability, moderation immunity, safety checks, retention, or competitive eligibility.

## Public-Safe Payload Rules

The UI may render only fields already returned by the approved message-read route:

- message id
- created timestamp
- message kind
- `visible` or `locked` visibility
- sanitized body
- sanitized display author name
- approved role label
- avatar initials
- `profileHref: null` until a later attribution slice re-checks saved public-profile preferences

The UI must not render raw DZN user IDs, Discord IDs, OAuth tokens, private emails, hidden profile fields, private profile handles, billing identifiers, owner entitlement identifiers, Stripe identifiers, Nitrado identifiers, IP addresses, user agents, referrers, route history, moderation evidence, report notes, support prompts, support answers, retained export rows, raw award evidence, or raw ledger rows.

## Error And Fallback Copy

Future copy should be compact and DZN-specific:

- `Static preview active`
- `Saved history unavailable`
- `Log in to read saved history`
- `Private group history unavailable`
- `History timed out. Static preview shown.`

Do not use alarming copy for disabled local/test flags. The default disabled state is expected.

## Still Blocked

Still blocked after this preflight:

- UI message-history fetch implementation
- chat sending
- runtime emoji reactions
- report routes
- moderation mutation routes
- DZN Assist AI runtime
- support transcript persistence
- Durable Objects
- WebSockets
- real-time fanout
- analytics/tracking
- provider credentials
- vector stores
- metered model calls
- Store/payment changes
- account entitlement writes
- Supporter Card changes
- earned spins
- reward wheel runtime
- live checkout activation
- Stripe Product/Price/customer/webhook/refund/dispute mutation
- Cloudflare secret/config mutation
- production D1 migration apply or write
- Nitrado mutation
- Discord mutation
- retained export changes
- deployment to `https://dayz-network.com/`
- issue #49 changes

Live checkout remains disabled. Issue #49 remains reserved for final live payment activation.

## Proof Requirements

This preflight's proof must show:

- `/community` still renders `DznCommsVisualShell`.
- The Comms visual shell still uses static local mock data.
- The disabled composer still cannot send.
- No UI code calls `GET /api/dzn-comms/channels/:channelId/messages` yet.
- No UI code references `NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED` yet.
- The approved server message-read route remains GET-only and disabled by default.
- No message send, reaction, report, moderation, support, or DZN Assist runtime route is added.
- No Comms UI writes to browser storage, analytics, tracking, Store/payment, billing, owner entitlement, scoring, rankings, reviews, badges, seasons, Server Wars, CTF, XP, calling-card awards, public profile visibility, retained exports, or competitive eligibility.
- No migration, Cloudflare config, Cloudflare secret, production D1, Stripe, Nitrado, Discord, deployment, retained-export, live checkout, or issue #49 change is made.

## Rollback

Rollback remains flag-level and source-level:

- keep `NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED` disabled
- keep `DZN_COMMS_MESSAGE_READ_ENABLED` disabled
- keep `DZN_COMMS_MESSAGE_READ_LOCAL_TEST_RUNTIME` unset or false
- keep `DZN_COMMS_PUBLIC_CHANNEL_HISTORY_ENABLED` disabled
- keep `DZN_COMMS_PRIVATE_GROUP_HISTORY_ENABLED` disabled
- keep `/community` on static local mock data

No player, owner, billing, Store, review, event, progression, public profile, retained export, presence, Nitrado, Discord, Stripe, Cloudflare, production D1, or competitive data should be deleted during rollback.

## Next Recommended Slice

Next should be the DZN Comms message-history UI integration implementation: wire `/community` to optionally fetch `GET /api/dzn-comms/channels/:channelId/messages` only behind `NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED` plus the disabled-by-default server read flags, keep static fallback as the default and failure path, preserve the disabled composer, and continue blocking chat sending, runtime reactions, report routes, moderation mutations, DZN Assist AI runtime, Durable Objects/WebSockets, analytics/tracking, Store/payment/live checkout changes, production mutations, retained exports, and competitive-system effects.
