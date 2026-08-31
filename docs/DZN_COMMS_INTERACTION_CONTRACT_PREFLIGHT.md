# DZN Comms Interaction Contract And Moderation Preflight

## Scope

This slice is contract-preflight only.

It defines the future interaction, access, moderation, support-source, logging, retention, and rollback contracts that DZN Comms runtime work must satisfy before any real chat implementation begins.

No runtime chat APIs are added. No message tables are added. No chat message database migrations are added. No Durable Objects/WebSockets are added. No moderation tables are added. No bot prompts are added. No vector stores are added. No AI provider credentials are added. No metered model calls are added. No analytics/tracking is added. No production mutations are added.

The existing `/community` page remains a static visual prototype with local mock data and disabled/non-sending composer controls.

## Future Surface Contracts

Future DZN Comms is split into these surfaces:

| Surface | Participation boundary | Management boundary | Paid-plan dependency |
| --- | --- | --- | --- |
| Site-wide DZN Assist support launcher | Public generic help; login required before account-specific help | DZN support/admin policy only | No paid plan required |
| Global Chat | Discord login plus active safety state | DZN admin/global moderator scope | No paid plan required |
| New Players channel | Discord login plus active safety state | DZN admin/global moderator scope | No paid plan required |
| Server Owners channel | Discord login plus active safety state | DZN admin/global moderator scope | No paid plan required |
| Events channel | Discord login plus active safety state | DZN admin/global moderator scope | No paid plan required |
| Private group chat | Discord login plus trusted DZN user ID bridge membership | Group owner/moderator/admin scope | No paid plan required for player participation |
| Server-linked group management | Not a normal player action | Owner entitlement plus linked-server ownership, or DZN admin scope | Owner management action only |
| Moderation queue | Not a normal player chat surface | Owner/admin scope with cross-owner denial | Owner/admin tooling only |

Free logged-in players can participate in allowed DZN Comms player/community chat without Starter or Pro. Starter and Pro may unlock owner presentation, publishing, analytics, or server-management tools, but they must not grant chat priority, moderation immunity, safety bypasses, scoring advantages, event advantages, XP advantages, calling-card advantages, badge advantages, Server Wars advantages, CTF advantages, ranking boosts, discovery boosts, review boosts, or competitive eligibility advantages.

## Send Attempt Contract

Future send attempts must use a server-authoritative contract. The UI may render a local pending state, but it must not publish a message as accepted until the server returns an accepted result.

Proposed request shape for a future send endpoint:

```json
{
  "clientMutationId": "client-generated-idempotency-key",
  "channelId": "dzn-channel-or-private-group-id",
  "body": "message text",
  "replyToMessageId": "optional-visible-message-id"
}
```

Required server checks, in order:

1. Require a valid Discord-backed DZN session for global/private chat participation.
2. Resolve the actor to a canonical DZN user ID.
3. Resolve the channel scope server-side.
4. Deny hidden, archived, deleted, unavailable, or private channels unless membership is proven.
5. Enforce private group membership through a trusted DZN user ID bridge.
6. Enforce owner/admin moderation or management capability only for management actions.
7. Check active mute, timeout, ban, slow-mode, and rate-limit state.
8. Run profanity, spam, link, impersonation, and private-data safety filters before persistence or fanout.
9. Persist only accepted messages.
10. Fan out only accepted messages to authorized readers.

Future responses must be explicit and safe:

| Result | HTTP direction | Message ID | Client behavior |
| --- | --- | --- | --- |
| `accepted` | 201 | Present | Show sent state and server timestamp |
| `blocked` | 200 or 422 | Absent | Show private blocked-message feedback; do not publish text |
| `warning` | 200 or 422 | Absent unless policy allows accepted-with-warning | Show warning ladder state |
| `timeout_applied` | 200 or 423 | Absent | Show timeout state and retry time |
| `rate_limited` | 429 | Absent | Show retry-after countdown |
| `muted` | 423 | Absent | Show active mute/timeout reason |
| `unauthenticated` | 401 | Absent | Send player to login |
| `forbidden` | 403 | Absent | Hide or deny unavailable/private scope |

Rejected message bodies must not be echoed back to other users, public logs, analytics, owner dashboards, support sources, rankings, discovery, reviews, profiles, XP, calling-card awards, events, seasons, CTF, or Server Wars.

## Future Reaction Interaction Contract

