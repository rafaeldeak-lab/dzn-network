# DZN Store Account Purchases UI Shell Handoff

## Branch

Branch: `codex/dzn-store-account-purchases-ui-shell-20260831`

Base: `388be9fc28ef5851f07b7464b9088f9ea6698e90`

Stacked on: `codex/dzn-store-account-purchases-read-model-20260829`

Protected OneDrive checkout was not modified.

## Delivered

- Added `/account/purchases`.
- Added `components/store/dzn-store-account-purchases-page.tsx`.
- Added `scripts/test-dzn-store-account-purchases-ui-shell.ts`.
- Wired `test:dzn-store-account-purchases-ui-shell` into `package.json`.
- Added a `/store` preview link to the private Account Purchases shell.
- Updated Store docs/backlog/spec/policy references so the UI shell is no longer treated as future-only.

## Runtime Boundary

The UI is a client-side read-only shell over `GET /api/account/purchases`.

It uses:

- `credentials: "include"`
- `cache: "no-store"`
- `accept: "application/json"`
- A `401` redirect to `/login?returnTo=%2Faccount%2Fpurchases`

The API remains disabled by default. The page can show an unavailable state when the read model is off, but it cannot expose Store rows unless the existing private API returns them.

## Still Not Added

- No public Supporter Card reveal.
- Private Supporter Card reveal is handled by the later approved implementation slice.
- No Supporter Card serial number display outside that approved private reveal panel.
- No Supporter Card generated-art display.
- No `GET /api/account/entitlements`.
- No webhook replay route.
- No manual-review route.
- No refund/dispute operator route.
- No notification route or notification writes.
- No migration after `migrations/0073_dzn_store_fulfilment_ledger_schema.sql`.
- No production D1 migration apply.
- No live checkout activation.
- No earned-spin ledger.
- No reward wheel runtime.
- No Stripe Product, Price, Customer, Checkout Session, refund, dispute, payment, webhook endpoint, or API mutation.
- No Cloudflare variable, secret, binding, Pages config, Workers config, or production D1 mutation.
- No Nitrado, Discord, analytics, tracking, AI provider credentials, vector stores, or metered model calls.
- No issue #49 change.

## UI Output

The page may show only the current authenticated account's sanitized API output:

- Purchase reference.
- Product snapshot.
- Price snapshot.
- Purchase status.
- Guaranteed-purchase/account-bound/no-competitive-advantage labels.
- Sanitized payment receipt status.
- Fulfilment attempt status.
- Entitlement status.
- Private Supporter Card status.
- Display-safe status history.
- Refund/dispute local decision summary.

The page must not show raw Stripe IDs, payment method data, billing details, raw Discord IDs, raw internal DZN user/order/item/entitlement/card IDs, Supporter Card serial numbers, webhook raw bodies, raw provider payload JSON, operator notes, or any other user's Store records.

## Validation

Completed validation:

- `npm run test:dzn-store-account-purchases-ui-shell`
- Store payment/read-model focused regression tests.
- `npm run check:billing-config`
- `npx tsc --noEmit`
- `npm test`
- `npm run lint`
- `npm run build`
- `git diff --check`
- Local route smoke: `GET http://127.0.0.1:3071/account/purchases` returned `200`
- Codex Security diff scan: complete, zero findings

`npm run lint` completed with four existing warnings in unrelated files. `npm run check:billing-config` confirmed live checkout is not configured or enabled.

## Follow-On Delivered

The Store private Supporter Card reveal approval preflight is now delivered in `docs/DZN_STORE_SUPPORTER_CARD_REVEAL_APPROVAL_PREFLIGHT.md`.

It adds documentation and guard tests only. Supporter Card reveal remains blocked in `/account/purchases`, and the preflight adds no card reveal route, private reveal component, public reveal, card-art generation, sharing controls, screenshot/export controls, notifications, migrations, production D1 apply, live checkout activation, earned-spin ledger, reward wheel runtime, Stripe mutation, Cloudflare config mutation, production D1 write, or issue #49 change.

The Store private Supporter Card reveal implementation is now delivered separately in `docs/DZN_STORE_SUPPORTER_CARD_REVEAL_IMPLEMENTATION.md`.

It adds `GET /api/account/supporter-cards/[cardRef]/reveal` and a private `/account/purchases` panel that can display the Supporter Card serial/status only after current-account ownership proof. It still adds no generated card art, public Supporter Card reveal, sharing controls, screenshot/export controls, notifications, migrations, production D1 apply, live checkout activation, earned-spin ledger, reward wheel runtime, Stripe mutation, Cloudflare config mutation, production D1 write, or issue #49 change.

## Next Recommended Slice

Next should be the Store private Supporter Card reveal visual polish and manual QA slice only if deliberately approved: refine the private `/account/purchases` reveal panel styling/states and run rendered local QA for disabled, no purchases, revealable, unavailable, and cross-account-denied states. It should still add no card-art generation, public reveal, sharing controls, screenshot/export controls, notifications, live checkout activation, earned-spin ledger, reward wheel runtime, Stripe mutation, Cloudflare config mutation, production D1 writes, or issue #49 changes.

The personal player page/nav button remains a separate player UX slice.
