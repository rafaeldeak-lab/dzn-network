# DZN Comms Reaction Runtime Implementation Approval Preflight

## Scope

This slice is reaction-runtime approval preflight only.

It decides the future runtime route set, storage/migration model, feature-flag defaults, message-read prerequisites, idempotency/concurrency behavior, rate limits, moderation scope, retention model, rollout/rollback plan, and proof matrix for DZN Comms emoji reactions before any real reaction runtime is implemented.

No runtime reaction APIs are added. No runtime chat send APIs are added. No message tables are added. No reaction tables are added. No migrations are added. No Durable Objects/WebSockets are added. No persistence is added. No analytics/tracking is added. No AI provider credentials, vector stores, or metered model calls are added. No Store, Supporter Card, live checkout, Stripe, Cloudflare, production D1, Nitrado, Discord, retained export, deployment, or issue #49 mutation is added.

This preflight builds on `docs/DZN_COMMS_REACTION_INTERACTION_CONTRACT_PREFLIGHT.md`. The static `/community` shell may continue to show local mock emoji reaction chips, but those chips remain display-only and do not send, store, track, moderate, or persist anything.

## Approved First Runtime Shape

The first future reaction runtime slice should be a disabled-by-default, local/test-only player reaction read/write implementation for already-readable DZN Comms messages.

That future implementation may include only:

- Reading reaction aggregates for a message the requester can already read.
- Adding the current user's own allowed reaction to a message the requester can already read.
- Removing the current user's own allowed reaction from a message the requester can already read.
- Embedding the same public-safe reaction summary into an already-approved message-history response.
- Returning current-user reaction state only to that current user.
- Computing counts server-side from trusted reaction state.

That future implementation must not create the general chat-send runtime. It must not create the first DZN Comms message table. It must not add private group runtime if private group messages are not already approved. It must not add owner/admin moderation mutation routes in the first reaction runtime PR. It must inherit message visibility and lock state from the approved DZN Comms message/read model.

If an approved DZN Comms message/read model does not exist yet, the next implementation step must be the message/read model approval slice, not reaction runtime.

## Exact Future Runtime Route Set

The approved future route set for the first reaction runtime PR is limited to:

```text
GET /api/dzn-comms/messages/:messageId/reactions
POST /api/dzn-comms/messages/:messageId/reactions
DELETE /api/dzn-comms/messages/:messageId/reactions/:reactionKey
```

The approved future message-history embedding point is:

```text
GET /api/dzn-comms/channels/:channelId/messages
```

The message-history route is a prerequisite owned by a separate DZN Comms message/read slice. The first reaction runtime PR may only add a reaction summary to that response after the message/read route already exists and is separately proven safe.

Blocked route families in the first reaction runtime PR:

- `POST /api/dzn-comms/messages`
- `POST /api/dzn-comms/channels/:channelId/messages`
- `PATCH /api/dzn-comms/messages/:messageId`
- `DELETE /api/dzn-comms/messages/:messageId`
- `POST /api/dzn-comms/reports`
- `POST /api/dzn-comms/moderation/*`
- `PATCH /api/dzn-comms/moderation/*`
- `DELETE /api/dzn-comms/moderation/*`
- Any support bot, AI, vector, WebSocket, Durable Object, Store, billing, or checkout route.

## Request And Response Contract

### Read Reactions

```text
GET /api/dzn-comms/messages/:messageId/reactions
```

Server checks:

1. Feature flag `DZN_COMMS_REACTIONS_READ_ENABLED` must be enabled in local/test only.
2. Resolve the optional requester session.
3. Resolve the message server-side by `messageId`.
4. Confirm the message belongs to an approved readable channel or private group.
5. Confirm the requester may read that message under the message/read model.
6. Exclude hidden, deleted, quarantined, locked-unreadable, unavailable, or expired messages.
7. Return only allow-listed aggregate counts and current-user booleans.

Response shape:

```json
{
  "messageId": "visible-message-id",
  "revision": "server-generated-reaction-revision",
  "availableReactions": [
    { "key": "rocket", "emoji": "U+1F680", "label": "Boost" }
  ],
  "counts": [
    {
      "key": "rocket",
      "emoji": "U+1F680",
      "label": "Boost",
      "count": 14,
      "currentUserReacted": true
    }
  ],
  "status": "ok"
}
```

### Add Reaction

```text
POST /api/dzn-comms/messages/:messageId/reactions
```

Request shape:

```json
{
  "clientMutationId": "client-generated-idempotency-key",
  "reactionKey": "rocket"
}
```

Server checks:

1. Feature flag `DZN_COMMS_REACTIONS_WRITE_ENABLED` must be enabled in local/test only.
2. Require a valid Discord-backed DZN session.
3. Resolve the actor to the canonical internal DZN user ID.
4. Resolve the message and channel server-side.
5. Confirm the actor may read the message before reacting.
6. Confirm private group membership with the trusted DZN user ID bridge when applicable.
7. Validate `reactionKey` against the server-controlled allow-list.
8. Reject client-supplied counts, actor IDs, Discord IDs, owner IDs, billing plan, score, rank, moderation state, or visibility state.
9. Apply rate limits before writing.
10. Apply idempotent create/toggle behavior inside the same transaction.
11. Return server-computed aggregate count and current-user state.

Response results:

| Result | Direction |
| --- | --- |
| `added` | New active reaction exists for the actor/message/key |
| `already_present` | The actor already had this active reaction; count was not inflated |
| `invalid_reaction` | The key is not allow-listed |
| `rate_limited` | The actor exceeded a reaction limit |
| `unauthenticated` | Login is required |
| `forbidden` | The actor cannot read or react to the message |
| `message_unavailable` | The message is unavailable for reactions |
| `disabled` | Reaction writes are disabled |

### Remove Reaction

```text
DELETE /api/dzn-comms/messages/:messageId/reactions/:reactionKey
```

Server checks:

1. Feature flag `DZN_COMMS_REACTIONS_WRITE_ENABLED` must be enabled in local/test only.
2. Require a valid Discord-backed DZN session.
3. Resolve the actor to the canonical internal DZN user ID.
4. Resolve the message and channel server-side.
5. Confirm the actor may read the message or may remove their own existing reaction from a newly unavailable message.
6. Validate `reactionKey` against the active allow-list or historical unavailable-key list.
7. Remove only the actor's own reaction.
8. Apply idempotent delete/toggle behavior inside the same transaction.
9. Return server-computed aggregate count and current-user state.

Response results:

| Result | Direction |
| --- | --- |
| `removed` | The actor's active reaction was removed |
| `already_absent` | The actor had no active reaction; count was not reduced below zero |
| `rate_limited` | The actor exceeded a reaction limit |
| `unauthenticated` | Login is required |
| `forbidden` | The actor cannot access this action |
| `message_unavailable` | The message cannot expose reactions |
| `disabled` | Reaction writes are disabled |

## Message Read Prerequisites

Reaction runtime depends on a separately approved message/read model.

Before reaction runtime can be implemented, DZN must already have:

- A canonical DZN Comms message identifier.
- A canonical channel or private-group identifier.
- A server-side message visibility state.
- A server-side channel visibility state.
- A trusted free-player session resolver.
- A trusted private-group membership resolver based on DZN user ID bridge membership.
- A server-side rule for hidden, deleted, quarantined, locked, archived, expired, and staff-only messages.
- A no-store authenticated/private message-history response.

The reaction runtime must call that message/read authorization path. It must not reimplement message visibility with looser rules.

Visitor behavior:

- Visitors may read public static mock reaction presentation only.
- Visitors must receive `401` or `403` on write attempts.
- Visitors must not receive `currentUserReacted: true`.

Logged-in player behavior:

- Free logged-in Discord players may add or remove their own allowed reactions on visible public-channel messages when flags are enabled.
- Starter and Pro plan state must not be required for personal reaction access.
- Private group reactions require trusted DZN user ID bridge membership.

## Storage And Migration Model

The future reaction runtime implementation may add only the reaction-specific storage below, and only in a dedicated later implementation PR.

No migration is added by this preflight.

Approved future tables:

```text
dzn_comms_message_reactions
dzn_comms_reaction_mutations
```

`dzn_comms_message_reactions` stores current reaction state:

- `id`
- `message_id`
- `actor_user_id`
- `reaction_key`
- `active`
- `created_at`
- `updated_at`
- `removed_at`
- `removed_reason`
- `moderation_state`

Required constraints:

- Unique row per `message_id`, `actor_user_id`, and `reaction_key`.
- `reaction_key` must be validated by application allow-list before write.
- `active` must be server controlled.
- `message_id` must reference the approved DZN Comms message model when that model exists.
- No Discord IDs.
- No IP addresses.
- No user agents.
- No referrers.
- No route histories.
- No billing/customer/order/payment identifiers.
- No Nitrado identifiers or tokens.
- No public profile handles.
- No hidden profile fields.

`dzn_comms_reaction_mutations` stores short-lived idempotency state:

- `id`
- `actor_user_id`
- `message_id`
- `reaction_key`
- `action`
- `client_mutation_hash`
- `result`
- `created_at`
- `expires_at`

Required constraints:

- Unique row per `actor_user_id`, `client_mutation_hash`, and `action`.
- `clientMutationId` must be hashed or scoped before storage.
- Rows must expire through the approved cleanup path.
- Mutation rows are not analytics.
- Mutation rows are not visible to owners or players.

Blocked in the first reaction runtime storage model:

