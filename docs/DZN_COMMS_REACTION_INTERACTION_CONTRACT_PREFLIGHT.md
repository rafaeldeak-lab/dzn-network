# DZN Comms Reaction Interaction Contract Preflight

## Scope

This slice is reaction-contract preflight only.

It defines the future client/server contract for DZN Comms emoji reactions before any real reaction runtime exists.

No runtime reaction APIs are added. No chat send APIs are added. No message tables are added. No reaction tables are added. No chat/support/moderation database migrations are added. No Durable Objects/WebSockets are added. No persistence is added. No analytics/tracking is added. No AI provider credentials, vector stores, or metered model calls are added. No Store, Supporter Card, live checkout, Stripe, Cloudflare, production D1, Nitrado, Discord, retained export, or issue #49 mutation is added.

The existing `/community` page may continue showing static local mock reaction chips as actual emoji plus count. Those chips remain display-only and do not send, store, track, or moderate anything.

## Product Boundary

Reactions are player/community expression, not a scoring system.

Future DZN Comms reactions may let a logged-in player add or remove one reaction from a visible message when chat runtime has already been approved. Reactions must never become:

- A ranking signal.
- A discovery signal.
- A review signal.
- A badge, season, XP, calling-card, CTF, Server Wars, or event scoring input.
- A billing entitlement.
- An owner-plan benefit.
- A moderation penalty by themselves.
- A public identity source.
- A support-bot source document.
- An analytics or tracking event.

Starter and Pro must not grant extra reaction weight, reaction priority, reaction visibility, reaction immunity, better limits, special scoring, or moderation bypasses.

## Allowed Emoji Set

Runtime reactions must use a server-controlled allow-list. The client may display icons, but the server decides which reaction keys are valid.

Approved MVP reaction keys:

| Key | Code point | Label | Intended use |
| --- | --- | --- | --- |
| `rocket` | `U+1F680` | Boost | Positive momentum |
| `wave` | `U+1F44B` | Wave | Greeting or welcome |
| `heart` | `U+1F49C` | Heart | Friendly support |
| `trophy` | `U+1F3C6` | Trophy | Event hype only, not scoring |
| `fire` | `U+1F525` | Fire | Excitement |
| `target` | `U+1F3AF` | Target | Useful or on-point |
| `thumbs_up` | `U+1F44D` | Thumbs up | Agreement |
| `shield` | `U+1F6E1` | Shield | Safety/helpful moderation context |
| `eyes` | `U+1F440` | Eyes | Watching/following |
| `check` | `U+2705` | Check | Acknowledged |

Blocked until a later moderation review:

- Custom Discord emoji.
- Uploaded image reactions.
- Animated reactions.
- Paid/supporter-only reaction types.
- Server-owner-only reaction types.
- Negative/pile-on reactions.
- Any reaction that implies official approval, event scoring, ranking, review quality, punishment, or account trust.

If a reaction key is removed from the allow-list later, existing public aggregates may either hide that key or show it as `unavailable`, but the server must not remap it to another reaction.

## Future API Contract

These routes are design-only in this preflight. They must not be implemented until a later approved runtime reaction slice.

### Read Message Reactions

```text
GET /api/dzn-comms/messages/:messageId/reactions
```

Required checks:

1. Resolve the requesting user when session state exists.
2. Resolve the message server-side.
3. Confirm the requester may see the message.
4. Confirm the channel or private group is readable for that requester.
5. Redact hidden, deleted, removed, or unavailable reaction rows according to moderation state.
6. Return aggregate counts and current-user booleans only.

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

The response must not expose raw DZN user IDs, Discord IDs, profile handles, private profile fields, owner billing state, linked-server ownership, moderation evidence, IP addresses, user agents, or raw reaction ledger rows.

### Add Message Reaction

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

Required checks:

