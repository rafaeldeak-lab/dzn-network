# DZN Comms Live Moderation Contract

Date: 2026-09-23
Status: implemented, tested and default-off; production migration and activation remain separate release operations

## Released Scope

This slice implements one Discord-authenticated Global Chat using HTTPS requests and five-second history polling. It includes server-side content checks, a five-second slow mode, a hard 20-message-per-minute ceiling, durable idempotency receipts, user reports, ten-minute safety timeouts and platform-owner moderation with an audit trail.

It does not implement private groups, reactions, attachments, presence, WebSockets, Durable Objects, AI support, analytics, tracking, billing, entitlements, gameplay rewards or competitive effects. No paid plan bypass exists.

## Release Gates

All activation flags default off:

- `DZN_COMMS_LIVE_ENABLED=false`
- `DZN_COMMS_LIVE_SCOPE=local_test`
- `NEXT_PUBLIC_DZN_COMMS_LIVE_UI_ENABLED=false`
- `DZN_COMMS_OWNER_MODERATION_ENABLED=false`
- `DZN_COMMS_OWNER_MODERATION_SCOPE=local_test`
- `DZN_COMMS_RETENTION_ENABLED=false`
- `DZN_COMMS_RETENTION_SCOPE=local_test`

Production activation requires a separately reviewed application of `0065_dzn_comms_read_history.sql`, `0071_dzn_comms_live_moderation.sql`, and `0072_dzn_comms_private_rate_ledgers.sql`, verification of their exact production ledger state, then server scope `production` and the matching UI flag. A source merge alone does not apply migrations or activate chat.

The `local_test` scope is accepted only when the request host is loopback or a `.localhost` hostname. It cannot enable write routes on a preview or production hostname, even if the enable flag is set accidentally.

## Write Contract

`POST /api/comms/messages` accepts exactly `channelSlug`, `clientRequestId` and `body`. The server requires an exact same-origin browser request and a current Discord-backed DZN session. Only `global-chat` is allowed. Request bodies are capped at 12,288 bytes; message bodies at 2,000 Unicode code points and 8,000 UTF-8 bytes.

The server controls actor identity, author label, channel, timestamp, visibility and source. It blocks token-shaped secrets, external Discord invites, repeated-character spam and severe threat/doxxing language. Rejected text remains request-memory-only and is never written to D1.

Accepted messages, quota slots and decision receipts are written in one D1 batch. Receipts and accepted-send slots use separate secret-derived actor keys and do not store the raw user ID. The receipt key is `(actor_receipt_key, channel_id, client_request_id)`. Same-key retries return the original result and a different body returns conflict. Each quota write allocates the first free slot atomically, and the receipt records the exact allocated slot while the message is active. Destructive erasure clears the message and slot association but retains the independent pseudonymous quota slot until normal retention, preserving both cooldown and per-minute limits without retaining a message-to-author link. The accepted timestamp is checked against the previous accepted send to enforce a full five elapsed seconds, while bounded minute slots enforce the hard ceiling during concurrent sends.

## Reporting And Moderation

`POST /api/comms/reports` requires the current session, exact origin, an existing visible message, and an allowlisted reason. A user cannot report their own message and duplicate reports are idempotent.

`POST /api/owner/comms/moderate` requires the platform-owner allowlist. Hide, restore, delete, resolve-report and dismiss-report actions write an append-only moderation audit row in the same D1 batch as their state change. Server ownership, subscriptions and display roles do not grant Global Chat moderation.

## Retention And Boundaries

Receipts expire after seven days. Newly accepted messages expire after thirty days. The authenticated retention route erases expired message text and author links, then removes expired receipts, timeouts and old quota slots. Deleted messages are erased immediately and open reports for that message are resolved. The dedicated platform-owner screen exposes the open queue and recent decision history. Production scheduling and activation remain separate operations governed by the activation-readiness checklist.

Comms reads and writes never alter billing, owner entitlement, server ownership, rankings, discovery, reviews, badges, seasons, events, Server Wars, CTF, XP, calling-card awards, profile visibility, retained exports or competitive eligibility.
