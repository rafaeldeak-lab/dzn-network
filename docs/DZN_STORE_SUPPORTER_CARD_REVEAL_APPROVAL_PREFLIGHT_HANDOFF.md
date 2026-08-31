# DZN Store Supporter Card Reveal Approval Preflight Handoff

## Branch

Branch: `codex/dzn-store-supporter-card-reveal-preflight-20260831`

Base: `c023a3fe2bb1fd0278b2f312e3e9bd409653d034`

Stacked on: `codex/dzn-store-account-purchases-ui-shell-20260831`

Protected OneDrive checkout was not modified.

## Delivered

- Added `docs/DZN_STORE_SUPPORTER_CARD_REVEAL_APPROVAL_PREFLIGHT.md`.
- Added `scripts/test-dzn-store-supporter-card-reveal-approval-preflight.ts`.
- Wired `test:dzn-store-supporter-card-reveal-approval-preflight` into `package.json`.
- Updated Store docs/backlog/spec/policy references so the reveal preflight is no longer treated as future-only.

## Approval Boundary

This is a preflight-only slice. It defines the future private Supporter Card reveal contract, but it does not implement that contract.

The approved future route shape is design-only:

- Proposed method/path: `GET /api/account/supporter-cards/[cardRef]/reveal`.
- Caller: authenticated current DZN user only.
- Scope: current user's own active/hidden Supporter Card only.
- Cache: private/no-store with cookie variance.
- Identifier: display-safe `cardRef` or `purchase_ref`, not raw ids.
- Runtime: local/test Store sandbox only until live Store activation is separately approved.

## Still Not Added

- No card reveal route.
- No private Supporter Card reveal component.
- No public Supporter Card reveal.
- No Supporter Card serial number display outside the design contract.
- No generated card-art display.
- No card-art generation.
- No card-art storage.
- No screenshot, download, export, copy-link, or sharing controls.
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

## Required Future Proof

A later implementation must prove:

- Logged-out users cannot reveal a card.
- Cross-account card reveal attempts are denied without confirming whether the card exists.
- Raw ids, Discord ids, Stripe ids, serial probes, and guessed order ids are not accepted as ownership proof.
- Account ownership is proven through joined `supporter_cards`, `account_entitlements`, `store_orders`, and `store_order_items` rows scoped to the authenticated user.
- Suspended, revoked, refunded, disputed, or manual-review cards do not reveal active serial/art content.
- `GET /api/account/purchases` remains status-only unless a separate schema-versioned extension is approved.
- Serial numbers are absent from public profiles, social metadata, reviews, leaderboards, events, community directories, owner dashboards, notification payloads, export-safe rows, logs, and browser storage.
- Raw card-art seed/material fields such as `insignia_seed_hash` and `generated_insignia_json` remain server-private.
- The private reveal has no checkout, webhook, notification, share/export, analytics, tracking, browser storage, Stripe mutation, Cloudflare config mutation, production D1 write, earned-spin, reward-wheel, owner-plan, ranking, scoring, review, XP, calling-card, event, public-profile, retained-export, moderation, or competitive eligibility effect.

## Validation

Completed validation for this slice:

- `npm run test:dzn-store-supporter-card-reveal-approval-preflight`
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
- Local production-mutation audit: no changed or untracked app/function/component/migration/config/workflow runtime files.
- Codex Security diff scan `9e132515-86fa-4b77-a8b7-3218eda16b09`: complete, zero findings.

`npm run lint` completed with four existing warnings in unrelated files. `npm run check:billing-config` confirmed Stripe secrets/prices are absent and live checkout remains disabled.

## Production-Mutation Confirmation

This slice is source-only documentation and test-guard work. It does not apply migrations, touch production D1, create or update Stripe objects, change Cloudflare secrets/config, call Nitrado, call Discord, add AI provider credentials, add vector stores, make metered model calls, enable live checkout, or change issue #49.

## Next Recommended Slice

Next should be Store private Supporter Card reveal implementation only if deliberately approved: add a disabled-by-default local/test private route and private `/account/purchases` reveal UI panel from the preflight, proving current-account ownership before showing a Supporter Card serial/status and keeping card-art generation, public reveal, sharing controls, screenshot/export controls, notifications, live checkout activation, earned-spin ledger, reward wheel runtime, Stripe mutation, Cloudflare config mutation, production D1 writes, and issue #49 blocked.

The personal player page/nav button remains a separate player UX slice.
