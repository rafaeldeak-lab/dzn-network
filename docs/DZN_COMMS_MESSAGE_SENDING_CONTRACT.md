# DZN Comms Live Moderation Contract

Date: 2026-09-23
Status: implemented, tested and default-off; production migration and activation remain separate release operations

## Released Scope

This slice implements one Discord-authenticated Global Chat using HTTPS requests and five-second history polling. It includes server-side content checks, a five-second slow mode, a hard 20-message-per-minute ceiling, durable idempotency receipts, user reports, ten-minute safety timeouts and platform-owner moderation with an audit trail.

It does not implement private groups, reactions, attachments, presence, WebSockets, Durable Objects, AI support, analytics, tracking, billing, entitlements, gameplay rewards or competitive effects. No paid plan bypass exists.

## Release Gates

All three flags default off:

- `DZN_COMMS_LIVE_ENABLED=false`
- `DZN_COMMS_LIVE_SCOPE=local_test`
- `NEXT_PUBLIC_DZN_COMMS_LIVE_UI_ENABLED=false`

Production activation requires a separately reviewed application of `0065_dzn_comms_read_history.sql` and `0071_dzn_comms_live_moderation.sql`, verification of their exact production ledger state, then server scope `production` and the matching UI flag. A source merge alone does not apply migrations or activate chat.

## Write Contract

`POST /api/comms/messages` accepts exactly `channelSlug`, `clientRequestId` and `body`. The server requires an exact same-origin browser request and a current Discord-backed DZN session. Only `global-chat` is allowed. Request bodies are capped at 12,288 bytes; message bodies at 2,000 Unicode code points and 8,000 UTF-8 bytes.

The server controls actor identity, author label, channel, timestamp, visibility and source. It blocks token-shaped secrets, external Discord invites, repeated-character spam and severe threat/doxxing language. Rejected text remains request-memory-only and is never written to D1.

Accepted messages, quota slots and decision receipts are written in one D1 batch. The receipt key is `(actor_user_id, channel_id, client_request_id)`. Same-key retries return the original result and a different body returns conflict. Unique actor interval and minute-slot constraints enforce a hard upper bound even during concurrent sends.

## Reporting And Moderation

`POST /api/comms/reports` requires the current session, exact origin, an existing visible message, and an allowlisted reason. A user cannot report their own message and duplicate reports are idempotent.

`POST /api/owner/comms/moderate` requires the platform-owner allowlist. Hide, restore, delete, resolve-report and dismiss-report actions write an append-only moderation audit row in the same D1 batch as their state change. Server ownership, subscriptions and display roles do not grant Global Chat moderation.

## Retention And Boundaries

Receipts expire after seven days. A later maintenance slice must enforce deletion of expired receipts, old slots and messages before production activation is considered complete. Deleted message-body erasure and a dedicated owner moderation screen also remain follow-ups; the current API records state and audit history but does not claim those later controls are finished.

Comms reads and writes never alter billing, owner entitlement, server ownership, rankings, discovery, reviews, badges, seasons, events, Server Wars, CTF, XP, calling-card awards, profile visibility, retained exports or competitive eligibility.
