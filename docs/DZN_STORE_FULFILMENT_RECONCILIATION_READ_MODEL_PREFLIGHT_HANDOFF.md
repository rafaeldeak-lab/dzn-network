# DZN Store Fulfilment Reconciliation/Read-Model Preflight Handoff

## Branch And Scope

Branch: `codex/dzn-store-fulfilment-reconciliation-preflight-20260829`

Base: `9ac2a92cd4b622823ff0bae0e3f10054101c651e`

Protected OneDrive checkout was not modified.

This slice is approval preflight only. It defines future private Store reconciliation/read-model contracts and adds no customer route, operator route, public reveal UI, migration, notification, live checkout activation, production D1 apply, Stripe mutation, Cloudflare config mutation, earned-spin ledger, reward wheel runtime, or issue #49 change.

## What Changed

- Added `docs/DZN_STORE_FULFILMENT_RECONCILIATION_READ_MODEL_PREFLIGHT.md`.
- Added `scripts/test-dzn-store-fulfilment-reconciliation-read-model-preflight.ts`.
- Wired `test:dzn-store-fulfilment-reconciliation-read-model-preflight` into `package.json` and the full `npm test` chain.
- Updated Store payment docs, the master platform spec, public access policy, billing plan notes, and Stripe live checklist so the backlog sequence records this preflight as delivered.

## Defined Future Contracts

The preflight defines these future contracts only:

- Private Account Purchases and Entitlements read model.
- Private Supporter Card reveal/status UI.
- Admin-only webhook replay controls.
- Admin-only manual-review controls.
- Admin-only refund/dispute operator queue and workflow.
- Future feature flags that must remain absent from source config until an implementation slice deliberately adds them.

## Explicit Non-Implementation Boundary

This slice intentionally adds:

- No `GET /api/account/purchases`.
- No `GET /api/account/entitlements`.
- No account purchases page.
- No public Supporter Card reveal.
- No private Supporter Card reveal component.
- No webhook replay route.
- No manual-review route.
- No refund/dispute operator route.
- No notification route or notification writes.
- No migration after `migrations/0073_dzn_store_fulfilment_ledger_schema.sql`.
- No new Cloudflare environment variable declarations.
- No live checkout.
- No earned spins or reward wheel runtime.
- No production D1 writes.
- No issue #49 change.

## Access Matrix

| Future surface | Required future scope | Current slice status |
| --- | --- | --- |
| Account Purchases read model | Authenticated current user only | Defined only, not implemented |
| Entitlements read model | Authenticated current user only | Defined only, not implemented |
| Private Supporter Card reveal/status | Same account plus explicit card reveal flag | Defined only, not implemented |
| Public Supporter Card reveal | Separate future player opt-in/privacy slice | Blocked |
| Webhook replay | Configured DZN admin/operator only | Defined only, not implemented |
| Manual review | Configured DZN admin/operator only | Defined only, not implemented |
| Refund/dispute operator workflow | Configured DZN admin/operator only | Defined only, not implemented |
| Owner Starter/Pro entitlement | No Store operator access | No impact |
| Player public profile | No Store purchase exposure | No impact |

## Privacy Rules

Future read models must not expose raw Stripe ids, customer email, billing address, payment method data, webhook raw body, raw provider payload JSON, raw Discord ids, raw internal DZN user ids, or another user's purchases, entitlements, Supporter Cards, orders, payment events, or status history.

Future customer responses must be private/no-store and scoped to the current authenticated user. Future operator responses must be private/no-store and require configured DZN admin/operator authority.

## Production Mutation Confirmation

This slice made no production mutation:

- No Stripe Product/Price/customer/refund/dispute/payment/webhook endpoint mutation.
- No Checkout Session creation.
- No Cloudflare variable, secret, binding, Pages config, Workers config, or production D1 mutation.
- No migration.
- No Nitrado or Discord mutation.
- No analytics/tracking or metered AI call.
- No earned-spin ledger.
- No reward wheel runtime.
- No live checkout activation.
- No issue #49 change.

## Validation Required

Expected validation for this slice:

- `npm run test:dzn-store-fulfilment-reconciliation-read-model-preflight`
- Focused Store payment guardrail tests
- `git diff --check`
- `npx tsc --noEmit`
- `npm run lint`
- `npm run build`
- `npm run check:billing-config`
- `npm run test:billing-integrity`
- Security diff scan

## Next Recommended Slice

Next should be the Store private Account Purchases and Entitlements read-model implementation approval slice, only if deliberately approved: add a disabled-by-default authenticated private read-only route for the current user's Store purchases, entitlements, and private Supporter Card status using sanitized ledgers only, while still adding no public Supporter Card reveal, no webhook replay route, no manual-review route, no refund/dispute operator route, no notifications, no production migration apply, no live checkout activation, no earned-spin ledger, no reward wheel runtime, no Stripe mutation, no Cloudflare config mutation, no production D1 write, and no issue #49 change.

## Follow-On Implementation Status

The Store private Account Purchases and Entitlements read-model implementation is now delivered separately in `docs/DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_IMPLEMENTATION.md`.

The Store private Account Purchases UI shell is now delivered separately in `docs/DZN_STORE_ACCOUNT_PURCHASES_UI_SHELL.md`. It consumes only `GET /api/account/purchases`, redirects unauthenticated users to login, and keeps Supporter Card reveal, operator actions, notifications, live checkout, earned spins, reward wheel runtime, Stripe mutation, Cloudflare config mutation, production D1 writes, and issue #49 blocked.

The follow-on implementation adds `functions/api/account/purchases.ts` and `functions/_lib/dzn-store-account-purchases.ts`. It remains disabled by default behind `DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_ENABLED`, requires authentication and local/test Store runtime flags, returns private/no-store sanitized current-user data only, and still adds no public Supporter Card reveal, no operator route, no notification, no migration, no live checkout activation, no Stripe mutation, no Cloudflare config mutation, no production D1 write, and no issue #49 change.

The Store private Supporter Card reveal approval preflight is now delivered in `docs/DZN_STORE_SUPPORTER_CARD_REVEAL_APPROVAL_PREFLIGHT.md`. It defines the future private reveal contract and redaction/security proof only, while adding no card reveal route, private reveal component, public reveal, card-art generation, sharing controls, screenshot/export controls, notifications, migrations, production D1 apply, live checkout activation, earned-spin ledger, reward wheel runtime, Stripe mutation, Cloudflare config mutation, production D1 write, or issue #49 change.
