# DZN Comms Message/Read Model Approval Preflight

## Scope

This slice is message/read model approval preflight only.

It defines the safe, read-only message-history contract that DZN Comms must satisfy before any runtime message history, reaction embedding, private group chat, moderation queue, support chat, WebSocket, Durable Object, AI support bot, or message persistence implementation begins.

This preflight exists because `docs/DZN_COMMS_REACTION_RUNTIME_IMPLEMENTATION_APPROVAL_PREFLIGHT.md` made message/read authorization a prerequisite for any real emoji reaction runtime. The selected repository base did not contain an approved DZN Comms message/read runtime, so this slice defines that prerequisite first.

No runtime chat APIs are added. No message read route is added. No message send route is added. No message, membership, moderation, reaction, report, support, vector, AI, analytics, payment, or retained-export table is added. No migration is added. No Durable Objects or WebSockets are added. No persistence is added. No analytics/tracking is added. No AI provider credentials, vector stores, or metered model calls are added. No Store, Supporter Card, live checkout, Stripe, Cloudflare, production D1, Nitrado, Discord, retained export, deployment, or issue #49 mutation is added.

The existing `/community` route remains a static visual shell using local mock data and disabled/non-sending composer controls.

## Approved First Runtime Shape

The first future DZN Comms message/read runtime slice should be disabled by default and local/test-only.

That future implementation may only:

- Read an approved page of visible message history for a public DZN Comms channel that the requester may read.
- Read an approved page of visible message history for a private group only when the requester has trusted DZN user ID bridge membership.
- Return public-safe display fields for visible messages.
- Return safe tombstones for hidden/deleted/expired messages only if the final implementation chooses tombstones instead of omission.
- Return no-store authenticated/private responses.
- Support deterministic cursor pagination.
- Keep the existing static `/community` mock shell as fallback when flags are disabled or the route is unavailable.

That future implementation must not:

- Send messages.
- Create moderation mutation routes.
- Create report mutation routes.
- Create emoji reaction routes.
- Create DZN Assist runtime or AI support responses.
- Store private support transcripts.
- Create real-time fanout.
- Create public online member lists.
- Expose raw ledgers, private identifiers, or moderation evidence.
- Touch billing, Store, Supporter Cards, Nitrado, Discord, Stripe, Cloudflare, production D1, retained exports, deployment, or issue #49.

## Exact Future Read Route

The approved first message/read route set is limited to one read-only route:

```text
GET /api/dzn-comms/channels/:channelId/messages
```

Approved query parameters:

| Parameter | Direction |
| --- | --- |
| `cursor` | Optional opaque server-issued cursor. Clients must not build meaning from it. |
| `limit` | Optional page size. Default 25, maximum 50. |
| `direction` | Optional `older` or `newer`. Default is implementation-defined but must be deterministic. |

Blocked route families:

- `POST /api/dzn-comms/messages`
- `POST /api/dzn-comms/channels/:channelId/messages`
- `PATCH /api/dzn-comms/messages/:messageId`
- `DELETE /api/dzn-comms/messages/:messageId`
- `GET /api/dzn-comms/messages/:messageId/reactions`
- `POST /api/dzn-comms/messages/:messageId/reactions`
- `DELETE /api/dzn-comms/messages/:messageId/reactions/:reactionKey`
- `POST /api/dzn-comms/reports`
- `POST /api/dzn-comms/moderation/*`
- `PATCH /api/dzn-comms/moderation/*`
- `DELETE /api/dzn-comms/moderation/*`
- Any support bot, AI, vector, WebSocket, Durable Object, Store, billing, checkout, retained-export, Nitrado, Discord, or production mutation route.

The route may not include live reaction summaries until the reaction runtime is separately implemented under `docs/DZN_COMMS_REACTION_RUNTIME_IMPLEMENTATION_APPROVAL_PREFLIGHT.md`. Until then, any reaction chips remain static mock presentation or omitted.

## Public Channel Read Contract

Approved public DZN Comms channel identifiers for the first future runtime:

- `global`
- `new-players`
- `server-owners`
- `events`

Rules:

- Logged-in free Discord players may read visible public-channel messages when message-read flags are enabled.
- Starter and Pro are not required for player/community message reads.
- Starter and Pro must not change page size, ordering, retention, visibility, moderation state, reaction summary eligibility, rate limits, or fallback behavior.
- Visitors may see the existing static mock `/community` shell, but authenticated live message-history reads are not approved for visitors in the first runtime slice.
- Any later anonymous/public live read mode requires a separate privacy review because it would remove the `Vary: Cookie` and current-user authorization boundary.

## Private Group Read Contract