The static DZN Comms shell can show emoji reaction chips, but runtime reactions remain blocked until a dedicated DZN Comms reaction interaction contract slice is approved.

The dedicated DZN Comms reaction interaction contract preflight is now captured in `docs/DZN_COMMS_REACTION_INTERACTION_CONTRACT_PREFLIGHT.md`. The dedicated reaction contract is now captured in `docs/DZN_COMMS_REACTION_INTERACTION_CONTRACT_PREFLIGHT.md`. The DZN Comms reaction runtime implementation approval preflight is captured in `docs/DZN_COMMS_REACTION_RUNTIME_IMPLEMENTATION_APPROVAL_PREFLIGHT.md`. Those reaction-specific preflights are still documentation/test-only, but they define the future emoji allow-list, add/remove/list/read routes, message-history embedding, per-user idempotency, aggregate-count privacy, current-user reaction state, rate limits, moderation behavior, storage/migration model, retention/logging, rollback, and proof matrix.

That reaction slice defines:

- The add/remove/list/read API shape for message reactions.
- A server-controlled emoji allow-list.
- Per-user idempotency so one account cannot inflate a reaction count through repeat requests.
- Current-user reaction state without exposing raw user IDs, Discord IDs, or private profile identifiers.
- Public-safe aggregate counts only.
- Rate limits and abuse handling for rapid reaction changes.
- Moderation visibility and removal rules for hidden, removed, or reported messages.
- Retention and logging boundaries.
- Rollback behavior if reactions are disabled after launch.
- Proof that reactions cannot affect billing, owner entitlement, server ownership, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars scoring, CTF scoring, XP awards, calling-card awards, public profile visibility, retained exports, moderation decisions outside reaction moderation, or competitive eligibility.

No runtime reaction route, message table, reaction table, Durable Object, WebSocket, persistence, analytics/tracking call, AI provider credential, vector store, metered model call, or production mutation may be added until both reaction preflights are complete and a later disabled local/test implementation slice is approved.

## Filtering Decision Contract

Filtering decisions are server-side policy decisions, not UI-only decorations.

Required future decision inputs:

- Canonical DZN user ID.
- Channel or group ID.
- Scope type: global, public channel, private group, support session, owner moderation, or admin moderation.
- Normalized body length and content class.
- Link count and invite/link classification.
- Recent send count and slow-mode window.
- Active mute/timeout/ban state.
- Prior warning count in the current safety window.

Required future decision outputs:

| Decision | Persist message | Publish message | Audit action | User feedback |
| --- | --- | --- | --- | --- |
| `allow` | Yes | Yes | Optional sampled operational record only | Sent |
| `allow_with_notice` | Yes | Yes | Scoped moderation event | Friendly reminder |
| `block` | No | No | Scoped moderation event without public rejected text | Message blocked |
| `warn` | No by default | No by default | Scoped warning event | Friendly warning |
| `timeout` | No | No | Scoped timeout event | Retry after timeout |
| `escalate` | No | No | Staff-review event | Staff review notice |

Profanity filters must be configurable and testable. Link protection must distinguish allowed DZN links from risky external links. Spam protection must be bounded by actor, channel, and time window. Invite approval must apply to private groups before an invite or membership change becomes visible.

## Warning And Timeout State Contract

The Safety Ladder remains canonical:

1. Message blocked.
2. Friendly warning.
3. 10-minute timeout.
4. Staff review.

Required rules:

- Warning and timeout state is private to the affected user plus authorized moderators/admins.
- A timeout blocks message sends only.
- A timeout must not block reading public pages, using player profile privacy settings, viewing leaderboards, entering unrelated player surfaces, or managing billing.
- A timeout must not become a competitive penalty.
- Repeated severe events can escalate to staff review, but staff review must be scoped and auditable.
- Moderator reversals must be represented explicitly rather than deleting the original moderation history.

Warnings, timeouts, mutes, and staff-review status must not affect billing, owner entitlements, server ownership, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars, CTF scoring, XP awards, calling-card awards, or competitive eligibility.

## Read-Only History Contract

Future read-only history must expose only messages the requesting user is authorized to see.

Proposed future history query shape:

```text
GET /api/dzn-comms/channels/:channelId/messages?cursor=...&limit=...
```

Required response properties:

