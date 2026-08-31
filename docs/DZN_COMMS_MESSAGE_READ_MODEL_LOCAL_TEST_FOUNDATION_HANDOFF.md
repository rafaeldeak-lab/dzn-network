# DZN Comms Message/Read Model Local/Test Foundation Handoff

## Status

Implementation slice for the approved local/test read-only DZN Comms message-history foundation.

Branch:

```text
codex/dzn-comms-message-read-model-local-read-foundation-20260831
```

Base:

```text
origin/codex/dzn-comms-message-read-model-approval-preflight-20260831
```

The protected OneDrive checkout was not modified.

## Implemented

- Added `migrations/0074_dzn_comms_message_read_model.sql`.
- Added `functions/_lib/dzn-comms-message-read.ts`.
- Added `GET /api/dzn-comms/channels/:channelId/messages`.
- Added `npm run test:dzn-comms-message-read-model-local-foundation`.
- The `/community` route remains on the static local mock-data shell unless a later UI integration slice enables runtime fetching.

## Schema

The source migration adds only:

```text
dzn_comms_channels
dzn_comms_channel_memberships
dzn_comms_messages
dzn_comms_message_visibility_events
```

The schema is read-focused and additive. It does not add message sending tables, reaction tables, report tables, moderation mutation tables, warning/timeout tables, support transcript tables, DZN Assist AI source/vector tables, analytics tables, Store/payment tables, retained export tables, ranking tables, discovery tables, review score tables, event result tables, CTF rows, Server Wars rows, XP rows, calling-card award rows, Nitrado rows, or Discord mutation rows.

## Feature Flags

All flags remain disabled by default:

```text
DZN_COMMS_MESSAGE_READ_ENABLED=false
DZN_COMMS_MESSAGE_READ_LOCAL_TEST_RUNTIME=false
DZN_COMMS_PUBLIC_CHANNEL_HISTORY_ENABLED=false
DZN_COMMS_PRIVATE_GROUP_HISTORY_ENABLED=false
NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED=false
```

The route requires:

- `DZN_COMMS_MESSAGE_READ_ENABLED=true`
- `DZN_COMMS_MESSAGE_READ_LOCAL_TEST_RUNTIME=local` or `test`
- `DZN_COMMS_PUBLIC_CHANNEL_HISTORY_ENABLED=true` for public channel reads
- `DZN_COMMS_PRIVATE_GROUP_HISTORY_ENABLED=true` for private group reads

`true`, `production`, `preview`, `remote`, missing, and false runtime values do not enable the local/test runtime boundary.

## Access Matrix

| Actor | Public channel reads | Private group reads | Writes |
| --- | --- | --- | --- |
| Logged-out visitor | API denied; static `/community` fallback only | Denied | Denied |
| Free Discord player | Visible public messages when local/test flags are enabled | Active trusted membership required | Denied |
| Starter owner | Same as free player; no paid read advantage | Same membership proof required | Denied |
| Pro owner | Same as Starter; no paid read advantage | Same membership proof required | Denied |
| DZN admin/moderator | Same unless a later staff-read slice is approved | Same unless a later staff-read slice is approved | Denied |

Free logged-in Discord players may read visible public-channel messages without payment. Private group reads require active trusted membership. Owner entitlement alone is not private group membership.

## Protected Surfaces

The route returns:

- `visible` and `locked` message bodies only.
- Public-safe display author fields only.
- No-store authenticated/private responses.
- Opaque pagination cursors.

The route does not return:

- hidden/deleted/quarantined/expired/staff-only bodies
- expired-by-time messages
- rejected send attempts
- filtered or blocked bodies
- support prompts or answers
- moderation notes
- report notes
- raw evidence
- raw DZN user IDs
- Discord IDs
- Discord OAuth tokens
- private emails
- hidden profile fields
- billing identifiers
- owner entitlement identifiers
- Nitrado identifiers
- IP addresses
- user agents
- referrers
- route history
- retained exports
- raw ledger rows

This first implementation intentionally returns `profileHref: null`; author profile links require a separate public-profile attribution check against saved visibility preferences.

## Production-Mutation Confirmation

This source slice does not:

- apply the migration to production D1
- deploy to `https://dayz-network.com/`
- mutate Cloudflare config/secrets/variables
- mutate Stripe Products/Prices/customers/webhooks
- enable live checkout
- change Store/payment fulfilment
- create account entitlements
- issue Supporter Cards
- mint earned spins
- run a reward wheel
- call Nitrado
- mutate Discord resources
- create Durable Objects or WebSockets
- create analytics/tracking calls
- create AI provider credentials, vector stores, or metered model calls
- create retained exports
- merge or change issue #49

Live checkout remains disabled. Issue #49 remains reserved for final live payment activation.

## Validation To Run

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
- `npm run test:dzn-store-fulfilment-ledger-schema-migration`
- `npm run test:dzn-store-fulfilment-runtime-implementation-preflight`
- `npm run test:dzn-store-fulfilment-reconciliation-read-model-preflight`
- `npm run test:dzn-store-account-purchases-read-model`
- `npm run test:dzn-store-account-purchases-ui-shell`
- `npm run test:dzn-store-supporter-card-reveal-approval-preflight`
- `npm run test:dzn-store-supporter-card-reveal-implementation`
- `npm run check:billing-config`
- `npx tsc --noEmit --incremental false`
- `npm run lint` with existing warnings only
- `npm run build`
- `npm test`
- `git diff --check`
- changed-file scope check
- production-mutation scan

Codex Security diff scan:

```text
d5df3641-9323-4679-aade-b9491e2294c0
```

Result: complete coverage of the 18 changed source/test/config surfaces and zero findings.

TAC advisory could not be verified because the Codex Security Access connector was not connected; the scan continued and completed without TAC-gated output assumptions.

## Live-Site Boundary

This slice does not deploy to `https://dayz-network.com/`.

Only report message history as live after a later approved PR is merged, deployed, and verified on the production URL.

## Next Recommended Slice

The DZN Comms message-history UI integration approval preflight is documented in `docs/DZN_COMMS_MESSAGE_HISTORY_UI_INTEGRATION_APPROVAL_PREFLIGHT.md`.

Next should be the DZN Comms message-history UI integration implementation: wire `/community` to optionally fetch `GET /api/dzn-comms/channels/:channelId/messages` only behind `NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED` plus the disabled-by-default server read flags, keep static fallback as the default and failure path, preserve the disabled composer, and continue blocking chat sending, runtime reactions, report routes, moderation mutations, DZN Assist AI runtime, Durable Objects/WebSockets, analytics/tracking, Store/payment/live checkout changes, production mutations, retained exports, and competitive-system effects.
