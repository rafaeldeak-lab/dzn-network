# DZN Store Sandbox Order Ledger Schema Handoff

## Start State

- Worktree: `C:\Users\rafae\Desktop\DZN-Audits\worktrees\dzn-store-order-ledger-schema-20260827`
- Branch: `codex/dzn-store-order-ledger-schema-20260827`
- Base: `origin/codex/dzn-store-sandbox-checkout-preflight-20260827`
- Base commit: `1bd4313`
- Protected OneDrive checkout was not modified.

## Scope

This slice adds the first local/sandbox-only DZN Store order/payment ledger schema:

- `migrations/0072_dzn_store_order_ledger_schema.sql`
- `store_orders`
- `store_order_items`
- `store_payment_events`
- `docs/DZN_STORE_SANDBOX_ORDER_LEDGER_SCHEMA.md`
- `scripts/test-dzn-store-order-ledger-schema.ts`

It is a schema and guard-test slice only. It does not implement checkout, webhook fulfilment, account entitlements, Supporter Cards, earned spins, wheel runtime, live checkout, or production service mutation.

## Architecture Found

The branch is stacked on the DZN Store sandbox order and checkout approval preflight. The repo already has:

- Owner subscription checkout using `mode: "subscription"`.
- Owner subscription webhook handling.
- Canonical billing/entitlement safety in `functions/_lib/plans.ts`.
- Stripe raw-body signature verification in `functions/_lib/stripe.ts`.
- Store catalog tables in `migrations/0071_dzn_store_catalog_admin_draft.sql`.
- Store public preview contract in `/store`.

Future DZN Store purchases remain player/account cosmetics only. Store ledgers are not owner subscription entitlements and must not unlock `/setup`, Nitrado linking, owner dashboards, server management, server ownership, Starter/Pro plan state, rankings, discovery score, reviews, badges, seasons, events, CTF, Server Wars, XP awards, earned calling-card awards, public profile visibility, retained exports, moderation decisions, or competitive eligibility.

## Implementation

Added:

- `migrations/0072_dzn_store_order_ledger_schema.sql`
- `docs/DZN_STORE_SANDBOX_ORDER_LEDGER_SCHEMA.md`
- `docs/DZN_STORE_SANDBOX_ORDER_LEDGER_SCHEMA_HANDOFF.md`
- `scripts/test-dzn-store-order-ledger-schema.ts`

Updated:

- `docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md`
- `docs/DZN_SAFE_MONETISATION_SUPPORTER_SYSTEM_BACKLOG.md`
- `docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md`
- `docs/PUBLIC_ACCESS_POLICY.md`
- `docs/BILLING_PLANS.md`
- `docs/STRIPE_LIVE_ACTIVATION_CHECKLIST.md`
- `docs/DZN_STORE_SANDBOX_ORDER_CHECKOUT_APPROVAL_PREFLIGHT.md`
- `docs/DZN_STORE_SANDBOX_ORDER_CHECKOUT_APPROVAL_PREFLIGHT_HANDOFF.md`
- `package.json`
- `scripts/test-dzn-safe-monetisation-supporter-preflight.ts`
- `scripts/test-dzn-store-sandbox-checkout-approval-preflight.ts`

## Ledger Contract

`store_orders` stores:

- One sandbox/local order header.
- Session-derived purchasing user reference.
- Hashed Discord/customer references only.
- Immutable product, price, Store flag, tax, and terms snapshots.
- Sandbox-only `livemode = 0`.
- One product per order.
- Provider references for Checkout Session and PaymentIntent.
- Paid, refunded, revoked, and review lifecycle timestamps.

`store_order_items` stores:

- One item per order.
- Quantity fixed to `1`.
- Product/price references and immutable item snapshot.
- Account-bound, guaranteed-purchase, no-competitive-advantage constraints.
- Hard false paid-outcome fields for spins, XP, ranking, discovery, reviews, events, Server Wars, CTF, owner subscription access, and competitive eligibility.

`store_payment_events` stores:

- Unique Stripe event ids.
- Sandbox/local provider-event class and processing status.
- Related order and provider reference ids.
- Raw event SHA-256 hash.
- Sanitized event summary JSON.
- Failure code/message for private support.
- Fulfilment, entitlement-write, and Supporter Card write blockers fixed to `0`.

## Explicitly Not Implemented