- `Cache-Control: no-store`.
- `Vary: Cookie` for any authenticated or private response.
- Cursor pagination with deterministic newest/oldest ordering.
- Public-safe display author fields only.
- No raw Discord IDs.
- No Discord OAuth tokens.
- No internal DZN user IDs.
- No private profile-hidden fields.
- No raw moderation evidence.
- No owner billing state.
- No private support context.
- No deleted or rejected message bodies except to authorized staff when a retention model explicitly allows it.

Read-only history must not calculate, return, update, or influence rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars, CTF scoring, XP awards, calling-card awards, billing, owner entitlement, server ownership, or competitive eligibility.

## Report Action Contract

Future message reports are player safety signals, not scoring or reputation signals.

Proposed future report request shape:

```json
{
  "messageId": "visible-message-id",
  "reason": "harassment|hate|spam|link|impersonation|private_info|other",
  "safeNote": "optional short note"
}
```

Required rules:

- Reporter must be logged in.
- Reporter must be allowed to view the message they report.
- One actor must not be able to spam duplicate active reports for the same message.
- The reported message author must not receive private reporter identifiers.
- Owners can triage only reports tied to their owned server/community scope after owner entitlement plus linked-server ownership is proven.
- DZN admins can triage global reports.
- Reports must not change message author XP, calling cards, badges, profile visibility, rankings, discovery, reviews, events, Server Wars, CTF scoring, billing, or competitive eligibility.

## Owner/Admin Moderation Scope Contract

Moderation actions must be server-authoritative and scoped.

Required future moderation actions:

- Hide message.
- Restore message.
- Apply warning.
- Apply timed timeout.
- Lift timeout.
- Escalate to staff review.
- Resolve report.
- Dismiss report.
- Mark repeated pattern.
- Lock private group invite.
- Remove member from private group after scope proof.

Owner moderation scope:

- Owner must pass the canonical owner entitlement boundary when moderating server-linked owner/community spaces.
- Owner must prove linked-server ownership for the relevant scope.
- Owner must not moderate global DZN channels unless also granted DZN admin/global moderator scope.
- Owner must not moderate another owner's private group, reports, or message history.

DZN admin scope:

- DZN admins may triage global reports and cross-server safety queues.
- Admin actions must be auditable.
- Admin actions must not expose private identifiers in public responses.

Cross-owner denial must be tested for every moderation action.

## Private Group Membership Proof Contract

Private group chat must never rely on display names.

Allowed membership proof sources:

- Trusted `community_members.user_id` bridge rows.
- Approved event/team membership rows that are explicitly marked safe for chat membership.
- Server-linked staff/moderator membership rows tied to linked-server ownership.
- Owner/admin-created group membership rows after server-side authorization.

Forbidden membership proof sources:

- Discord display names.
- Gamertags.
- Review author names.
- Leaderboard display names.
- Public profile handles alone.
- Request-supplied user IDs.
- Request-supplied Discord IDs.
- Cosmetic role labels.
- Imported candidate rows before duplicate/ambiguous resolution.

Private group membership checks must be repeated server-side on every read, send, report, invite, and moderation action.

## Support Source Policy

DZN Assist may eventually answer public website support questions, but the bot source boundary must be approved before any runtime bot is implemented.

Allowed future support sources:

- Public DZN website content.
- Public setup-help content.
- Public pricing content.
- Public support policy.
- Public event guide content.
- Public feature documentation.

Forbidden support sources:

- Private player data.
- Private owner data.
- Hidden profile sections.
- Raw Discord IDs.
- Discord OAuth tokens.
- Nitrado tokens.
- Billing secrets.
- Stripe state.
- Production D1 internals.
- Retained export artifacts.
- Raw award evidence.
- Internal moderation notes.
- Private chat history outside the active support session.
- Owner-only dashboard payloads.
- Non-public admin notes.

The support bot must refuse requests for private account details, billing state, owner entitlements, moderation internals, hidden profile sections, raw award evidence, private identifiers, Nitrado actions, Discord mutations, checkout creation, ranking changes, discovery changes, XP/calling-card awards, event decisions, Server Wars scoring, CTF scoring, or competitive eligibility changes.

No AI provider credential, paid API key, model provider SDK, metered model call, vector store, source embedding job, training/eval job, prompt registry, tool-calling route, or automated spend path may be added until a dedicated approved support-bot implementation slice defines provider choice, cost controls, source indexing, abuse handling, refusal policy, logging, retention, rollback, and zero-surprise-spend evidence.

