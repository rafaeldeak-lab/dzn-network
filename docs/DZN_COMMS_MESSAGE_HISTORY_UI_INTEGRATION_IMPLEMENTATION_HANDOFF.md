# DZN Comms Message-History UI Integration Implementation Handoff

## Status

Implementation slice for the approved disabled-by-default `/community` message-history UI integration.

Branch:

```text
codex/dzn-comms-message-history-ui-integration-implementation-20260831
```

Base:

```text
origin/codex/dzn-comms-message-history-ui-integration-approval-preflight-20260831
```

The protected OneDrive checkout was not modified.

## Architecture Found

- `/community` renders `DznCommsVisualShell`.
- The Comms shell already had static local mock messages, static emoji reaction previews, a disabled composer, static DZN Assist support copy, and a public-safe aggregate presence counter fallback.
- The message/read foundation already provided the disabled-by-default local/test route `GET /api/dzn-comms/channels/:channelId/messages`.
- The approval preflight already approved an optional UI fetch only behind `NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED` plus server read flags.

## Implemented

- Added `components/community/dzn-comms-message-history.ts`.
- Added explicit UI-to-route channel mapping for `global`, `new_players`, `server_owners`, `events`, and `pandora_squad`.
- Kept `support` as a static-only surface with no message-history fetch.
- Added a strict UI flag helper for `NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED`; only `true` enables reads.
- Added a same-origin GET-only message-history loader with credentials, `Accept: application/json`, `cache: "no-store"`, `AbortController` timeout, 25-message limit, cursor filtering, and 128000-byte payload cap.
- Added strict payload validation before rendering read-only history in `/community`.
- Added a guarded hook in `DznCommsVisualShell` that keeps static fallback when disabled, unavailable, denied, unauthenticated, timed out, malformed, or overlarge.
- Added compact status banners for static, loading, live, and fallback states.
- Added `Read-only` and `Locked` row badges for loaded history rows.
- Preserved the disabled composer and static emoji reaction preview behavior.
- Added `npm run test:dzn-comms-message-history-ui-integration`.
- Updated the master DZN spec and public access policy.

## Access Matrix

| Actor | Public-channel reads | Private group reads | Writes |
| --- | --- | --- | --- |
| Logged-out visitor | Static fallback, or login-required fallback if the client flag is enabled and the route rejects | Denied by route; static fallback only | Denied |
| Free Discord player | Visible public-channel messages only when client and server local/test flags are enabled | Active trusted DZN membership bridge required | Denied |
| Starter owner | Same as free player; no paid read advantage | Same trusted membership requirement | Denied |
| Pro or legacy effective Pro owner | Same as Starter; no paid read advantage | Same trusted membership requirement | Denied |
| DZN admin/moderator | Same unless a future staff-read slice is approved | Same unless a future staff-read slice is approved | Denied |

Owner entitlement alone is not private group membership. Paid plans do not change read access, ordering, page size, fallback behavior, author display, reaction availability, retention, moderation immunity, or competitive eligibility.

## Protected Surfaces

This slice keeps these blocked:

- No chat sending.
- No runtime reactions.
- No report routes.
- No moderation mutations.
- No DZN Assist AI runtime.
- No Durable Objects/WebSockets.
- No analytics/tracking.
- No Store/payment/live checkout changes.
- No production mutations.
- No retained exports.
- No browser storage or read receipts.
- No migrations or message table changes.
- No Stripe Product/Price/customer/webhook/refund/dispute mutation.
- No Cloudflare secret/config mutation.
- No production D1 apply or write.
- No Nitrado mutation.
- No Discord mutation.
- No deployment to `https://dayz-network.com/`.
- No issue #49 change.

The UI rejects payloads that expose hidden messages, unsafe profile links, malformed author data, unsupported roles, unsafe message ids, unexpected message kinds, or non-false effect flags.

The UI integration cannot affect billing, owner entitlement, server ownership, scoring, rankings, discovery, reviews, badges, seasons, events, Server Wars, CTF, XP awards, calling-card awards, public profile visibility, retained exports, or competitive eligibility.

## Validation To Run

- `npm run test:dzn-comms-message-history-ui-integration`
- `npm run test:dzn-comms-message-read-model-local-foundation`
- `npm run test:dzn-comms-visual-shell`
- `npm run test:dzn-comms-runtime-approval-preflight`
- `npm run test:dzn-comms-reaction-runtime-approval-preflight`
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

- `npm run test:dzn-comms-message-history-ui-integration`
- `npm run test:dzn-comms-message-history-ui-integration-approval-preflight`
- `npm run test:dzn-comms-message-read-model-local-foundation`
- `npm run test:dzn-comms-visual-shell`
- `npm run test:dzn-comms-runtime-approval-preflight`
- `npm run test:dzn-comms-reaction-runtime-approval-preflight`
- `npm run check:billing-config`
- `npx tsc --noEmit --incremental false`
- `npm run lint` with existing warnings only
- `npm run build`
- `npm test`
- `git diff --check`
- changed runtime source production-mutation scan

The first pre-commit run of `npm run test:dzn-comms-reaction-runtime-approval-preflight` failed because that historical guard checks dirty runtime files for its own preflight slice. It passed after the implementation commit when the tree was clean.

## Production-Mutation Confirmation

This source slice does not mutate:

- live Stripe products or prices
- live checkout configuration
- Cloudflare secrets
- Cloudflare config
- production D1
- Nitrado
- Discord
- retained exports
- runtime chat services
- message sending
- message persistence
- reaction storage
- report storage
- moderation tables
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

Only report this change as live after a later approved merge, deployment, and production URL verification.

## Next Recommended Slice

Next should be DZN Comms message-history rendered local/test QA: run a local flagged preview with controlled seeded public and private-group responses, capture the `/community` static-disabled, public-history-success, private-denied, login-required, unavailable, and support-static states, and prove the rendered UI still cannot send messages, add reactions, report/moderate, call DZN Assist AI, use Durable Objects/WebSockets, track analytics, alter Store/payment/live checkout, mutate production services, change retained exports, or affect competitive systems.

## Rendered QA Follow-Up

The DZN Comms Message-History Rendered Local/Test QA slice is now documented in `docs/DZN_COMMS_MESSAGE_HISTORY_RENDERED_QA.md` and `docs/DZN_COMMS_MESSAGE_HISTORY_RENDERED_QA_HANDOFF.md`.

That follow-up captures local/test `/community` desktop and mobile proof for static fallback, public-channel read, unavailable route fallback, and private-group denial while keeping chat sending, runtime reactions, report routes, moderation mutations, DZN Assist AI runtime, Durable Objects/WebSockets, analytics/tracking, Store/payment/live checkout, production mutations, retained exports, deployment, and competitive-system effects blocked.
