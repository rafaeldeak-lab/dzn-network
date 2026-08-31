# DZN Store Supporter Card Private Reveal Implementation Handoff

## Branch

Branch: `codex/dzn-store-supporter-card-private-reveal-implementation-20260831`

Base: `15da99a1b3ba3b7e0ceb2a002c95dc40c06301db`

Stacked on: `codex/dzn-store-supporter-card-reveal-preflight-20260831`

Protected OneDrive checkout was not modified.

## Delivered

- Added `functions/_lib/dzn-store-supporter-card-reveal.ts`.
- Added `functions/api/account/supporter-cards/[cardRef]/reveal.ts`.
- Added `docs/DZN_STORE_SUPPORTER_CARD_REVEAL_IMPLEMENTATION.md`.
- Added `scripts/test-dzn-store-supporter-card-reveal-implementation.ts`.
- Wired `test:dzn-store-supporter-card-reveal-implementation` into `package.json`.
- Updated the private Account Purchases read model to v2 so it can advertise `private_reveal_available` without listing Supporter Card serials.
- Updated `/account/purchases` with a private reveal panel that calls only `GET /api/account/supporter-cards/[cardRef]/reveal`.
- Updated Store docs/backlog/spec/policy references so the preflight is no longer treated as future-only.

## Runtime Boundary

The implementation is disabled by default and local/test-only.

Required flags:

- `DZN_STORE_ENABLED=true`
- `DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_ENABLED=true`
- `DZN_SUPPORTER_CARD_PRIVATE_REVEAL_ENABLED=true`
- `DZN_STORE_SANDBOX_RUNTIME=local` or `DZN_STORE_SANDBOX_RUNTIME=test`
- `DZN_LIVE_CHECKOUT_ENABLED` absent/false
- `DZN_STORE_LIVE_CHECKOUT_ENABLED` absent/false
- `DZN_EARNED_SPINS_ENABLED` absent/false
- `DZN_REWARD_WHEEL_ENABLED` absent/false

The route returns private/no-store JSON and varies by cookie.

## Access Matrix

| Surface | Logged-out user | Logged-in player | Owner Starter/Pro entitlement | DZN admin/operator |
| --- | --- | --- | --- | --- |
| `/account/purchases` | Static shell and login redirect behavior only | Own sanitized purchases/status and private reveal panel when flags allow | Same as player; owner plan adds no Store reveal scope | Same as player unless a separate operator route is approved |
| `GET /api/account/purchases` | `401` when enabled, otherwise unavailable | Own sanitized local/test Store ledgers only; no serials | Same as player | Same as player |
| `GET /api/account/supporter-cards/[cardRef]/reveal` | `401` when enabled | Own active/hidden fulfilled card only after reveal flag and ownership proof | Same as player; owner entitlement adds no scope | Not through this route; any support access must be separate and audited |
| Public reveal/card page | Absent | Absent | Absent | Absent |
| Card-art generation | Absent | Absent | Absent | Absent |
| Share/export/screenshot controls | Absent | Absent | Absent | Absent |

## Protected Surfaces

This slice does not touch owner billing, owner entitlement, `/setup`, Nitrado linking, server ownership, public discovery ranking, leaderboards, reviews, review score, badges, seasons, events, CTF scoring, Server Wars scoring, XP awards, calling-card awards, public profile visibility, retained exports, moderation decisions, earned spins, reward wheel state, or competitive eligibility.

## Still Not Added

- No generated card art.
- No public Supporter Card reveal.
- No sharing, screenshot, download, export, or copy-link controls.
- No notification route or notification writes.
- No webhook replay route.
- No manual-review route.
- No refund/dispute operator route.
- No migration after `migrations/0073_dzn_store_fulfilment_ledger_schema.sql`.
- No production D1 migration apply.
- No live checkout activation.
- No earned-spin ledger.
- No reward wheel runtime.
- No Stripe Product, Price, Customer, Checkout Session, refund, dispute, payment, webhook endpoint, or API mutation.
- No Cloudflare variable, secret, binding, Pages config, Workers config, or production D1 mutation.
- No Nitrado, Discord, analytics, tracking, AI provider credentials, vector stores, or metered model calls.
- No issue #49 change.

## Validation

Run before handoff:

- `npm run test:dzn-store-supporter-card-reveal-implementation`
- `npm run test:dzn-store-supporter-card-reveal-approval-preflight`
- `npm run test:dzn-store-account-purchases-ui-shell`
- `npm run test:dzn-store-account-purchases-read-model`
- `npm run test:dzn-store-fulfilment-reconciliation-read-model-preflight`
- `npm run test:dzn-safe-monetisation-supporter-preflight`
- `npm run check:billing-config`
- `npx tsc --noEmit`
- `npm test`
- `npm run lint`
- `npm run build`
- `git diff --check`
- Codex Security diff scan against base `15da99a1b3ba3b7e0ceb2a002c95dc40c06301db`.

## Production-Mutation Confirmation

This slice is source-only. It does not apply migrations, touch production D1, create or update Stripe objects, change Cloudflare secrets/config, call Nitrado, call Discord, add AI provider credentials, add vector stores, make metered model calls, enable live checkout, or change issue #49.

## Next Recommended Slice

Next should be the Store private Supporter Card reveal visual polish and manual QA slice only if deliberately approved: refine the private `/account/purchases` reveal panel styling/states and run rendered local QA for disabled, no purchases, revealable, unavailable, and cross-account-denied states. It should still add no card-art generation, public reveal, sharing controls, screenshot/export controls, notifications, live checkout activation, earned-spin ledger, reward wheel runtime, Stripe mutation, Cloudflare config mutation, production D1 writes, or issue #49 changes.

The personal player page/nav button remains a separate player UX slice.
