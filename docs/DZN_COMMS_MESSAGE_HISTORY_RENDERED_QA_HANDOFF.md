# DZN Comms Message-History Rendered Local/Test QA Handoff

## Status

Rendered QA slice for the DZN Comms message-history UI integration.

Branch:

```text
codex/dzn-comms-message-history-rendered-qa-20260831
```

Base:

```text
origin/codex/dzn-comms-message-history-ui-integration-implementation-20260831
```

The protected OneDrive checkout was not modified.

## Architecture Found

- `/community` renders `DznCommsVisualShell`.
- The previous implementation added the optional UI fetch behind `NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED`.
- The UI is disabled by default and falls back to static mock data when disabled or unavailable.
- The existing route contract remains `GET /api/dzn-comms/channels/:channelId/messages`, read-only, authenticated, no-store, and local/test only.
- Public channel reads are free logged-in player access when all flags are deliberately enabled.
- Private group reads require trusted `dzn_comms_channel_memberships` membership and are not granted by owner entitlement or paid plan.

## Implemented

- Added `docs/DZN_COMMS_MESSAGE_HISTORY_RENDERED_QA.md`.
- Added this handoff.
- Added `scripts/test-dzn-comms-message-history-rendered-qa.ts`.
- Added `npm run test:dzn-comms-message-history-rendered-qa`.
- Added a durable local rendered artifact under `docs/artifacts/dzn-comms-message-history-rendered-qa/`.
- Updated the master DZN spec and public access policy with the rendered QA result.
- Updated the previous message-history UI implementation docs with this follow-up result.

## Rendered Coverage

| Case | Desktop | Mobile | Route behavior |
| --- | --- | --- | --- |
| Static fallback | Captured | Captured | No message-history route request |
| Public-channel read | Captured | Captured | Actual local Pages function route with seeded local/test D1 rows returned `200` |
| Unavailable route fallback | Captured | Captured | Actual local Pages function route with no usable local message store returned `503` |
| Private-group denial | Captured | Captured | Actual local Pages function route without trusted `pandora-squad` membership returned `403` |

The local Pages preview also produced unrelated `/api/auth/me` local schema noise for missing `linked_servers.merged_into_server_id` in the temporary D1 migration state. That was not changed in this slice because the requested message-history route still served the public, unavailable, and private-denial states correctly.

## Access Matrix

| Actor | Public-channel read display | Private group display | Writes |
| --- | --- | --- | --- |
| Logged-out visitor | Static fallback or login-required fallback if the route rejects | Denied by route; static fallback only | Denied |
| Free Discord player | Read-only public messages only when all local/test flags are enabled | Requires trusted private membership bridge | Denied |
| Starter owner | Same as free player; no paid read advantage | Same trusted private membership bridge | Denied |
| Pro or legacy effective Pro owner | Same as Starter; no paid read advantage | Same trusted private membership bridge | Denied |
| Admin/moderator | Same unless a later staff-read slice is approved | Same unless a later staff-read slice is approved | Denied |

## Protected Surfaces

No chat sending.
No runtime reactions.
No report routes.
No moderation mutations.
No DZN Assist AI runtime.
No Durable Objects/WebSockets.
No analytics/tracking.
No Store/payment/live checkout changes.
No production mutations.
No retained exports.

This slice does not add message persistence, reaction persistence, report persistence, moderation tables, support transcript storage, AI provider credentials, vector stores, metered model calls, browser storage, Store orders, Store entitlements, Supporter Cards, earned spins, reward-wheel runtime, Stripe Product or Price changes, Cloudflare secret or config changes, production D1 writes, Nitrado calls, Discord mutations, deployment, or issue #49 changes.

The rendered QA slice cannot affect billing, owner entitlement, server ownership, scoring, rankings, discovery, reviews, badges, seasons, events, Server Wars, CTF, XP awards, calling-card awards, public profile visibility, retained exports, or competitive eligibility.

## Validation To Run

- `npm run test:dzn-comms-message-history-rendered-qa`
- `npm run test:dzn-comms-message-history-ui-integration`
- `npm run test:dzn-comms-message-read-model-local-foundation`
- `npm run test:dzn-comms-visual-shell`
- `npm run check:billing-config`
- `npx tsc --noEmit --incremental false`
- `npm run lint`
- `npm run build`
- `git diff --check`
- changed-file scope check
- production-mutation scan
- manual rendered artifact inspection

## Production-Mutation Confirmation

This QA slice does not mutate:

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

This branch does not deploy to `https://dayz-network.com/`.

Only report the change as live after a separately approved merge, deployment, and production URL verification.

## Next Recommended Slice

Next should be DZN Comms message-history QA review and approval: inspect the rendered local/test artifact, decide whether the disabled-by-default UI integration is acceptable for merge, and only then approve a separate merge/deploy path. Runtime reactions, chat sending, report routes, moderation mutations, DZN Assist AI runtime, Durable Objects/WebSockets, analytics/tracking, Store/payment/live checkout, production mutations, retained exports, and competitive-system effects remain blocked until separately approved.
