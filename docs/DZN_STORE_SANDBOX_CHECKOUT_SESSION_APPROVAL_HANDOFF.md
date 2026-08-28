# DZN Store Sandbox Checkout Session Approval Handoff

## Start State

- Worktree: `C:\Users\rafae\Desktop\DZN-Audits\worktrees\dzn-store-sandbox-checkout-session-approval-20260827`
- Branch: `codex/dzn-store-sandbox-checkout-session-approval-20260827`
- Base: `origin/codex/dzn-store-sandbox-order-route-approval-20260827`
- Base commit: `309e0fa0766f963e8f0d93e452fb9089602861c0`
- Protected OneDrive checkout was not modified.

## Scope

This slice adds a disabled-by-default Store sandbox checkout route:

- `POST /api/store/orders/:orderId/checkout`
- `functions/api/store/orders/[orderId]/checkout.ts`
- `functions/_lib/dzn-store-checkout.ts`
- `docs/DZN_STORE_SANDBOX_CHECKOUT_SESSION_APPROVAL.md`
- `scripts/test-dzn-store-sandbox-checkout-session-approval.ts`

The route creates a test-mode only Stripe Checkout Session after an authenticated player already has an owned pending local/test Store order. It updates only `store_orders` to `checkout_created`.

## Architecture Found

DZN already had:

- Owner subscription checkout using `mode: "subscription"`.
- Owner subscription webhook handling.
- Canonical owner billing/readiness safety in `functions/_lib/plans.ts`.
- Store catalog and preview contracts in `functions/_lib/dzn-store-catalog.ts`.
- Pending Store order creation through `POST /api/store/orders`.
- Store catalog schema in `migrations/0071_dzn_store_catalog_admin_draft.sql`.
- Store order ledger schema in `migrations/0072_dzn_store_order_ledger_schema.sql`.
- Public-safe read-only `/store` preview.

This route does not use owner entitlements and does not unlock `/setup`, Nitrado linking, owner dashboards, owner onboarding, server-management APIs, server ownership, Starter/Pro plans, rankings, discovery score, reviews, badges, seasons, events, CTF, Server Wars, XP awards, earned calling-card awards, public profile visibility, retained exports, moderation decisions, or competitive eligibility.

## Implementation

Added:

- `functions/_lib/dzn-store-checkout.ts`
- `functions/api/store/orders/[orderId]/checkout.ts`
- `docs/DZN_STORE_SANDBOX_CHECKOUT_SESSION_APPROVAL.md`
- `docs/DZN_STORE_SANDBOX_CHECKOUT_SESSION_APPROVAL_HANDOFF.md`
- `scripts/test-dzn-store-sandbox-checkout-session-approval.ts`

Updated:

- `functions/_lib/stripe.ts`
- `functions/_lib/dzn-store-orders.ts`
- `docs/DZN_STORE_SANDBOX_ORDER_CREATION_ROUTE_APPROVAL.md`
- `docs/DZN_STORE_SANDBOX_ORDER_CREATION_ROUTE_APPROVAL_HANDOFF.md`
- `docs/DZN_STORE_SANDBOX_ORDER_CHECKOUT_APPROVAL_PREFLIGHT.md`
- `docs/DZN_STORE_SANDBOX_ORDER_CHECKOUT_APPROVAL_PREFLIGHT_HANDOFF.md`
- `docs/DZN_STORE_SANDBOX_ORDER_LEDGER_SCHEMA.md`
- `docs/DZN_STORE_SANDBOX_ORDER_LEDGER_SCHEMA_HANDOFF.md`
- `docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md`
- `docs/DZN_SAFE_MONETISATION_SUPPORTER_SYSTEM_BACKLOG.md`
- `docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md`
- `docs/PUBLIC_ACCESS_POLICY.md`
- `docs/BILLING_PLANS.md`
- `docs/STRIPE_LIVE_ACTIVATION_CHECKLIST.md`
- Store guard tests.
- `package.json`

## Access And Write Matrix

| Case | Result | D1 writes | Stripe calls |
| --- | --- | --- | --- |
| Logged out | `401` | None | None |
| Store flags absent/default | `403` | None | None |
| `DZN_STORE_SANDBOX_RUNTIME` missing | `403` | None | None |
| `DZN_STORE_SANDBOX_CHECKOUT_SESSION_ENABLED` missing | `403` | None | None |
| `STRIPE_SECRET_KEY` missing or not `sk_test_...` | `403` | None | None |
| Live checkout flag enabled | `403` | None | None |
| Webhook fulfilment, Supporter Card, earned-spin, or wheel runtime flag enabled | `403` | None | None |
| Missing/cross-user order | `404` | None | None |
| Non-draft, live, unsafe, or invalid order/item/price row | `409` or `422` | None | None |
| Authenticated plus explicit local/test sandbox flags plus owned draft order plus safe test Price binding | `200` | `store_orders` update only | One test-mode `/checkout/sessions` request |

## Explicitly Not Implemented

- No Store webhooks.
- No `store_payment_events` writes.
- No entitlements.
- No Supporter Cards.
- No earned spins.
- No reward wheel.
- No owner plan or owner entitlement changes.
- No server ownership, Nitrado, or setup access changes.
- No Stripe Product, Price, Customer, PaymentIntent, refund, dispute, or webhook endpoint mutation by DZN.
- No Cloudflare secret/config/binding mutation.
- No production D1 write.
- No live checkout activation.
- No issue #49 change.

## Validation Completed

- `npm run test:dzn-store-sandbox-checkout-session-approval`
- `npm run test:dzn-store-sandbox-order-route-approval`
- `npm run test:dzn-store-sandbox-checkout-approval-preflight`
- `npm run test:dzn-store-order-ledger-schema`
- `npm run test:dzn-safe-monetisation-supporter-preflight`
- `npm run test:dzn-store-catalog-admin-draft`
- `npm run test:dzn-store-public-preview-contract`
- `npm run test:dzn-comms-live-presence-counter`
- `npx tsc --noEmit --incremental false`
- `npm run lint`: passed with existing warnings outside this slice.
- `npm run test:billing-plans`
- `npm run test:stripe-live-readiness`
- `npm run test:stripe-live-activation-checklist`
- `npm run check:billing-config`: read-only check confirmed live checkout is disabled and local Stripe config is absent.
- `npm test`
- `npm run build`
- `git diff --check`

## Security Review Completed

- Codex Security diff scan: `ed37cd32-0573-4ccf-b95f-65a5dc5a0d2d`
- Result: zero findings.
- Report: `C:\Users\rafae\AppData\Local\Temp\codex-security-scans-gJPi0O\dzn-store-sandbox-checkout-session-approval-20260827\309e0fa0766f963e8f0d93e452fb9089602861c0_20260828T004850Z_606osgk9\report.md`
- Reviewed changed runtime surfaces for auth bypass, cross-user checkout access, client-controlled product/price/identity fields, unsafe redirects, idempotency, live Stripe leakage, Store webhook fulfilment, entitlement/supporter-card/spin/wheel writes, owner billing coupling, competitive-system coupling, and production mutation.

## Production-Mutation Confirmation

This branch did not intentionally create or mutate:

- Live Stripe Checkout Sessions.
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

Next should be the DZN Store sandbox webhook event ledger receipt slice only if deliberately approved. It should add a disabled-by-default, ledger-only Store webhook route that verifies Stripe signatures and records sanitized test-mode event receipt rows without fulfilment, account entitlements, Supporter Cards, earned spins, wheel runtime, live checkout activation, Stripe Product/Price mutation, Cloudflare secret/config mutation, production D1 writes, or issue #49 changes.
