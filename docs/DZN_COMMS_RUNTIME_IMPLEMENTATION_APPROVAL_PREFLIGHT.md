# DZN Comms Runtime Implementation Approval Preflight

## Scope

This slice is runtime-approval preflight only.

It chooses the first future DZN Comms runtime slice shape, transport plan, migration plan, feature-flag defaults, retention defaults, moderation data model, testing matrix, rollback path, and live website presence counter contract.

No chat APIs are added. No support chat APIs are added. No presence APIs are added. No live visitor counter APIs are added. No message tables are added. No presence tables are added. No database migrations are added. No Durable Objects/WebSockets are added. No moderation tables are added. No AI provider credentials are added. No vector stores are added. No metered model calls are added. No analytics/tracking is added. No production mutations are added.

The existing `/community` page remains a static visual prototype with local mock data, disabled/non-sending composer controls, and mock online counts only.

## Approved Direction

The first real runtime slice should be the DZN Comms live presence counter foundation, not message sending.

That first runtime slice may add a public-safe "DZN online" counter that shows how many active page sessions are currently on DZN. The preferred first placement is the `/community` Global Chat shell because it already has the DZN Comms visual context. After the counter is proven safe, a later polish slice may expose the same small counter in the shared site header or major pages.

The counter must be a presence indicator, not analytics. It must not store browsing history, page history, user journeys, marketing events, tracking events, referrers, IP addresses, user agents, Discord identifiers, raw DZN user IDs, profile handles, billing state, owner entitlement, Nitrado identifiers, review identifiers, event identifiers, challenge identifiers, or competitive identifiers.

## First Runtime Slice Shape

The first implementation PR should be limited to presence counting and read-only presence display.

Allowed in the first runtime slice after this preflight:

- A public-safe aggregate online counter contract.
- A short-lived heartbeat or connection presence mechanism.
- A read-only aggregate count response.
- A small DZN-branded counter on `/community`.
- Optional local mock fallback when the presence service is disabled or unavailable.
- Tests proving the counter is aggregate, short-lived, non-identifying, and presentation-only.

Blocked in the first runtime slice:

- User message sending.
- Message persistence.
- Message history.
- Private group messages.
- Message reports.
- Moderation mutations.
- DZN Assist AI runtime.
- Bot prompts.
- Vector stores.
- AI provider credentials.
- Metered model calls.
- Analytics/tracking events.
- Persistent visitor profiles.
- Cross-page browsing history.
- Retained exports.
- Live checkout changes.
- Production service mutations.

## Presence Counter Contract

Future live counter requests must count active presence without identifying people publicly.

Public display contract:

```json
{
  "scope": "site|community|global_chat",
  "label": "DZN online",
  "onlineCount": 128,
  "precision": "approximate",
  "updatedAt": "server-generated-iso-time",
  "ttlSeconds": 45
}
```

Required public response rules:

- Return aggregate counts only.
- Use bounded cache headers that do not leak private sessions.
- Show an approximate count when exact unique-person counting would require tracking.
- Show a fallback such as "DZN online" or "Live count unavailable" when disabled.
- Do not expose online member names from the public site counter.
- Do not expose raw sessions, connection IDs, IPs, user agents, Discord IDs, DZN user IDs, profile handles, or route histories.
- Do not use the counter as proof that a specific player is online.
- Do not feed the counter into rankings, discovery, reviews, badges, seasons, events, XP, calling-card awards, Server Wars, CTF, billing, owner entitlement, server ownership, moderation decisions, or competitive eligibility.

Required heartbeat or connection rules:

- The server owns presence state.
- Presence expires automatically using a short TTL.
- The client may refresh presence, but it cannot set the displayed count.
- Duplicate tabs may be counted as page sessions unless a later privacy review approves safer deduplication.
- Any deduplication must avoid fingerprinting and long-lived identifiers.
- Logged-in identity may be used only for private authorized member lists, not for the public aggregate counter.
- Anonymous visitor presence must not become a stored user profile or analytics record.

## Transport Plan

Preferred transport sequence:

1. Start with a small HTTP polling or heartbeat model for the live counter.
2. Keep message sending out of scope.
3. Keep private groups out of scope.
4. Keep DZN Assist AI out of scope.
5. Consider Durable Objects/WebSockets only in a later approved realtime slice after the presence counter proves the access, retention, and rollback model.

Transport requirements:

- Every write-like heartbeat must be feature-flagged.
- Every read-like aggregate response must be feature-flagged.
- The counter must degrade to static UI copy when disabled.
- The future client must avoid unbounded polling.
- The future server must enforce rate limits and TTL cleanup.
- The future transport must not require Discord, Nitrado, Stripe, production D1, retained exports, vector stores, or AI provider access.

## Migration Plan

The first runtime implementation must choose one minimal persistence approach before code is written.

Allowed options for the future presence counter:

- Ephemeral in-memory presence in a runtime-owned component with short TTL.
- A dedicated temporary presence store with expiry if the platform requires shared state.
- A minimal migration only if a database-backed TTL model is deliberately approved.

Blocked until separately approved:

- Chat message tables.
- Chat message history tables.
- Support transcript tables.
- Moderation action tables.
- Message report tables.
- Bot source document tables.
- Vector index metadata tables.
- Long-lived visitor/session tables.
- Retained export tables.

If a database-backed presence migration is chosen later, it must:

- Store only opaque short-lived presence keys.
- Store scope and expiry.
- Avoid IP address, user agent, referrer, raw route, Discord ID, DZN user ID, billing state, owner entitlement, and profile handle fields.
- Include automatic cleanup.
- Include a rollback path that disables writes and lets stale presence expire.

## Feature-Flag Defaults

Future runtime flags must default to disabled unless a dedicated implementation PR deliberately turns on local/test behavior.