Private group reads require trusted membership proof on every request.

Allowed future membership proof sources:

- A trusted DZN user ID bridge row in `community_members` when that row is explicitly approved for chat membership.
- An approved private-group membership row created by an authorized owner/admin flow.
- A future server-linked staff/moderator bridge row tied to linked-server ownership, only after a dedicated owner/admin group-management slice approves it.

Forbidden membership proof sources:

- Discord display name.
- Gamertag.
- Public profile handle.
- Review author text.
- Event display name.
- Server card author fields.
- Browser cookie fields that do not resolve to a canonical DZN user.
- Client-submitted `userId`, `discordId`, `ownerId`, `serverId`, role, plan, or entitlement.

Private group read rules:

- The server resolves the current session to the canonical internal DZN user ID.
- The server resolves the group by server-controlled `channelId`.
- The server verifies active group membership for that user and channel before reading any message.
- Cross-owner, cross-group, no-match, duplicate-match, ambiguous-user, expired-membership, removed-member, and pending-invite reads are denied.
- Owner entitlement alone is not private group membership.
- Pro does not grant private group visibility outside the same membership proof.

## Message Visibility States

The future runtime must treat message visibility as server-authoritative.

| State | Reader behavior |
| --- | --- |
| `visible` | Body may be returned to authorized readers with public-safe author fields. |
| `locked` | Body may be returned if readable, but lock state must not imply write access because this route is read-only. |
| `hidden` | Body must not be returned to normal players. A safe tombstone may be returned only if approved by implementation tests. |
| `deleted` | Body must not be returned. A safe deleted tombstone may be returned only if approved by implementation tests. |
| `quarantined` | Body must not be returned to normal players or owners. Staff-only read needs a separate moderation implementation approval. |
| `expired` | Body must not be returned unless the approved retention model explicitly keeps safe tombstones. |
| `staff_only` | Body requires separately approved DZN admin/moderator scope and is out of scope for the first runtime. |
| `unavailable` | Route returns `404`, `403`, or a safe empty state without leaking whether private content exists. |

Rejected send attempts, profanity-blocked bodies, timeout-triggering bodies, spam-filtered bodies, private support prompts, AI support answers, moderation notes, report notes, and raw evidence are not message history. They must not be returned by this route.

## Response Contract

Future successful response shape:

```json
{
  "channel": {
    "id": "global",
    "type": "public",
    "label": "Global Chat",
    "scope": "dzn-public",
    "readOnly": true
  },
  "messages": [
    {
      "id": "msg_01",
      "visibility": "visible",
      "createdAt": "2026-08-31T10:12:00.000Z",
      "author": {
        "displayName": "Rafael DZN",
        "roleLabel": "Owner",
        "avatarInitials": "RD",
        "profileHref": "/players/rafael-dzn-a1b2c"
      },
      "body": "Welcome everyone.",
      "replyToMessageId": null,
      "presentation": {
        "kind": "user_message"
      }
    }
  ],
  "page": {
    "nextCursor": "opaque-cursor",
    "hasMore": true,
    "limit": 25
  },
  "status": "ok"
}
```

Author rules:

- Public-safe display author fields only.
- `displayName` must be a public-safe display value.
- `roleLabel` must be presentation-only and must not expose billing plan, hidden admin state, or owner entitlement internals.
- `avatarInitials` or public avatar URL may be returned only when already approved as public-safe.
- `profileHref` may be returned only when the user has a generated public profile handle and the relevant profile visibility settings allow public attribution.
- Raw internal user IDs, Discord IDs, Discord OAuth tokens, hidden profile fields, private email, private account identifiers, billing customer IDs, Nitrado IDs, owner entitlement IDs, IP addresses, user agents, referrers, route history, and raw moderation evidence must not be returned.

Message body rules:

- The route returns only accepted, visible message bodies.
- Deleted, hidden, quarantined, expired, rejected, blocked, private support, and staff-only bodies stay unavailable to normal message-history readers.
- The response must not include submitted filter text, rejected text, moderation notes, report notes, support prompts, support bot source snippets, or AI answer drafts.

HTTP/cache rules:

- Authenticated or private responses must send `Cache-Control: no-store`.
- Authenticated or private responses must send `Vary: Cookie`.
- Public fallback/static shell responses may remain static, but must not include current-user state.
- Errors must not leak private group names, membership details, hidden bodies, moderation evidence, or whether a specific private message exists.

## Storage And Migration Model

This preflight adds no migration.

The future local/test-only implementation may propose these message-read storage entities in a dedicated later PR:

```text
dzn_comms_channels
dzn_comms_channel_memberships
dzn_comms_messages
dzn_comms_message_visibility_events
```