1. Require a valid Discord-backed DZN session.
2. Resolve the actor to the canonical DZN user ID server-side.
3. Resolve the message and channel server-side.
4. Confirm the actor may read the message before reacting.
5. Confirm private group membership with the trusted DZN user bridge when applicable.
6. Reject hidden, deleted, removed, locked, archived, unavailable, or staff-only messages unless policy explicitly allows a moderator-only action.
7. Validate `reactionKey` against the server allow-list.
8. Apply actor/channel/message reaction rate limits before writes.
9. Enforce one active row per actor, message, and reaction key.
10. Return aggregate count and current-user state after the write.

Response results:

| Result | HTTP direction | Meaning |
| --- | --- | --- |
| `added` | 201 | Reaction was created once |
| `already_present` | 200 | Same actor already has this reaction; count is not inflated |
| `invalid_reaction` | 422 | Key is not in the server allow-list |
| `rate_limited` | 429 | Actor is changing reactions too quickly |
| `unauthenticated` | 401 | Actor must log in |
| `forbidden` | 403 | Actor cannot see or react to this message |
| `message_unavailable` | 404 or 410 | Message is hidden, removed, deleted, or unavailable |
| `disabled` | 503 | Reaction writes are off |

### Remove Message Reaction

```text
DELETE /api/dzn-comms/messages/:messageId/reactions/:reactionKey
```

Required checks:

1. Require a valid Discord-backed DZN session.
2. Resolve the actor to the canonical DZN user ID server-side.
3. Resolve the message and channel server-side.
4. Confirm the actor may read the message or that removal is allowed for their existing own reaction.
5. Validate `reactionKey` against the allow-list or a historical unavailable-key list.
6. Remove only the actor's own reaction unless the action is a separate owner/admin moderation action.
7. Make repeated deletes idempotent.
8. Return aggregate count and current-user state after the delete.

Response results:

| Result | HTTP direction | Meaning |
| --- | --- | --- |
| `removed` | 200 | The actor's active reaction was removed |
| `already_absent` | 200 | No active actor reaction existed |
| `rate_limited` | 429 | Actor is changing reactions too quickly |
| `unauthenticated` | 401 | Actor must log in |
| `forbidden` | 403 | Actor cannot access this message or reaction action |
| `message_unavailable` | 404 or 410 | Message is unavailable |
| `disabled` | 503 | Reaction writes are off |

### Message History Embedding

Future message history may embed reaction summaries in the existing read-only history response:

```json
{
  "messages": [
    {
      "id": "visible-message-id",
      "body": "public-safe visible message",
      "reactions": {
        "revision": "server-generated-reaction-revision",
        "counts": [
          { "key": "heart", "emoji": "U+1F49C", "label": "Heart", "count": 12, "currentUserReacted": false }
        ]
      }
    }
  ]
}
```

History responses must remain `Cache-Control: no-store` and `Vary: Cookie` for authenticated/private scopes. Public-static shells must continue to use mock data only until runtime chat is approved.

## Idempotency And Count Integrity

The future server must own reaction state.

Required integrity rules:

- `clientMutationId` prevents duplicate create/remove processing during retries.
- One actor can contribute at most one count per reaction key per message.
- Repeating the same add returns `already_present` and must not increment the count.
- Repeating the same delete returns `already_absent` and must not decrement below zero.
- Concurrent add requests for the same actor/message/reaction key must resolve to one active reaction.
- Concurrent remove requests must not create negative counts.
- The client cannot submit or override `count`, `actorUserId`, `discordId`, `authorId`, `ownerId`, `billingPlan`, `score`, `rank`, or moderation state.
- Aggregate counts are computed from trusted active rows or a server-maintained read model, never from client payloads.

Suggested future uniqueness contract:

```text
unique(active actor_user_id, message_id, reaction_key)
unique(client_mutation_id, actor_user_id, action_scope)
```

This is a design contract only. No migration is added by this preflight.

## Current-User State And Privacy

Future responses may tell the current requester whether they reacted to a visible message:

```json
{ "key": "heart", "count": 12, "currentUserReacted": true }
```

They must not list who reacted. They must not expose:

