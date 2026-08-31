# DZN Store Supporter Card Reveal Visual QA Handoff

## Branch

Branch: `codex/dzn-store-supporter-card-reveal-visual-qa-20260831`

Base: `c82af969b6d5e88b09a0ccd69284f94a0f03248c`

Stacked on: `codex/dzn-store-supporter-card-private-reveal-implementation-20260831`

Protected OneDrive checkout was not modified.

## Delivered

- Polished the private `/account/purchases` Supporter Card reveal panel in `components/store/dzn-store-account-purchases-page.tsx`.
- Added a stronger DZN Founding Supporter visual frame with a masked serial before reveal.
- Added clearer empty, loading, reveal-success, unavailable, and error states.
- Kept serial display limited to the existing private reveal success panel after current-account ownership proof.
- Added `docs/DZN_STORE_SUPPORTER_CARD_REVEAL_VISUAL_QA.md`.
- Added local seeded QA evidence under `docs/artifacts/dzn-store-supporter-card-reveal-visual-qa/`.
- Added `scripts/test-dzn-store-supporter-card-reveal-visual-qa.ts`.
- Wired `test:dzn-store-supporter-card-reveal-visual-qa` into `package.json`.
- Updated the DZN Comms static visual shell so reaction chips render actual emoji plus counts, with accessible labels retained.
- Updated the DZN Comms visual shell guard to prevent text-only reaction chips returning.

## Runtime Boundary

This slice is source-only visual QA and static UI polish.

The Store reveal page still requires:

- `DZN_STORE_ENABLED=true`
- `DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_ENABLED=true`
- `DZN_SUPPORTER_CARD_PRIVATE_REVEAL_ENABLED=true`
- `DZN_STORE_SANDBOX_RUNTIME=local` or `DZN_STORE_SANDBOX_RUNTIME=test`
- `DZN_LIVE_CHECKOUT_ENABLED` absent/false
- `DZN_STORE_LIVE_CHECKOUT_ENABLED` absent/false
- `DZN_EARNED_SPINS_ENABLED` absent/false
- `DZN_REWARD_WHEEL_ENABLED` absent/false

The page still calls only:

- `GET /api/account/purchases`
- `GET /api/account/supporter-cards/[cardRef]/reveal`

Both remain private/no-store, current-user scoped, and disabled by default unless local/test review flags are explicitly supplied.

## Access Matrix

| Surface | Behavior |
| --- | --- |
| `/account/purchases` | Private read-only account page; no successful data without the private read-model API |
| Supporter Card masked frame | Shows safe status and masked `DZN-SUP-******` before reveal |
| Private serial reveal | Shows serial/status only after the approved current-account reveal route succeeds |
| Empty state | Explains no current-account card exists without creating orders, cards, or checkout |
| Error/unavailable state | Shows blocked reveal state without leaking serials or private identifiers |
| DZN Comms reactions | Static visual emoji chips only; no chat runtime or persistence |

Starter/Pro owner entitlement does not expand Store reveal scope. DZN admin/operator scope is not used by this private account route.

## Still Not Added

- No generated card art.
- No public Supporter Card reveal.
- No sharing controls.
- No screenshot, download, export, print, or copy-link controls.
- No notification route or notification writes.
- No Store webhook replay route.
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
- No chat route, message table, Durable Object, WebSocket, message sending, or message persistence.
- No issue #49 change.

## Protected Surfaces

This slice does not affect owner billing, owner entitlement, `/setup`, Nitrado linking, server ownership, public discovery ranking, leaderboards, reviews, review score, badges, seasons, events, CTF scoring, Server Wars scoring, XP awards, calling-card awards, public profile visibility, retained exports, moderation decisions, earned spins, reward wheel state, chat history, support sessions, or competitive eligibility.

## Validation

Run before handoff:

- `npm run test:dzn-store-supporter-card-reveal-visual-qa`
- `npm run test:dzn-store-account-purchases-ui-shell`
- `npm run test:dzn-store-supporter-card-reveal-implementation`
- `npm run test:dzn-comms-visual-shell`
- `npm run check:billing-config`
- `npx tsc --noEmit --incremental false`
- `npm test`
- `npm run lint`
- `npm run build`
- `git diff --check`
- Production-mutation scan for migrations, Cloudflare config/secrets, Stripe mutation, production D1 writes, Nitrado, Discord, chat runtime, AI provider credentials, vector stores, live checkout, issue #49, and runtime tracking/storage calls.

## Production-Mutation Confirmation

This slice is source-only. It does not apply migrations, touch production D1, create or update Stripe objects, change Cloudflare secrets/config, call Nitrado, call Discord, add AI provider credentials, add vector stores, make metered model calls, enable live checkout, add chat runtime, persist messages, create notifications, add public reveal, generate card art, or change issue #49.

## Next Recommended Slice

Next should be the personal player page/nav access polish slice: add clearer logged-in access to `/player` and `/player/profile` through the header/account menu or another obvious player-facing route entry, without touching Store payment runtime or Supporter Card reveal safety.
