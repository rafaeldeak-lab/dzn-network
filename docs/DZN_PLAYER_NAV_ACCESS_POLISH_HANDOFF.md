# DZN Player Navigation Access Polish Handoff

## Status

Delivered as an isolated player UX navigation/access polish slice.

Branch:

```text
codex/dzn-player-nav-access-polish-20260831
```

Base:

```text
origin/codex/dzn-store-supporter-card-reveal-visual-qa-20260831
```

The protected OneDrive checkout was not modified.

## Implemented

- Added an authenticated-only `My Player` action in the shared DZN header.
- Wired the header action to `/player`.
- Exposed `/player/profile` as a stable QA path through the same authenticated player action.
- Added a direct `My Profile` action in the Player Hub hero.
- Added `player_home_url` and `player_profile_url` to the read-only auth navigation summary.
- Added a focused regression/safety test: `npm run test:player-nav-access-polish`.
- Updated the public access policy and master platform spec.

## Boundaries Preserved

This slice adds no Store payment, Supporter Card reveal, checkout, entitlement, wheel, chat runtime, or competitive-system behavior.

Still blocked:

- Store order creation.
- Store Checkout Session creation.
- Store webhooks.
- Store entitlement writes.
- Supporter Card issuance.
- Generated Supporter Card art.
- Public Supporter Card reveal.
- Supporter Card sharing, screenshot, or export controls.
- Notifications.
- Live checkout activation.
- Stripe Product/Price/customer/webhook mutation.
- Cloudflare secret/config mutation.
- Production D1 writes or migration applies.
- Earned spins.
- Reward wheel runtime.
- Real chat routes.
- Runtime Comms reactions.
- Durable Objects/WebSockets.
- AI provider credentials, vector stores, or metered calls.
- Analytics/tracking.
- Nitrado or Discord mutations.
- Ranking, discovery, review-score, badges, seasons, events, CTF, Server Wars, XP awards, calling-card awards, public profile visibility, retained exports, moderation decisions, or competitive eligibility changes.
- Issue `#49`.

## Access Matrix

| Actor | `/player` | `/player/profile` | `/setup` | `/dashboard` |
| --- | --- | --- | --- | --- |
| Visitor | Login redirect | Login redirect | Login then owner pricing if not entitled | Login then owner pricing if not entitled |
| Free Discord player | Allowed | Allowed | Owner pricing required | Owner pricing required |
| Starter trial/active owner | Allowed | Allowed | Allowed | Allowed |
| Pro owner | Allowed | Allowed | Allowed | Allowed |

## Validation Completed

- `npm run test:player-nav-access-polish`
- `npm run test:nav-access-visibility`
- `npm run test:player-hub-foundation`
- `npm run test:dzn-store-fulfilment-ledger-schema-preflight`
- `npm run test:player-profile-progression-showcase`
- `npm run test:dzn-store-supporter-card-reveal-visual-qa`
- `npm run test:dzn-comms-interaction-contract-preflight`
- `npm run test:dzn-comms-visual-shell`
- `npm run check:billing-config`
- `npx tsc --noEmit --incremental false`
- `npm run lint`
- `npm run build`
- `npm test`
- `git diff --check`

Local preview route smoke passed with 200 responses for `/`, `/player`, `/player/profile`, `/pricing`, `/account/purchases`, and `/community`.

Codex Security diff scan `3942fe5c-2202-4ae7-93a9-5280653adc63` completed with zero findings across the player navigation/access diff. TAC advisory could not be verified because the Codex Security Access connector was not connected.

`npm run lint` passed with pre-existing warnings outside this slice in public image usage and an unused dashboard API variable; this slice did not edit those files.

## Manual QA

Use a local dev server and verify:

- `/` still renders the public home route.
- Authenticated header state shows `My Player`.
- `My Player` opens `/player`.
- `/player` hero shows `My Profile`.
- `My Profile` opens `/player/profile`.
- `/pricing`, `/store`, and `/account/purchases` are visually unchanged by this slice except for shared header behavior where applicable.
- `/community` still uses the static visual shell and does not gain runtime reactions.

## Next Recommended Slice

Next recommended slice: DZN Comms reaction interaction contract preflight.

That slice should define the future reaction add/remove/list/read API shape, emoji allow-list, count aggregation, current-user reaction state, per-user idempotency, rate limits, moderation visibility, privacy boundaries, retention/logging, rollback, and proof matrix before any runtime reaction route, message table, reaction table, Durable Object, WebSocket, persistence, analytics/tracking, AI provider, vector store, metered model call, live checkout, production mutation, or issue #49 change is implemented.

That slice is now captured in `docs/DZN_COMMS_REACTION_INTERACTION_CONTRACT_PREFLIGHT.md` and remains runtime-blocking until a later reaction runtime implementation approval preflight is deliberately approved.