## Logging And Retention Contract

Future logging must be private, scoped, and purpose-limited.

Allowed future logs after a dedicated implementation approval:

- Delivery-neutral operational errors.
- Scoped moderation audit rows.
- Reversible moderation action history.
- Rate-limit counters with expiry.
- Timeout/mute state with expiry.
- Support session transcript rows only after retention is deliberately approved.

Blocked until separately approved:

- Analytics/tracking events for chat/support usage.
- Stored support/share/chat history outside an approved retention model.
- Retained exports.
- Public rejected-message logs.
- Bot training data collection.
- Cross-owner report exports.
- Raw private identifiers in owner/admin exports.
- Long-lived message retention without deletion policy.

Retention requirements before implementation:

- Define default retention period.
- Define deletion and redaction behavior.
- Define who can view moderation history.
- Define whether deleted message bodies are retained, redacted, or purged.
- Define support-session expiry.
- Define audit rows that must survive user-visible deletion for abuse prevention.
- Define rollback behavior that disables writes while preserving read-only safety evidence.

## Rollback Controls

Future runtime work must be controlled by explicit kill switches. These names are design-only in this preflight and must not be added to production configuration by this slice.

Proposed future flags:

- `DZN_COMMS_READ_ENABLED`
- `DZN_COMMS_WRITE_ENABLED`
- `DZN_COMMS_REALTIME_ENABLED`
- `DZN_COMMS_SUPPORT_BOT_ENABLED`
- `DZN_COMMS_MODERATION_ACTIONS_ENABLED`
- `DZN_COMMS_PRIVATE_GROUPS_ENABLED`

Required rollback behavior:

- Disabling writes must stop sends, reports, invites, and moderation mutations.
- Disabling realtime must fall back to no realtime transport, not to an unsafe unbounded loop.
- Disabling the support bot must keep public static support copy available.
- Disabling private groups must hide private group reads and writes without deleting membership evidence.
- Rollback must not disable public homepage, pricing, player hub, leaderboards, server listings, reviews, events, or existing owner entitlement checks.
- Rollback must not enable live checkout.
- Rollback must not mutate Stripe, Cloudflare secrets, production D1, Nitrado, Discord, retained exports, issue #49, rankings, discovery, reviews, badges, seasons, Server Wars, CTF scoring, XP awards, calling-card awards, or competitive eligibility.

## Required Proof For The First Runtime Slice

Before the first runtime chat/support implementation PR is mergeable, it must prove:

- Logged-out visitors cannot send global or private chat messages.
- Free logged-in players can use allowed player/community chat without Starter or Pro.
- Owner-only management actions require owner entitlement plus linked-server ownership.
- Private group reads and sends require trusted DZN user ID bridge membership.
- Cross-owner private group reads, sends, reports, and moderation are denied.
- Profanity, spam, and link filtering can block before persistence and fanout.
- Warnings and timeouts block sends without affecting unrelated player/owner/competitive systems.
- Message report actions are scoped to visible messages and cannot spam duplicate active reports.
- Read-only history redacts private identifiers and hidden profile/private support fields.
- DZN Assist refuses private, billing, token, Nitrado, Discord, hidden-profile, raw-evidence, scoring, moderation-internal, and account-specific questions unless a later approved source boundary allows safe account-specific support after login.
- No live Stripe checkout activation, issue #49 mutation, Cloudflare secret change, production D1 write, Nitrado mutation, Discord mutation, deployment, retained export change, provider credential, vector store, or metered model call is required.

## Next Recommended Slice

Next should be the DZN Comms runtime implementation approval preflight: choose the first runtime slice shape, transport plan, migration plan, feature-flag defaults, retention defaults, moderation data model, testing matrix, and rollback path before implementing any chat APIs, message tables, Durable Objects/WebSockets, AI provider credentials, vector stores, or metered model calls.

That runtime implementation approval preflight is now captured in `docs/DZN_COMMS_RUNTIME_IMPLEMENTATION_APPROVAL_PREFLIGHT.md`. It adds the requested public live website counter to the plan and selects the DZN Comms live presence counter foundation as the next implementation slice, still before chat message sending, message persistence, moderation-table implementation, DZN Assist AI runtime, AI provider credentials, vector stores, or metered model calls.