- Chat message table creation.
- Message history table creation.
- Support transcript table creation.
- Message report table creation.
- Warning/timeout/mute table creation.
- Owner/admin reaction moderation audit table creation.
- Analytics tables.
- Retained export tables.
- Store/payment tables.
- XP/calling-card/badge/ranking/discovery/event/CTF/Server Wars writes.

## Feature-Flag Defaults

Future flags are design-only in this preflight. They must not be added to production configuration, Cloudflare secrets, Wrangler config, environment examples, or runtime code by this slice.

Approved future flag names:

- `DZN_COMMS_REACTIONS_READ_ENABLED=false`
- `DZN_COMMS_REACTIONS_WRITE_ENABLED=false`
- `DZN_COMMS_REACTIONS_LOCAL_TEST_RUNTIME=false`
- `DZN_COMMS_REACTIONS_MODERATION_ENABLED=false`
- `NEXT_PUBLIC_DZN_COMMS_REACTIONS_UI_ENABLED=false`

Rules:

- Read flag off means reaction APIs return disabled or not-found behavior and message history omits live reaction state.
- Write flag off means add/remove requests cannot write rows.
- Local/test runtime flag must be required for any sandbox writes before production approval.
- UI flag off means the client stays on static local mock chips or hides interactive affordances.
- Moderation flag off means no reaction moderation mutation route can run.
- Flag enablement must not enable chat message sending, live checkout, Store fulfilment, AI bot runtime, presence writes, retained exports, or production mutation.

## Idempotency And Concurrency

The future server must be the only source of reaction truth.

Add behavior:

- First add creates or reactivates the actor/message/key row.
- Repeated add with same active row returns `already_present`.
- Repeated add with the same `clientMutationId` returns the original result.
- Concurrent same-user adds for the same message/key produce exactly one active reaction.
- Count increments at most once for the actor/message/key.

Remove behavior:

- First remove marks only the actor/message/key row inactive.
- Repeated remove returns `already_absent`.
- Repeated remove with the same `clientMutationId` returns the original result.
- Concurrent removes cannot make aggregate counts negative.

Transaction requirements:

- Resolve authorization before mutation.
- Validate reaction key before mutation.
- Apply rate limit before mutation.
- Use a transaction or equivalent single-write critical section for mutation plus aggregate response.
- Never accept client-supplied count, actor identity, billing plan, owner scope, score, rank, or moderation state.

## Rate Limits

Future runtime must rate-limit reaction attempts without creating tracking or analytics.

Minimum approval defaults:

- Maximum 20 reaction mutation attempts per actor per minute.
- Maximum 6 reaction toggles per actor/message per minute.
- Maximum 100 reaction mutation attempts per actor per hour.
- Maximum 5 invalid reaction-key attempts per actor per 10 minutes before a 10-minute invalid-key cooldown.
- Maximum 30 unauthenticated write attempts per anonymous edge bucket per 10 minutes, without storing IPs.

Rate-limit state must:

- Expire automatically.
- Store only scoped opaque keys or hashes.
- Avoid IP addresses, user agents, route histories, Discord IDs, billing IDs, profile handles, Nitrado IDs, and moderation evidence.
- Return safe `429` responses without public shame copy.

Rate-limit state must not feed analytics, billing, rankings, discovery, reviews, badges, seasons, events, Server Wars, CTF scoring, XP awards, calling-card awards, public profile visibility, retained exports, owner entitlement, server ownership, moderation decisions outside approved reaction abuse handling, or competitive eligibility.

## Moderation Scope

The first reaction runtime PR must inherit message moderation state. It must not implement standalone owner/admin reaction moderation mutation routes.

Inherited behavior:

- Hidden messages hide reactions.
- Deleted messages hide reactions.
- Quarantined messages hide reactions outside the authorized moderator view.
- Locked messages may allow reads but deny new writes according to message policy.
- Expired messages deny new writes and may hide or freeze aggregates according to message retention policy.

Future standalone reaction moderation is blocked until a separate moderation implementation approval slice defines:

- Exact moderation routes.
- Owner/admin authorization checks.
- Linked-server ownership checks.
- Global DZN admin scope.
- Cross-owner denial.
- Actor reaction removal behavior.
- Aggregate hiding behavior.
- Private moderation audit rows.
- Notification behavior.
- Appeal/restore behavior.
- Retention and export rules.

Starter and Pro owner entitlement may authorize owner tooling only inside owned server/community scope after linked-server ownership proof. Starter and Pro must not grant personal reaction advantage, reaction weight, priority, visibility, safety bypass, moderation immunity, or competitive benefit.

Reaction counts must never be treated as proof of wrongdoing by themselves.

## Retention Model

Reaction retention must follow the approved DZN Comms message retention model.

Approval defaults:

- Active reaction state lives no longer than the associated message.
- If a message is hard-deleted, reaction rows must be deleted or made unreachable by cascade/cleanup.
- If a message is soft-hidden, reaction aggregates must be hidden with it.
- Idempotency mutation rows expire after 24 hours unless a shorter policy is approved.
- Rate-limit counters expire on their window.
- No owner/admin export of reaction rows is approved.
- No public "who reacted" drawer is approved.
- No analytics or marketing reporting is approved.
- No support-bot source document may be created from reactions.

Private audit retention for future moderation is not approved in the first runtime reaction PR. It requires the separate moderation implementation approval slice.

## Rollout Plan

Required sequence:

1. Keep this approval preflight as docs/tests only.
2. Confirm a separate DZN Comms message/read model exists and is approved.
3. Add a local/test-only reaction storage migration in a dedicated implementation PR.
4. Add disabled-by-default local/test runtime routes using the approved route set.
5. Add disabled-by-default UI affordances only after API tests pass.
6. Prove isolation from billing, ownership, rankings, reviews, events, progression, public profiles, retained exports, AI, analytics, and live checkout.
7. Keep production flags off until a separate production rollout approval exists.

The first reaction runtime implementation PR must target local/test behavior only. It must not deploy to production or claim live availability on `https://dayz-network.com/`.

## Rollback Plan

Rollback must be simple:

- Turn off `NEXT_PUBLIC_DZN_COMMS_REACTIONS_UI_ENABLED`.
- Turn off `DZN_COMMS_REACTIONS_WRITE_ENABLED`.
- Turn off `DZN_COMMS_REACTIONS_READ_ENABLED` if reads are unsafe.
- Keep `/community` rendering with static fallback reaction chips or no interactive controls.
- Let idempotency and rate-limit rows expire.
- Leave message history, player profiles, owner dashboards, Store pages, billing gates, rankings, reviews, events, progression, public profiles, retained exports, and competitive systems untouched.

Rollback must not:

- Delete unrelated player, owner, billing, review, event, XP, calling-card, badge, season, CTF, Server Wars, profile, Store, or Nitrado data.
- Enable live checkout.
- Mutate Stripe, Cloudflare secrets/config, production D1, Nitrado, Discord, retained exports, issue #49, analytics/tracking, AI provider settings, or vector stores.

## Proof Matrix

Before any reaction runtime implementation PR is mergeable, it must prove:

- With read flag disabled, reaction reads return disabled/not-found behavior and public pages render a safe fallback.
- With write flag disabled, add/remove requests cannot write.
- Logged-out visitors cannot add or remove reactions.
- Free logged-in Discord players can add/remove their own allowed reactions on visible public-channel messages without Starter or Pro.
- Starter and Pro do not alter reaction count, weight, priority, visibility, limits, moderation immunity, or safety handling.
- Private group reactions require trusted DZN user ID bridge membership.
- Cross-owner private group reaction reads, writes, and moderation attempts are denied.
- Invalid reaction keys are rejected server-side.
- Removed reaction keys are not remapped to other reactions.
- The client cannot submit counts or actor identity.
- Repeated adds are idempotent and do not inflate counts.
- Repeated deletes are idempotent and do not decrease counts below zero.
- Concurrent same-user adds produce exactly one active reaction.
- Concurrent same-user removes do not create negative counts.
- Aggregate counts expose no raw DZN user IDs, Discord IDs, profile handles, hidden profile fields, billing fields, owner state, server ownership state, moderation evidence, IP addresses, user agents, referrers, route histories, or raw ledger rows.
- Current-user reaction state is private to the requester.
- Hidden, deleted, quarantined, unavailable, expired, or unreadable messages do not expose public reactions.
- Reaction rate limits expire and do not create analytics/tracking state.
- Reaction runtime cannot affect billing, owner entitlement, server ownership, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars scoring, CTF scoring, XP awards, calling-card awards, public profile visibility, retained exports, moderation decisions outside approved reaction abuse handling, or competitive eligibility.
- Reaction runtime does not create chat send APIs, support chat APIs, AI bot routes, Durable Objects, WebSockets, vector stores, metered model calls, live checkout activation, Stripe mutation, Cloudflare secret/config mutation, production D1 writes, Nitrado mutation, Discord mutation, deployment, retained export changes, or issue #49 changes.

## Live-Site Boundary

This preflight can be committed and opened as a PR, but it does not deploy to `https://dayz-network.com/`.

Only report reaction runtime as live after a later approved implementation PR is merged, deployed, and verified on the production URL.

## Next Recommended Slice

Next should be the DZN Comms message/read model approval preflight if no approved DZN Comms message/read runtime exists yet.

If that prerequisite already exists in the chosen base branch, next should be the DZN Comms reaction runtime local/test implementation slice, disabled by default, using only the route set, storage model, flags, idempotency rules, rate limits, retention model, rollback plan, and proof matrix from this preflight.
