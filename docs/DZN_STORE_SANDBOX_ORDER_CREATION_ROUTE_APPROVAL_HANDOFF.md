# DZN Store Sandbox Order Creation Route Approval Handoff

## Start State

- Worktree: `C:\Users\rafae\Desktop\DZN-Audits\worktrees\dzn-store-sandbox-order-route-approval-20260827`
- Branch: `codex/dzn-store-sandbox-order-route-approval-20260827`
- Base: `origin/codex/dzn-store-order-ledger-schema-20260827`
- Base commit: `b95c52f`
- Protected OneDrive checkout was not modified.

## Scope

This slice adds a disabled-by-default authenticated pending order route:

- `POST /api/store/orders`
- `functions/api/store/orders.ts`
- `functions/_lib/dzn-store-orders.ts`
- `docs/DZN_STORE_SANDBOX_ORDER_CREATION_ROUTE_APPROVAL.md`
- `scripts/test-dzn-store-sandbox-order-route-approval.ts`

The route writes pending sandbox orders only when all Store sandbox flags are explicitly enabled in local/test. It writes only `store_orders` and `store_order_items`.

## Architecture Found

DZN already had:

- Owner subscription checkout using `mode: "subscription"`.
- Owner subscription webhook handling.
- Canonical owner billing/readiness safety in `functions/_lib/plans.ts`.
- Store catalog and preview contracts in `functions/_lib/dzn-store-catalog.ts`.
- Store catalog schema in `migrations/0071_dzn_store_catalog_admin_draft.sql`.
- Store order ledger schema in `migrations/0072_dzn_store_order_ledger_schema.sql`.
- Public-safe read-only `/store` preview.

This route does not use owner entitlements and does not unlock `/setup`, Nitrado linking, owner dashboards, owner onboarding, server-management APIs, server ownership, Starter/Pro plans, rankings, discovery score, reviews, badges, seasons, events, CTF, Server Wars, XP awards, earned calling-card awards, public profile visibility, retained exports, moderation decisions, or competitive eligibility.

## Implementation

Added:

- `functions/_lib/dzn-store-orders.ts`
- `functions/api/store/orders.ts`
- `docs/DZN_STORE_SANDBOX_ORDER_CREATION_ROUTE_APPROVAL.md`
- `docs/DZN_STORE_SANDBOX_ORDER_CREATION_ROUTE_APPROVAL_HANDOFF.md`
- `scripts/test-dzn-store-sandbox-order-route-approval.ts`

Updated:

- `docs/DZN_STORE_SANDBOX_ORDER_LEDGER_SCHEMA.md`
- `docs/DZN_STORE_SANDBOX_ORDER_LEDGER_SCHEMA_HANDOFF.md`
- `docs/DZN_STORE_SANDBOX_ORDER_CHECKOUT_APPROVAL_PREFLIGHT.md`
- `docs/DZN_STORE_SANDBOX_ORDER_CHECKOUT_APPROVAL_PREFLIGHT_HANDOFF.md`
- `docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md`
- `docs/DZN_SAFE_MONETISATION_SUPPORTER_SYSTEM_BACKLOG.md`
- `docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md`
- `docs/PUBLIC_ACCESS_POLICY.md`
- `docs/BILLING_PLANS.md`
- `docs/STRIPE_LIVE_ACTIVATION_CHECKLIST.md`
- Store guard tests.
- `package.json`

## Access And Write Matrix

| Case | Result | D1 writes |
| --- | --- | --- |
| Logged out | `401` | None |
| Store flags absent/default | `403` | None |
| `DZN_STORE_SANDBOX_RUNTIME` missing | `403` | None |
| Live checkout flag enabled | `403` | None |
| Webhook fulfilment, Supporter Card, earned-spin, or wheel runtime flag enabled | `403` | None |
| Invalid product/price/theme/body | `400`, `404`, or `422` | None |
| Authenticated plus explicit local/test sandbox flags plus safe active catalog row | `201` | `store_orders`, `store_order_items` only; `test` runtime persists `ledger_scope = sandbox` |

## Explicitly Not Implemented

- No Stripe Checkout Sessions.
- No one-time Stripe `mode=payment` call.
- No Store webhooks.
- No `store_payment_events` writes.
- No entitlements.
- No Supporter Cards.
- No earned spins.
- No reward wheel.
- No owner plan or owner entitlement changes.
- No server ownership, Nitrado, or setup access changes.
- No Stripe Product, Price, Customer, PaymentIntent, refund, dispute, or webhook endpoint mutation.
- No Cloudflare secret/config/binding mutation.
- No production D1 write.
- No live checkout activation.
- No issue #49 change.

## Validation Completed

- `npm run test:dzn-store-sandbox-order-route-approval` passed.
- `npx tsc --noEmit --incremental false` passed.
- Temp local D1 smoke passed with `wrangler d1 execute --local --persist-to <temp>` for `0071_dzn_store_catalog_admin_draft.sql` and `0072_dzn_store_order_ledger_schema.sql`; `store_products`, `store_prices`, `store_orders`, `store_order_items`, and `store_payment_events` existed in the local-only database after migration.
- `npm run lint` passed with the pre-existing unrelated warnings in `components/network/public-network.tsx`, `components/servers/live-server-rail.tsx`, and `functions/api/servers/[serverId]/dashboard/advanced-stats.ts`.
- `npm run build` passed.
- `npm test` passed.
- `npm run check:billing-config` passed as a read-only readiness check and confirmed checkout is not configured, live checkout is not enabled, and checkout session creation is not allowed.
- `npm run test:stripe-live-readiness` passed.
- `npm run test:stripe-live-activation-checklist` passed.
- `npm run autodev:quality` passed.
- `git diff --check` passed.

## Security Review Completed

- Codex Security diff scan was started for the working-tree change set with focus on Store flag bypass, accidental live checkout, Stripe mutation, webhook fulfilment, entitlement/supporter-card/spin/wheel side effects, identity spoofing, raw private identifier leakage, production D1, Cloudflare mutation, and competitive-system impact. Discovery recorded zero candidates.
- Manual static side-effect scan found no forbidden Stripe Checkout Session creation, Stripe helper usage, webhook verification, Stripe secret access, remote Wrangler mutation command, live-checkout enablement assignment, Store payment-event write, entitlement write, Supporter Card write, earned-spin write, spin-ledger write, or wheel-cooldown write in the new route/helper/doc test set.
- Route body validation rejects client-supplied identity, owner, server, billing, entitlement, Stripe, quantity, amount, currency, livemode, and status fields.
- Purchaser identity comes only from the authenticated Discord session. Raw Discord ids are not inserted into order bindings; the route stores a SHA-256 reference hash.
- Disabled/default Store flags, live checkout flags, webhook fulfilment flags, Supporter Card flags, earned-spin flags, and wheel flags all block before the pending order write.

## Production-Mutation Confirmation

This branch did not intentionally create or mutate:

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

Next should be the DZN Store sandbox Checkout Session creation approval slice, only if deliberately approved. It should create a test-mode Stripe Checkout Session only after the pending local/test order exists and must still avoid webhook fulfilment, entitlements, Supporter Card issuance, earned spins, wheel runtime, Stripe object mutation, Cloudflare secret/config mutation, production D1 writes, live checkout activation, and issue #49 changes.