The first message/read storage model must remain read-focused. It may seed local/test messages or expose already-approved server-authored messages, but it must not create send persistence, support transcript persistence, moderation action persistence, report persistence, reaction persistence, analytics persistence, public member-online lists, AI source stores, vector indexes, Store/payment rows, retained-export rows, XP award rows, calling-card award rows, ranking rows, discovery rows, review score rows, event result rows, CTF rows, Server Wars rows, Nitrado rows, Discord mutation rows, or production D1 rows.

Blocked tables in the first message/read implementation:

- `dzn_comms_message_reactions`
- `dzn_comms_reaction_mutations`
- `dzn_comms_message_reports`
- `dzn_comms_moderation_actions`
- `dzn_comms_warning_timeouts`
- `dzn_comms_support_sessions`
- `dzn_comms_support_messages`
- `dzn_comms_ai_sources`
- `dzn_comms_ai_embeddings`
- `dzn_comms_analytics_events`
- Any Store, billing, supporter-card, earned-spin, reward-wheel, retained-export, ranking, discovery, review-score, badge, season, event-result, CTF, Server Wars, XP, calling-card, Nitrado, or Discord mutation table.

## Feature-Flag Defaults

Future flags are design-only in this preflight. They must not be added to production configuration, Cloudflare secrets, Wrangler config, environment examples, or runtime code by this slice.

Approved future flag names:

- `DZN_COMMS_MESSAGE_READ_ENABLED=false`
- `DZN_COMMS_MESSAGE_READ_LOCAL_TEST_RUNTIME=false`
- `DZN_COMMS_PUBLIC_CHANNEL_HISTORY_ENABLED=false`
- `DZN_COMMS_PRIVATE_GROUP_HISTORY_ENABLED=false`
- `NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED=false`

Rules:

- All flags default disabled.
- The local/test runtime flag must be required for local seeded reads.
- The public-channel history flag controls live reads for the approved public channels.
- The private-group history flag controls private group reads and must require membership checks.
- The UI flag controls whether the client tries the future read route or stays on static mock data.
- Enabling a read flag must not enable send, reaction write, report write, moderation write, AI support, WebSocket, Durable Object, analytics/tracking, Store checkout, live checkout, Stripe, Cloudflare, production D1, Nitrado, Discord, retained export, deployment, or issue #49 behavior.

## Mock-To-Real Transition

The static DZN Comms visual shell remains the product-facing reference until the real runtime is approved.

Future transition rules:

- With UI and server read flags disabled, `/community` must use the static local mock message list and disabled composer.
- With UI flag enabled but server flag disabled, the client must show the static fallback or a safe unavailable state without repeated noisy retries.
- With server flag enabled in local/test only, the client may fetch the approved read-only history route.
- Runtime responses must be treated as read-only; the composer remains disabled until a separate send runtime slice is approved.
- Mock messages must be visually distinguishable in development/test evidence so reviewers do not confuse them with production chat.
- The first implementation must include tests proving runtime message reads are not active in production defaults.
- No static mock content may become a support-bot source document, analytics event, moderation record, ranking signal, review signal, XP source, calling-card source, Store entitlement, or competitive input.

## No-Store Private Response Rules

Authenticated message-history responses can include current-user/private access results, so they must be cache-safe.

Required rules:

- `Cache-Control: no-store` on every authenticated or private message-history response.
- `Vary: Cookie` on every authenticated or private message-history response.
- No `Set-Cookie` from read-only message history unless a separate auth system already requires it.
- No read receipts in the first implementation.
- No last-read cursor persistence in the first implementation.
- No per-message view tracking.
- No analytics/tracking call.
- No owner/admin export of message reads.
- No retained export path.

## Isolation Contract

Message reads are presentation only.

They must not calculate, return, update, join against, or influence:

- Billing.
- Owner entitlement.
- Server ownership.
- Store purchases.
- Supporter Card state.
- Live checkout.
- Rankings.
- Discovery score.
- Reviews.
- Review score.
- Badges.
- Seasons.
- Events.
- Server Wars scoring.
- CTF scoring.
- XP awards.
- Calling-card awards.
- Public profile visibility.
- Retained exports.
- Analytics/tracking.
- AI support state.
- Moderation decisions outside separately approved message visibility reads.
- Competitive eligibility.

Starter, Pro, legacy Premium, Network, and Partner plan values must not alter message read visibility, ordering, page size, retention, private group access, current-user state, fallback behavior, or author display treatment. Existing plan normalization remains billing/customer-tooling only.

## Rollout Plan

Required sequence:

1. Keep this approval preflight as docs/tests only.
2. Add a disabled-by-default local/test-only message/read implementation PR using this contract.
3. Add only the approved local/test message-read schema after migration numbering is rechecked.
4. Add the read-only route with no send, report, reaction, moderation, support-bot, AI, analytics, or production behavior.
5. Add UI integration only behind `NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED`.
6. Keep `/community` on static mock fallback when flags are disabled.
7. Run the proof matrix before any merge.
8. Only after message/read runtime is approved and merged may reaction runtime proceed under its separate approval preflight.

## Rollback Plan

Rollback must be simple:

- Turn off `NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED`.
- Turn off `DZN_COMMS_MESSAGE_READ_ENABLED`.
- Turn off `DZN_COMMS_PUBLIC_CHANNEL_HISTORY_ENABLED`.
- Turn off `DZN_COMMS_PRIVATE_GROUP_HISTORY_ENABLED`.
- Keep `/community` rendering the static mock visual shell.
- Leave presence, player profiles, billing, owner tools, Store pages, reviews, events, XP, calling cards, badges, seasons, CTF, Server Wars, retained exports, Nitrado, Discord, Stripe, Cloudflare, production D1, and issue #49 untouched.

Rollback must not delete unrelated player, owner, billing, Store, review, event, progression, public profile, retained export, presence, or competitive data.

## Proof Matrix

Before any message/read runtime implementation PR is mergeable, it must prove:

- With all message-read flags disabled, no runtime history is fetched and `/community` renders the static safe fallback.
- Logged-out visitors do not receive authenticated/current-user/private message history.
- Free logged-in Discord players can read visible public-channel messages when local/test flags are enabled.
- Starter and Pro do not alter message visibility, ordering, page size, retention, fallback, author display, or private group access.
- Legacy Premium, Network, and Partner values normalize only through existing customer-plan behavior and do not alter message reads.
- Private group reads require trusted DZN user ID bridge membership.
- Cross-owner, cross-group, ambiguous-user, duplicate-match, removed-member, expired-membership, pending-invite, and no-match private reads are denied.
- Hidden messages do not expose bodies to normal players.
- Deleted messages do not expose bodies to normal players.
- Quarantined messages do not expose bodies to normal players or owners.
- Expired messages do not expose bodies unless an approved tombstone policy explicitly allows safe metadata.
- Staff-only messages remain blocked until a separate moderator/admin read approval exists.
- Rejected, blocked, profanity-filtered, spam-filtered, timeout-triggering, support-prompt, support-answer, moderation-note, and report-note bodies are not returned.
- Responses expose no raw Discord IDs, OAuth tokens, internal DZN user IDs, hidden profile fields, private emails, billing identifiers, owner entitlement state, Nitrado identifiers, IP addresses, user agents, referrers, route history, moderation evidence, report details, support transcripts, retained exports, or raw ledger rows.
- Authenticated/private responses include `Cache-Control: no-store` and `Vary: Cookie`.
- Cursors are opaque and bounded to a maximum page size of 50.
- Message reads create no read receipts, last-read rows, analytics events, tracking events, AI calls, vector writes, support-source documents, moderation decisions, export artifacts, Store orders, entitlements, supporter cards, earned spins, or wheel state.
- Message reads cannot affect billing, owner entitlement, server ownership, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars scoring, CTF scoring, XP awards, calling-card awards, public profile visibility, retained exports, analytics/tracking, AI, live checkout, production systems, or competitive eligibility.
- The implementation does not create chat send APIs, reaction APIs, support chat APIs, DZN Assist AI routes, Durable Objects, WebSockets, vector stores, metered model calls, live checkout activation, Stripe mutation, Cloudflare secret/config mutation, production D1 writes, Nitrado mutation, Discord mutation, deployment, retained export changes, or issue #49 changes.

## Live-Site Boundary

This preflight can be committed and opened as a PR, but it does not deploy to `https://dayz-network.com/`.

Only report message history as live after a later approved implementation PR is merged, deployed, and verified on the production URL.

## Next Recommended Slice

Next should be DZN Comms message/read model local/test implementation foundation, only if deliberately approved: add the disabled-by-default local/test read-only message-history route and approved schema from this preflight, keep `/community` on static fallback unless flags are enabled, prove public-channel reads and private group membership checks, and still avoid chat sending, reaction runtime, report routes, moderation mutations, DZN Assist AI runtime, Durable Objects/WebSockets, analytics/tracking, Store/payment changes, live checkout, Stripe/Cloudflare/production D1/Nitrado/Discord mutations, retained exports, deployment, or issue #49 changes.
