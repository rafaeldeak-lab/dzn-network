# DZN Store Account Purchases UI Shell

## Status And Boundary

This slice implements the approved private Account Purchases UI shell for the existing Store read model.

It adds:

- `app/account/purchases/page.tsx`
- `components/store/dzn-store-account-purchases-page.tsx`
- `scripts/test-dzn-store-account-purchases-ui-shell.ts`
- A `/store` preview link to `/account/purchases`

The UI is authenticated through the existing private read model. It performs one client-side `GET /api/account/purchases` request with `credentials: "include"` and `cache: "no-store"`. If the API returns `401`, the browser redirects to `/login?returnTo=%2Faccount%2Fpurchases`.

The read-model API remains disabled by default behind `DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_ENABLED=false`. The page may render an unavailable/locked state when the API is not enabled, but it must not show private Store rows unless the API itself returns a successful current-user payload.

This slice does not add, enable, create, mutate, or approve:

- No public Supporter Card reveal.
- Supporter Card serial display is limited to the approved private reveal panel delivered separately in `docs/DZN_STORE_SUPPORTER_CARD_REVEAL_IMPLEMENTATION.md`.
- No Supporter Card generated-art display.
- No `GET /api/account/entitlements`.
- No webhook replay route.
- No manual-review route.
- No refund/dispute operator route.
- No notifications.
- No migration.
- No production migration apply.
- No live checkout activation.
- No earned-spin ledger.
- No reward wheel runtime.
- No Stripe Product, Price, Customer, Checkout Session, refund, dispute, payment, webhook endpoint, or API mutation.
- No Cloudflare variable, secret, binding, Pages config, Workers config, or production D1 mutation.
- No Nitrado, Discord, analytics, tracking, AI provider credentials, vector stores, or metered model calls.
- No issue #49 change.

`DZN_LIVE_CHECKOUT_ENABLED` remains unset/false. `DZN_STORE_LIVE_CHECKOUT_ENABLED` remains unset/false. Issue #49 remains reserved for final live checkout activation.

## Architecture Found

The previous slice delivered `GET /api/account/purchases` as a private, current-user, no-store, sanitized local/test read model over the Store order, payment event, fulfilment, entitlement, Supporter Card, status-history, and refund/dispute ledgers.

This slice originally consumed that contract without adding a new server route or schema. The follow-on Store private Supporter Card reveal implementation is now delivered separately in `docs/DZN_STORE_SUPPORTER_CARD_REVEAL_IMPLEMENTATION.md`; it adds `GET /api/account/supporter-cards/[cardRef]/reveal` as a disabled-by-default current-account read route.

The UI treats the API contracts as the only authority for Store purchase and reveal visibility:

- The component does not import Store fulfilment, checkout, webhook, owner-billing, Nitrado, ranking, review, event, XP, calling-card, wheel, or admin helpers at runtime.
- The component does not write browser storage.
- The component does not emit tracking events or analytics calls.
- The component does not call Store order, Store checkout, Store webhook, Store operator, billing, wheel, profile-privacy, progression, review, event, or ranking endpoints.
- The component may call only the approved private read route `GET /api/account/supporter-cards/[cardRef]/reveal` when the Account Purchases v2 payload marks a current-account card as privately revealable.
- The component does not render raw internal IDs or payment provider IDs because the API contract does not return them.

## UI Contract

`/account/purchases` shows:

- Account display name from the sanitized payload.
- Purchase count, entitlement count, and private Supporter Card status count.
- Purchase reference, product snapshot, order status, price snapshot, terms version, label state, sanitized receipt status, fulfilment status, entitlement status, Supporter Card status, order history, entitlement history, and refund/dispute local decision summary.
- Entitlement status cards for the current account.
- Private Supporter Card status cards that show status, visibility state, selected theme key, supporter-since timestamp, issue/suspend/revoke timestamps, and the blocked reveal reason.
- A private reveal panel that can show the Supporter Card serial only after `GET /api/account/supporter-cards/[cardRef]/reveal` proves current-account ownership.
- A Fair Progression Boundary panel stating the UI is presentation-only.

The page declares these machine-readable safety markers:

- `data-dzn-store-account-purchases-ui="read-only"`
- `data-dzn-store-account-purchases-endpoint="/api/account/purchases"`
- `data-supporter-card-reveal="private-local-test-guarded"`
- `data-public-supporter-card-reveal="blocked"`
- `data-store-runtime="read-only-account-ui"`
- `data-live-checkout="disabled"`
- `data-production-mutation="none"`

The page must not render:

- Supporter Card serial numbers outside the approved private reveal panel.
- Raw Store order IDs.
- Raw Store order item IDs.
- Raw account entitlement IDs.
- Raw Supporter Card IDs.
- Raw DZN user IDs.
- Raw Discord IDs.
- Raw Stripe IDs.
- Customer email, address, payment method, card brand, card last four, or card tokens.
- Webhook raw bodies or raw provider payloads.
- Operator notes.
- Other users' purchase, entitlement, payment, fulfilment, or Supporter Card rows.

## Entitlement And Access Matrix

