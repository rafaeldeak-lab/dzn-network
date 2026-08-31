# DZN Comms Message-History UI Integration Approval Preflight Handoff

## Status

Documentation/test-only approval preflight for the future `/community` message-history UI fetch.

Branch:

```text
codex/dzn-comms-message-history-ui-integration-approval-preflight-20260831
```

Base:

```text
origin/codex/dzn-comms-message-read-model-local-read-foundation-20260831
```

The protected OneDrive checkout was not modified.

## Architecture Found

- The DZN Comms visual shell already renders `/community` through `DznCommsVisualShell`.
- The Comms shell already uses static local mock messages, static emoji reaction previews, a disabled composer, and no DZN Assist AI runtime.
- The previous message/read foundation already added the disabled-by-default local/test route `GET /api/dzn-comms/channels/:channelId/messages`.
- The previous message/read foundation kept `/community` static until a later UI integration slice.
- The public live presence counter is a separate aggregate-only feature and is not message history.

## Implemented

- Added `docs/DZN_COMMS_MESSAGE_HISTORY_UI_INTEGRATION_APPROVAL_PREFLIGHT.md`.
- Defined that `/community` may later fetch message history only behind `NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED=true` and the existing server-side read flags.
- Defined future channel mapping for `global`, `new_players`, `server_owners`, `events`, and `pandora_squad`.
- Kept the support surface static and outside message-history reads.
- Defined fallback, loading, success, 400, 401, 403, 404, 503, timeout, and malformed-response behavior.
- Defined no-store, no browser persistence, no read-receipt, no analytics, and no mutation UI rules.
- Updated the master DZN platform spec, public access policy, and previous Comms message-read handoff docs.
- Added `npm run test:dzn-comms-message-history-ui-integration-approval-preflight`.

## Not Implemented

- No `/community` UI fetch.
- No UI message-history hook.
- No message send runtime.
- No runtime emoji reaction route.
- No report route.
- No moderation mutation route.
- No DZN Assist AI runtime.
- No support transcript persistence.
- No Durable Object.
- No WebSocket.
- No analytics/tracking.
- No Store/payment change.
- No account entitlement write.
- No Supporter Card change.
- No earned-spin ledger.
- No reward wheel runtime.
- No migration.
- No Cloudflare config or secret mutation.
- No production D1 apply or write.
- No Stripe Product/Price/customer/webhook/refund/dispute mutation.
- No Nitrado mutation.
- No Discord mutation.
- No retained export change.
- No deployment to `https://dayz-network.com/`.
- No issue #49 change.

## Access Matrix

| Actor | Future public channel history | Future private group history | Writes |
| --- | --- | --- | --- |
| Logged-out visitor | Static fallback only | Denied | Denied |
| Free Discord player | Visible public-channel messages when local/test flags are enabled | Active trusted membership required | Denied |
| Starter owner | Same as free player; no paid read advantage | Same membership proof required | Denied |
| Pro owner or legacy effective Pro | Same as Starter; no paid read advantage | Same membership proof required | Denied |
| DZN admin/moderator | Same unless a future staff-read slice is approved | Same unless a future staff-read slice is approved | Denied |

Starter, Pro, legacy Premium, Network, and Partner plan values must not alter message visibility, ordering, page size, fallback behavior, author display, private group access, reaction availability, moderation immunity, safety checks, retention, scoring, rankings, discovery, reviews, badges, seasons, events, Server Wars, CTF, XP, calling-card awards, public profile visibility, retained exports, or competitive eligibility.

## Protected Surfaces

The future UI may render only the already-approved message-read payload and must keep hidden fields out of the browser:

- raw DZN user IDs
- Discord IDs
- Discord OAuth tokens
- private emails
- hidden profile fields
- private profile handles
- billing/customer/order/payment fields
- owner entitlement identifiers
- Stripe identifiers
- Nitrado identifiers
- IP addresses
- user agents
- referrers
- route history
- moderation evidence
- report notes
- support prompts or support answers
- retained export rows
- raw award evidence
- raw ledger rows

The UI fetch must remain presentation-only and cannot affect billing, owner entitlement, server ownership, Store purchases, live checkout, Supporter Cards, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars scoring, CTF scoring, XP awards, calling-card awards, public profile visibility, retained exports, analytics/tracking, AI support state, moderation decisions, or competitive eligibility.

## Validation To Run

- `npm run test:dzn-comms-message-history-ui-integration-approval-preflight`
- `npm run test:dzn-comms-message-read-model-local-foundation`
- `npm run test:dzn-comms-message-read-model-approval-preflight`
- `npm run test:dzn-comms-reaction-runtime-approval-preflight`
- `npm run test:dzn-comms-reaction-contract-preflight`
- `npm run test:dzn-comms-interaction-contract-preflight`
- `npm run test:dzn-comms-runtime-approval-preflight`
- `npm run test:dzn-comms-visual-shell`
- `npm run test:dzn-comms-live-presence-counter`
- `npm run test:player-nav-access-polish`
- `npm run test:player-owner-access-foundation`
- `npm run check:billing-config`
- `npx tsc --noEmit --incremental false`
- `npm run lint`
- `npm run build`
- `npm test`
- `git diff --check`
- changed-file scope check
- production-mutation scan
- Codex Security diff scan

## Validation Result

Completed on this branch.

Passed:

- `npm run test:dzn-comms-message-history-ui-integration-approval-preflight`
- `npm run test:dzn-comms-message-read-model-local-foundation`
- `npm run test:dzn-comms-message-read-model-approval-preflight`
- `npm run test:dzn-comms-reaction-runtime-approval-preflight`
- `npm run test:dzn-comms-reaction-contract-preflight`
- `npm run test:dzn-comms-interaction-contract-preflight`
- `npm run test:dzn-comms-runtime-approval-preflight`
- `npm run test:dzn-comms-visual-shell`
- `npm run test:dzn-comms-live-presence-counter`
- `npm run test:player-nav-access-polish`
- `npm run test:player-owner-access-foundation`
- `npm run check:billing-config`
- `npx tsc --noEmit --incremental false`
- `npm run lint` with existing warnings only
- `npm run build`
- `npm test`
- `git diff --check`
- `git diff --cached --check`
- changed-file scope check
- production-mutation scan

Codex Security diff scan is completed before PR handoff; the final report records the scan ID and confirms zero findings.

## Production-Mutation Confirmation

This slice does not mutate:

- live Stripe products or prices
- live checkout configuration
- Cloudflare secrets
- Cloudflare config
- production D1
- Nitrado
- Discord
- retained exports
- runtime chat services
- message storage
- reaction storage
- moderation tables
- report tables
- support transcript storage
- AI provider credentials
- vector stores
- metered model calls
- analytics/tracking systems
- deployments
- issue #49

Live checkout remains disabled. Issue #49 remains reserved for final live payment activation.

## Live-Site Boundary

This PR does not deploy to `https://dayz-network.com/`.

Only report message-history UI integration as live after a later approved implementation PR is merged, deployed, and verified on the production URL.

## Next Recommended Slice

Next should be the DZN Comms message-history UI integration implementation: wire `/community` to optionally fetch `GET /api/dzn-comms/channels/:channelId/messages` only behind `NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED` plus the disabled-by-default server read flags, keep static fallback as the default and failure path, preserve the disabled composer, and continue blocking chat sending, runtime reactions, report routes, moderation mutations, DZN Assist AI runtime, Durable Objects/WebSockets, analytics/tracking, Store/payment/live checkout changes, production mutations, retained exports, and competitive-system effects.
