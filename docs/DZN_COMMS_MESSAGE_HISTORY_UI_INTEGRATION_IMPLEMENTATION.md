# DZN Comms Message-History UI Integration Implementation

## Scope

This slice wires the `/community` DZN Comms visual shell to optionally fetch the approved read-only message-history route while staying disabled by default.

Implemented optional route usage:

```text
GET /api/dzn-comms/channels/:channelId/messages
```

The implementation is client-side presentation only. It adds no chat runtime, no message persistence, no reaction runtime, no report route, no moderation mutation, no DZN Assist AI runtime, no Durable Objects/WebSockets, no analytics/tracking, no Store/payment/live checkout changes, no production mutations, and no retained exports.

Live checkout remains disabled. Issue #49 remains reserved for final live payment activation.

## Feature Flag

The `/community` UI fetch is controlled by:

```text
NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED
```

It is disabled by default. Only the exact normalized value `true` enables the client-side read attempt. Empty, absent, false, numeric, or malformed values keep `/community` on the static fallback and do not call the message-history route.

The server route remains separately disabled by default through:

```text
DZN_COMMS_MESSAGE_READ_ENABLED=false
DZN_COMMS_MESSAGE_READ_LOCAL_TEST_RUNTIME=false
DZN_COMMS_PUBLIC_CHANNEL_HISTORY_ENABLED=false
DZN_COMMS_PRIVATE_GROUP_HISTORY_ENABLED=false
```

The UI flag alone cannot unlock message history. Server-side auth, channel flags, local/test runtime flags, public-channel reads, and private group denial remain enforced by the canonical message-read route.

## Client Fetch Contract

The new client helper is `components/community/dzn-comms-message-history.ts`.

Allowed request behavior:

- Use same-origin URLs under `/api/dzn-comms/channels`.
- Use `method: "GET"` only.
- Include credentials through the normal browser session cookie.
- Use `Accept: application/json`.
- Use `cache: "no-store"`.
- Use an `AbortController` timeout.
- Cap accepted payload text at `128000` bytes.
- Store fetched messages only in the mounted React page state.
- Render static fallback when disabled, unavailable, denied, malformed, overlarge, timed out, or unauthenticated.

Allowed channel mapping:

| UI surface key | Route channel id |
| --- | --- |
| `global` | `global` |
| `new_players` | `new-players` |
| `server_owners` | `server-owners` |
| `events` | `events` |
| `pandora_squad` | `pandora-squad` |
| `support` | no message-history fetch |

Support remains static. The support panel does not fetch stored history and does not call DZN Assist.

## Payload Validation

The UI renders only a validated message-history payload with:

- `ok: true`
- `status: "ok"`
- `private: true`
- `cache: "no-store"`
- valid generated timestamp
- `channel.readOnly: true`
- channel type `public` or `private_group`
- at most 25 messages
- valid pagination metadata
- explicit safety flags proving the response is read-only and no-effect

Each rendered message must have:

- safe message id
- `visible` or `locked` visibility only
- valid created timestamp
- sanitized author display name
- approved role label or `null`
- uppercase alphanumeric avatar initials
- `profileHref: null`
- public-safe body text
- message kind `user_message`, `system_notice`, `pinned_guidance`, or `safety_notice`

The UI rejects hidden messages, malformed author data, unsupported roles, unsafe message ids, unexpected message kinds, non-null profile links, missing safety flags, or any payload that claims billing, ranking, discovery, review, badge, season, event, Server Wars, CTF, XP, calling-card, public-profile, retained-export, or competitive eligibility effects.

## UI Behavior

`/community` still renders `DznCommsVisualShell`.

When the UI flag is disabled:

- no request is made
- static local mock messages stay visible
- the static DZN Comms prototype marker stays visible
- the disabled composer remains disabled
- static emoji reaction previews remain static

When the UI flag is enabled:

- supported public and private surfaces enter a loading state
- the helper requests the matching read-only message-history channel
- valid successful payloads replace only the active feed messages
- loaded rows show a compact `Read-only` badge
- `locked` rows show a compact `Locked` badge
- failures keep the static fallback and show a compact status banner

The fallback states are:

| Reason | Behavior |
| --- | --- |
| `client-flag-disabled` | Static fallback with no request |
| `support-static` | Static support preview with no request |
| `invalid-cursor` | Static fallback, retry allowed |
| `login-required` | Static fallback, no retry pressure |
| `private-denied` | Static fallback, no private bodies |
| `disabled-or-not-configured` | Static fallback, no retry pressure |
| `unavailable` | Static fallback, retry allowed |
| `timeout` | Static fallback, retry allowed |
| `network-error` | Static fallback, retry allowed |
| `malformed-response` | Static fallback, retry allowed |
| `overlarge-response` | Static fallback, retry allowed |