| Surface | Logged-out user | Logged-in player | Owner Starter/Pro entitlement | DZN admin/operator |
| --- | --- | --- | --- | --- |
| `/account/purchases` shell | Static shell may load; successful private data requires API auth | Can view own sanitized Store purchases only when read model is explicitly enabled | Same as player; owner plan adds no Store UI advantage | Same as player unless a separate admin/operator route is approved |
| `GET /api/account/purchases` flag off | `404`, no ledger read | `404`, no ledger read | Same as player | Same as player |
| `GET /api/account/purchases` flag on | `401`, no Store purchase data | Current user's sanitized local/test Store ledgers only | Same as player; owner entitlement does not expand scope | Same as player; admin scope is not used by this route |
| Supporter Card private reveal | `401` when enabled | Own active/hidden fulfilled card only after reveal flag and ownership proof | Same as player; owner entitlement adds no scope | Not through this route; any support access must be separate and audited |
| Supporter Card public reveal | Absent | Absent | Absent | Absent |
| Webhook replay/manual review/refund workflow | Absent | Absent | Absent | Absent |

Store account entitlements remain account-bound cosmetic/supporter status only. They must never grant Starter, Pro, owner setup, Nitrado access, server ownership, or owner tools.

## Protected Surfaces

This UI shell does not read from or write to:

- Owner billing accounts.
- Owner plan entitlements.
- Server ownership.
- `/setup`.
- Nitrado linking.
- Public discovery ranking.
- Leaderboards.
- Reviews or review score.
- Badges.
- Seasons.
- Events.
- CTF scoring.
- Server Wars scoring.
- XP awards.
- Calling-card awards.
- Public profile visibility.
- Retained exports.
- Moderation decisions.
- Earned spins or reward wheel tables.
- Competitive eligibility.

## Validation

Completed validation for this slice:

- `npm run test:dzn-store-account-purchases-ui-shell`
- `npm run test:dzn-store-account-purchases-read-model`
- `npm run test:dzn-store-fulfilment-reconciliation-read-model-preflight`
- `npm run test:dzn-store-fulfilment-runtime-implementation`
- `npm run test:dzn-store-fulfilment-runtime-implementation-preflight`
- `npm run test:dzn-store-fulfilment-ledger-schema-migration`
- `npm run test:dzn-store-fulfilment-ledger-schema-preflight`
- `npm run test:dzn-store-webhook-fulfilment-approval-preflight`
- `npm run test:dzn-store-sandbox-webhook-ledger-receipt`
- `npm run test:dzn-store-sandbox-checkout-session-approval`
- `npm run test:dzn-store-sandbox-order-route-approval`
- `npm run test:dzn-store-order-ledger-schema`
- `npm run test:dzn-store-public-preview-contract`
- `npm run test:dzn-safe-monetisation-supporter-preflight`
- `npm run check:billing-config`
- `npx tsc --noEmit`
- `npm test`
- `npm run lint`
- `npm run build`
- `git diff --check`
- Local route smoke: `GET http://127.0.0.1:3071/account/purchases` returned `200`
- Codex Security diff scan: complete, zero findings

`npm run lint` completed with four existing warnings in unrelated files. `npm run check:billing-config` confirmed Stripe secrets/prices and `DZN_LIVE_CHECKOUT_ENABLED` are not configured for live checkout.

## Follow-On Delivered

The Store private Supporter Card reveal approval preflight is now delivered in `docs/DZN_STORE_SUPPORTER_CARD_REVEAL_APPROVAL_PREFLIGHT.md`.

It defines the future private reveal contract, serial/art redaction boundaries, account ownership proof, visibility controls, screenshot/export rules, audit requirements, rollback path, and security proof.

The delivered preflight adds no card reveal route, private reveal component, public reveal, card-art generation, sharing controls, screenshot/export controls, notifications, migrations, production D1 apply, live checkout activation, earned-spin ledger, reward wheel runtime, Stripe mutation, Cloudflare config mutation, production D1 write, or issue #49 change.

The Store private Supporter Card reveal implementation is now delivered separately in `docs/DZN_STORE_SUPPORTER_CARD_REVEAL_IMPLEMENTATION.md`.

It adds `GET /api/account/supporter-cards/[cardRef]/reveal` and a private `/account/purchases` reveal panel. Supporter Card serial display is limited to the approved private reveal panel after current-account ownership proof. It still adds no generated card art, public Supporter Card reveal, sharing controls, screenshot/export controls, notifications, migrations, production D1 apply, live checkout activation, earned-spin ledger, reward wheel runtime, Stripe mutation, Cloudflare config mutation, production D1 write, or issue #49 change.

## Next Recommended Slice

Next should be the Store private Supporter Card reveal visual polish and manual QA slice only if deliberately approved: refine the private `/account/purchases` reveal panel styling/states and run rendered local QA for disabled, no purchases, revealable, unavailable, and cross-account-denied states. It should still add no card-art generation, public reveal, sharing controls, screenshot/export controls, notifications, live checkout activation, earned-spin ledger, reward wheel runtime, Stripe mutation, Cloudflare config mutation, production D1 writes, or issue #49 changes.

The personal player page/nav button remains a separate player UX slice.