- Raw DZN user IDs.
- Discord IDs.
- Discord usernames if the actor has not otherwise made them public.
- Public profile handles unless the profile is already opted in and the message author/member row independently allows public attribution.
- Hidden profile sections.
- Owner entitlement state.
- Billing/customer/order/payment fields.
- Nitrado identifiers.
- IP addresses or user agents.
- Moderation evidence or report details.

Any future "who reacted" drawer is blocked until a separate privacy and attribution slice proves opt-in public profile display and private-scope authorization.

## Access Rules

| Actor | Public channel reactions | Private group reactions | Moderation reaction removal |
| --- | --- | --- | --- |
| Visitor | Read static mock UI only; cannot add/remove | Not visible | Denied |
| Free Discord player | Can add/remove own allowed reactions on visible messages when writes are enabled | Only with trusted group membership | Denied |
| Starter owner | Same as free player unless they also have scoped moderation role | Only with trusted membership or scoped owner role | Own server/community scope only after owner entitlement plus linked-server ownership |
| Pro owner | Same as Starter; Pro gives no reaction advantage | Same as Starter | Same owner/admin scope rules |
| DZN admin/moderator | Can react normally and may moderate according to global scope | Can moderate according to configured admin scope | Allowed only through explicit moderation route/action |

Starter and Pro plan state must not affect player reaction access. Owner entitlement may authorize scoped moderation tooling for that owner's server/community management surface, but it must not change personal reaction count, reaction strength, priority, or visibility.

## Rate Limits And Abuse Handling

Future reaction runtime must rate-limit by actor, message, channel/group, and time window.

Minimum required limits:

- Burst limit for rapid add/remove toggles.
- Per-message reaction change limit.
- Per-channel reaction change limit.
- Cooldown after repeated invalid keys.
- Separate stricter limits for unauthenticated attempts.
- Protection against clientMutationId flooding.

Rate limits must return `429` with a safe retry direction and no public shame copy.

Rate-limit rows or counters must expire. They must not become analytics, ranking inputs, discovery inputs, review inputs, badge inputs, season inputs, XP/calling-card award facts, event eligibility facts, CTF facts, Server Wars facts, billing state, or competitive eligibility state.

## Moderation Contract

Reactions inherit message visibility. If a message is hidden, deleted, removed, quarantined, private, or staff-only, its reactions must not remain publicly visible.

Future moderation actions may:

- Hide all reactions for a removed message.
- Remove a specific reaction aggregate from public display if the reaction type becomes abusive or unavailable.
- Remove one actor's reaction only through an explicit moderation action with scope proof.
- Record a private moderation audit row when a moderator removes reactions.

Future moderation actions must not:

- Expose the full list of reacting users to owners by default.
- Let an owner moderate another owner's scoped reactions.
- Let a player remove another player's reaction.
- Treat reaction counts as proof of wrongdoing by themselves.
- Convert reaction activity into review score, reputation, rank, XP, calling-card, badge, season, event, CTF, Server Wars, billing, owner entitlement, or competitive eligibility state.

Cross-owner denial must be tested for any moderation route that can remove or hide reactions.

## Retention And Logging

Future reaction retention must follow the approved chat-message retention model.

Until that model exists:

- No reaction table may be implemented.
- No reaction history may be stored.
- No reaction analytics may be emitted.
- No reaction export may be generated.
- No support-bot source document may be created from reactions.

When later approved, reaction logs may store only purpose-limited state:

- Message ID.
- Actor DZN user ID internally only.
- Reaction key.
- Created timestamp.
- Removed timestamp where needed.
- Client mutation key hash or scoped idempotency key.
- Moderation removal status where needed.

Reaction logs must not store raw Discord IDs, IP addresses, user agents, billing IDs, Stripe IDs, Nitrado tokens, route histories, referrers, hidden profile fields, raw report evidence, or support transcript data.

## Rollback Controls

Design-only future flags:

- `DZN_COMMS_REACTIONS_READ_ENABLED`
- `DZN_COMMS_REACTIONS_WRITE_ENABLED`
- `DZN_COMMS_REACTIONS_MODERATION_ENABLED`
- `NEXT_PUBLIC_DZN_COMMS_REACTIONS_UI_ENABLED`