The composer remains disabled and keeps the explicit copy:

```text
Composer disabled in this static prototype - no messages are sent or stored.
```

## Access Matrix

| Actor | Public-channel reads | Private group reads | Writes |
| --- | --- | --- | --- |
| Logged-out visitor | Static fallback unless the route rejects with login-required; no payment prompt | Denied by route; static fallback only | Denied |
| Free Discord player | Visible public-channel messages only when client and server local/test flags are enabled | Active trusted `dzn_comms_channel_memberships` membership required | Denied |
| Starter owner | Same as free player; no paid read advantage | Same trusted membership requirement | Denied |
| Pro or legacy effective Pro owner | Same as Starter; no paid read advantage | Same trusted membership requirement | Denied |
| DZN admin/moderator | Same as normal player unless a future staff-read slice is approved | Same trusted membership requirement unless a future staff-read slice is approved | Denied |

Public-channel reads remain free logged-in player access. Owner entitlement, Starter, Pro, legacy Premium, legacy Network, and legacy Partner plan values do not change message visibility, ordering, page size, author display, retry behavior, private membership, fallback behavior, retention, moderation immunity, or competitive eligibility.

Private group denial is server-owned. The UI never accepts client-submitted user IDs, Discord IDs, owner IDs, server IDs, display names, gamertags, public handles, billing plans, or owner entitlement as proof of private group membership.

## Protected Boundaries

No chat sending.
No runtime reactions.
No report routes.
No moderation mutations.
No DZN Assist AI runtime.
No Durable Objects/WebSockets.
No analytics/tracking.
No Store/payment/live checkout changes.
No production mutations.
No retained exports.

This slice creates no browser storage, read receipts, last-read records, route-history rows, support transcripts, notifications, moderation rows, retained export files, Store orders, Store entitlements, Supporter Cards, earned spins, reward-wheel state, Stripe sessions, Cloudflare config, production D1 writes, Nitrado mutations, Discord mutations, deployment, or issue #49 changes.

The message-history UI cannot affect billing, owner entitlement, server ownership, scoring, rankings, discovery, reviews, badges, seasons, events, Server Wars, CTF, XP awards, calling-card awards, public profile visibility, retained exports, or competitive eligibility.

## Rollback

Rollback is flag-level and source-level:

- Keep `NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED` disabled.
- Keep `DZN_COMMS_MESSAGE_READ_ENABLED` disabled.
- Keep `DZN_COMMS_MESSAGE_READ_LOCAL_TEST_RUNTIME` unset or false.
- Keep `DZN_COMMS_PUBLIC_CHANNEL_HISTORY_ENABLED` disabled.
- Keep `DZN_COMMS_PRIVATE_GROUP_HISTORY_ENABLED` disabled.
- Revert `components/community/dzn-comms-message-history.ts` and the `/community` shell integration if source rollback is needed.

No player, owner, billing, Store, review, event, progression, public profile, retained export, presence, Nitrado, Discord, Stripe, Cloudflare, production D1, or competitive data should be deleted during rollback.

## Proof

This slice adds:

- `components/community/dzn-comms-message-history.ts`
- guarded `/community` integration inside `components/community/dzn-comms-visual-shell.tsx`
- `npm run test:dzn-comms-message-history-ui-integration`

The focused proof covers disabled-by-default behavior, public-channel reads, private group denial, same-origin GET-only fetch shape, no-store credentials behavior, support static behavior, fallback handling, payload validation, no unsafe profile links, no hidden messages, no unsafe safety flags, package wiring, bounded changed paths, and no mutation/runtime-provider patterns.

## Next Recommended Slice

Next should be DZN Comms message-history rendered local/test QA: run a local flagged preview with controlled seeded public and private-group responses, capture the `/community` static-disabled, public-history-success, private-denied, login-required, unavailable, and support-static states, and prove the rendered UI still cannot send messages, add reactions, report/moderate, call DZN Assist AI, use Durable Objects/WebSockets, track analytics, alter Store/payment/live checkout, mutate production services, change retained exports, or affect competitive systems.

## Rendered QA Follow-Up

The DZN Comms Message-History Rendered Local/Test QA slice is now documented in `docs/DZN_COMMS_MESSAGE_HISTORY_RENDERED_QA.md`.

That follow-up captures local/test `/community` desktop and mobile proof for static fallback, public-channel read, login-required fallback, unavailable route fallback, private-group denial, and support-static/no-request fallback while keeping chat sending, runtime reactions, report routes, moderation mutations, DZN Assist AI runtime, Durable Objects/WebSockets, analytics/tracking, Store/payment/live checkout, production mutations, retained exports, deployment, and competitive-system effects blocked.
