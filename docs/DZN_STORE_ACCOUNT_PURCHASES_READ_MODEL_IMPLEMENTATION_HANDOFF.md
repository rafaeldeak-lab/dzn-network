# DZN Store Account Purchases Read-Model Implementation Handoff

## Branch

Branch: `codex/dzn-store-account-purchases-read-model-20260829`

Base: `fe1a668b5abacc6f9fd85dc06cb936fcf28116f3`

Protected OneDrive checkout was not modified.

## Delivered

- Added `functions/_lib/dzn-store-account-purchases.ts`.
- Added `functions/api/account/purchases.ts`.
- Added `scripts/test-dzn-store-account-purchases-read-model.ts`.
- Wired `test:dzn-store-account-purchases-read-model` into `package.json`.
- Updated Store docs/backlog/spec/policy references so this route is no longer treated as future-only.

## Runtime Boundary

`GET /api/account/purchases` is disabled by default and returns no customer purchase data unless:

- `DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_ENABLED=true`
- `DZN_STORE_ENABLED=true`
- `DZN_STORE_SANDBOX_RUNTIME=local` or `test`
- Live checkout flags remain false.
- Earned-spin and reward-wheel flags remain false.
- The caller is authenticated.

The route is private/no-store, read-only, current-user scoped, active local/test sandbox-ledger scoped, and sanitized.

## Still Not Added

- No public Supporter Card reveal.
- No private Supporter Card reveal component.
- No Account Purchases UI page.
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

## Read Model Output

The route can return only the current user's:

- Customer-facing Store order number.
- Order/product/price snapshot status.
- Guaranteed-purchase/account-bound/no-competitive-advantage labels.
- Sanitized payment-event status.
- Fulfilment attempt status.
- Entitlement status.
- Private Supporter Card status.
- Display-safe status history and refund/dispute decision summaries.

The route must not return raw Stripe ids, payment method data, billing details, raw Discord ids, raw internal DZN user/order/item/entitlement/card ids, Supporter Card serial numbers, webhook raw bodies, raw provider payload JSON, operator notes, or any other user's Store records.

## Validation

Validation to run before final handoff:

- `npm run test:dzn-store-account-purchases-read-model`
- Store payment/read-model focused regression tests.
- `npm run check:billing-config`
- `npm run lint`
- `npm run build`
- `git diff --check`
- Codex Security diff scan

## Follow-On Delivered

Follow-on delivered separately: Store private Account Purchases UI shell in `docs/DZN_STORE_ACCOUNT_PURCHASES_UI_SHELL.md`. It adds `/account/purchases` and consumes only `GET /api/account/purchases`, while keeping Supporter Card reveal blocked and adding no webhook replay route, manual-review route, refund/dispute operator route, notifications, production migration apply, live checkout activation, earned-spin ledger, reward wheel runtime, Stripe mutation, Cloudflare config mutation, production D1 write, or issue #49 change.

## Next Recommended Slice

Next should be Store private Supporter Card reveal approval preflight only if deliberately approved.

The personal player page/nav button remains a separate player UX slice.