This preflight must not add those names to production configuration, Wrangler config, Cloudflare secrets, environment examples, or runtime code.

Required rollback behavior:

- Disabling write behavior stops add/remove requests.
- Disabling read behavior hides live reaction counts or falls back to static approved copy.
- Disabling moderation behavior prevents reaction moderation mutations while keeping existing message moderation unaffected.
- The static `/community` shell must keep rendering without runtime reaction data.
- Existing messages, player pages, public pages, Store pages, billing gates, and competitive systems must remain unaffected.
- Rollback must not enable live checkout or mutate Stripe, Cloudflare secrets, production D1, Nitrado, Discord, retained exports, issue #49, rankings, discovery, reviews, badges, seasons, Server Wars, CTF scoring, XP awards, calling-card awards, events, billing, owner entitlement, public profile visibility, moderation decisions outside reactions, or competitive eligibility.

## Required Proof Before Runtime Reactions

Before any runtime reaction implementation PR is mergeable, it must prove:

- Logged-out visitors cannot add or remove reactions.
- Free logged-in players can add/remove allowed reactions on visible public-channel messages without Starter or Pro.
- Private group reactions require trusted DZN user ID bridge membership.
- Cross-owner private group reaction reads, writes, and moderation are denied.
- Invalid reaction keys are rejected server-side.
- The client cannot submit counts or inflate counts.
- Repeated adds are idempotent and do not increase counts.
- Repeated deletes are idempotent and do not decrease counts below zero.
- Concurrent same-user adds produce exactly one active reaction.
- Aggregate counts expose no raw user IDs, Discord IDs, profile handles, private profile fields, billing fields, moderation evidence, IP addresses, or user agents.
- Current-user reaction state is private to that requester.
- Hidden/deleted/removed messages do not expose public reactions.
- Reaction rate limits do not write analytics or competitive state.
- Owner/admin reaction moderation requires explicit scope and cross-owner denial.
- Reaction state must not affect billing, owner entitlement, server ownership, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars scoring, CTF scoring, XP awards, calling-card awards, public profile visibility, retained exports, moderation decisions outside approved reaction moderation, or competitive eligibility.
- Reactions do not affect billing, owner entitlement, server ownership, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars scoring, CTF scoring, XP awards, calling-card awards, public profile visibility, retained exports, moderation decisions outside the reaction system, or competitive eligibility.
- No chat send runtime, message persistence, Durable Object, WebSocket, AI provider credential, vector store, metered model call, live checkout activation, Stripe mutation, Cloudflare config/secret mutation, production D1 write, Nitrado mutation, Discord mutation, deployment, retained export change, or issue #49 change is required.

## Live-Site Boundary

This preflight can be committed and opened as a PR, but it does not push behavior to `https://dayz-network.com/` by itself.

The live page changes only after the repository's normal merge and deployment process runs. Do not claim the reaction contract is live until a merge/deploy verification checks the production URL.

## Next Recommended Slice

The DZN Comms reaction runtime implementation approval preflight is now captured in `docs/DZN_COMMS_REACTION_RUNTIME_IMPLEMENTATION_APPROVAL_PREFLIGHT.md`. That approval preflight chooses the exact future route set, prerequisite message/read model, storage/migration model, feature-flag defaults, idempotency/concurrency behavior, rate limits, moderation scope, retention model, rollout/rollback plan, and proof matrix before any reaction API, message table, reaction table, Durable Object, WebSocket, persistence, analytics/tracking, AI provider, vector store, metered model call, live checkout, production mutation, or issue #49 change is implemented.

Next should be DZN Comms message/read model approval preflight if no approved DZN Comms message/read runtime exists yet. If that prerequisite already exists in the chosen base branch, next should be DZN Comms reaction runtime local/test implementation, disabled by default, using only the approved route set and proof matrix from `docs/DZN_COMMS_REACTION_RUNTIME_IMPLEMENTATION_APPROVAL_PREFLIGHT.md`.