- No `POST /api/store/orders`.
- No `POST /api/stripe/store-webhook`.
- No checkout route.
- No Stripe Checkout Session creation.
- No webhook fulfilment.
- No account entitlement table or writes.
- No Supporter Card table or issuance.
- No earned-spin table.
- No spin ledger.
- No wheel cooldown table.
- No reward wheel runtime.
- No Stripe object mutation.
- No Cloudflare secret/config mutation.
- No production D1 write.
- No live checkout activation.
- No issue #49 change.
- No Nitrado, Discord, AI provider, vector store, analytics, tracking, metered model, or retained-export change.

## Validation Completed

```text
npm ci: passed
npm run test:dzn-store-order-ledger-schema: passed
npm run test:dzn-store-sandbox-checkout-approval-preflight: passed
npm run test:dzn-store-public-preview-contract: passed
npm run test:dzn-store-catalog-admin-draft: passed
npm run test:dzn-safe-monetisation-supporter-preflight: passed
npm run check:billing-config: passed; live checkout disabled and Stripe vars absent
npm run test:billing-plans: passed
npm run test:stripe-live-readiness: passed
npm run test:stripe-live-activation-checklist: passed
npm run test:public-access-gating: passed
npm run test:player-owner-access-foundation: passed
npm run test:player-hub-foundation: passed
npm run test:player-saved-servers: passed
npm run test:dzn-comms-live-presence-counter: passed
npx tsc --noEmit --incremental false: passed
npm run lint: passed with existing warnings only
npm run build: passed
npm test: passed
npm run autodev:quality: passed
git diff --check: passed
```

Local D1 SQL validation:

```text
npx wrangler d1 execute dzn_network_db --local --persist-to <temp> --file migrations\0071_dzn_store_catalog_admin_draft.sql: passed
npx wrangler d1 execute dzn_network_db --local --persist-to <temp> --file migrations\0072_dzn_store_order_ledger_schema.sql: passed
SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('store_orders','store_order_items','store_payment_events') ORDER BY name: returned store_order_items, store_orders, store_payment_events
```

No production D1 validation is authorized by this slice. No production D1 migration application is authorized by this slice.

## Security Review Completed

Codex Security diff scan:

- Scan ID: `c18210e6-eb99-4554-8fa8-440297c1204a`
- Status: complete
- Findings: 0
- Coverage: complete for the security inventory and supporting Store/billing helpers
- TAC advisory: could not be verified because the Codex Security Access connector was not connected

Review outcome:

- The new schema is sandbox/local scoped and live-mode blocked.
- It has no fulfilment path.
- It has no account entitlement or Supporter Card write path.
- It stores sanitized payment-event summaries and event hashes, not raw webhook bodies.
- It does not store card numbers, CVC, bank details, or raw payment method details.
- It does not couple to owner billing, server ownership, competitive scoring, ranking, discovery, review, event, progression, profile visibility, retained export, or moderation systems.
- It does not mutate Stripe, Cloudflare, production D1, Nitrado, Discord, AI/vector/provider, live checkout, or issue #49.

## Production-Mutation Confirmation

This branch must not create or mutate:

- Stripe Checkout Sessions.
- Stripe Products or Prices.
- Stripe Customers.
- Stripe webhook endpoints.
- Refunds or disputes.
- Cloudflare variables, secrets, bindings, Pages config, or Workers config.
- Production D1 migrations or rows.
- Nitrado resources.
- Discord resources.
- AI provider credentials.
- Vector stores.
- Analytics/tracking events.
- Metered model calls.
- Live checkout.
- Issue #49.

## Next Recommended Slice

Next should be the DZN Store sandbox order creation route approval slice: define and, only after deliberate approval, add a disabled-by-default authenticated order creation route that can write pending sandbox orders only when Store sandbox flags are explicitly enabled in local/test. It must still create no Stripe Checkout Sessions, process no Store webhooks, grant no entitlements, issue no Supporter Cards, mint no earned spins, run no wheel, mutate no Stripe objects, mutate no Cloudflare secrets/config, write no production D1, enable no live checkout, and change no issue #49.

## Follow-On Order Creation Route Slice

The follow-on `POST /api/store/orders` slice is now implemented as a disabled-by-default authenticated route. It records pending local/test Store orders only when all sandbox flags are explicitly enabled.

It writes only `store_orders` and `store_order_items`. No checkout session is created. No Store webhook is processed. No entitlement, Supporter Card, earned spin, reward wheel, production D1, live checkout, or issue #49 change is introduced.