Design-only future flags:

- `DZN_COMMS_PRESENCE_READ_ENABLED`
- `DZN_COMMS_PRESENCE_WRITE_ENABLED`
- `DZN_COMMS_PUBLIC_ONLINE_COUNTER_ENABLED`
- `DZN_COMMS_READ_ENABLED`
- `DZN_COMMS_WRITE_ENABLED`
- `DZN_COMMS_REALTIME_ENABLED`
- `DZN_COMMS_SUPPORT_BOT_ENABLED`
- `DZN_COMMS_MODERATION_ACTIONS_ENABLED`
- `DZN_COMMS_PRIVATE_GROUPS_ENABLED`

This preflight must not add these names to production configuration, Cloudflare secrets, Wrangler config, environment examples, or runtime code.

## Retention Defaults

Presence retention must be short-lived by default.

Future approved runtime defaults:

- Public aggregate counts are display-only and may be cached briefly.
- Presence keys expire automatically.
- Presence heartbeats must not be retained as analytics.
- Failed or blocked heartbeat attempts must not store raw request identity unless a security-specific, expiry-bound abuse counter is approved.
- No share history, visitor history, support history, message history, or route history may be stored by the presence counter.

Presence retention must not create retained exports, audit exports, analytics exports, marketing reports, or owner/admin downloadable reports.

## Moderation Data Model Plan

The first runtime presence-counter slice must not add moderation tables or moderation actions.

The later chat moderation data model still needs a separate approval before implementation. That future approval must define:

- Channel and private group records.
- Message records.
- Message report records.
- Moderation action records.
- Warning/timeout/mute records.
- Staff-review records.
- Cross-owner denial rules.
- Owner/admin visibility rules.
- Deletion, redaction, and retention behavior.
- Notification behavior.
- Abuse-rate counters with expiry.

Presence counters must not be used as moderation evidence by default. A later moderation slice may show aggregate online context only when it remains non-identifying and presentation-only.

## Support Bot Runtime Plan

DZN Assist remains blocked as a runtime AI bot until a dedicated support-bot implementation approval exists.

That later approval must define:

- Public source list.
- Refusal policy.
- Cost controls.
- Provider choice.
- Credential storage plan.
- Prompt/version review.
- Abuse handling.
- Logging and retention.
- Rollback behavior.
- Zero-surprise-spend evidence.

This preflight does not approve AI provider credentials, AI SDKs, model calls, embeddings, vector stores, prompt registries, tool-calling routes, training jobs, eval jobs, or metered spend.

## Testing Matrix

The first runtime implementation PR must prove:

- Logged-out users can read only the aggregate public counter when enabled.
- Logged-out users cannot send messages.
- Free logged-in players can read the aggregate counter without Starter or Pro.
- Starter and Pro do not change the displayed counter result.
- Owner entitlement does not change the displayed counter result.
- The client cannot set or inflate the displayed count directly.
- Presence expires after the approved TTL.
- Disabled read flag shows a safe fallback.
- Disabled write flag stops heartbeat/connection writes.
- Counter failures do not break public pages.
- Counter reads do not expose names, raw IDs, IPs, user agents, route history, Discord IDs, billing state, owner state, profile-hidden fields, review state, event state, XP evidence, or competitive state.
- The counter cannot affect rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars, CTF scoring, XP awards, calling-card awards, billing, owner entitlement, server ownership, public profile visibility, retained exports, moderation decisions, or competitive eligibility.
- No live Stripe checkout activation, issue #49 mutation, Cloudflare secret change, production D1 write, Nitrado mutation, Discord mutation, deployment, retained export change, provider credential, vector store, or metered model call is required.

## Rollback Path

Presence rollback must be simple:

- Disable presence writes.
- Disable presence reads if needed.
- Keep `/community` rendering with static fallback copy.
- Let short-lived presence state expire.
- Do not delete unrelated player, owner, billing, profile, review, event, ranking, XP, calling-card, CTF, Server Wars, or season data.
- Do not enable live checkout.
- Do not mutate Stripe, Cloudflare secrets, production D1, Nitrado, Discord, retained exports, issue #49, rankings, discovery, reviews, badges, seasons, Server Wars, CTF scoring, XP awards, calling-card awards, events, billing, owner entitlement, or competitive eligibility.

## Approval Checklist Before First Runtime PR

Before implementing the live counter foundation, the PR description or handoff must answer:

- Which exact pages show the counter first.
- Whether the MVP counts site page sessions, `/community` sessions, or Global Chat shell sessions.
- Which transport is used and why.
- Which storage option is used, if any.
- What the TTL is.
- What is returned when disabled or unavailable.
- What fields are forbidden from storage and response payloads.
- What feature flags default to off.
- Which tests prove public-safe aggregate behavior.
- Which tests prove no billing, ranking, discovery, review, badge, season, event, Server Wars, CTF, XP, calling-card, moderation, public profile, retained export, owner entitlement, or competitive eligibility influence.
- Which checks prove no analytics/tracking, AI provider, vector store, metered model call, live checkout, production mutation, or issue #49 change.

## Next Recommended Slice

Next should be the DZN Comms live presence counter foundation: implement the first public-safe aggregate online counter behind disabled-by-default read/write flags, starting on `/community` or the Global Chat shell with a static fallback, short TTL, no identifying public output, no analytics/tracking, no chat message sending, no message persistence, no moderation tables, no Durable Objects/WebSockets unless separately approved in that slice, no AI provider credentials, no vector stores, no metered model calls, no live checkout, no production mutations, and no effect on billing, owner entitlement, server ownership, rankings, discovery, reviews, badges, seasons, events, Server Wars, CTF scoring, XP awards, calling-card awards, public profile visibility, retained exports, moderation decisions, or competitive eligibility.
