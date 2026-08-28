# DZN Store Sandbox Webhook Event Ledger Receipt Handoff

## Start State

- Worktree: `C:\Users\rafae\Desktop\DZN-Audits\worktrees\dzn-store-sandbox-webhook-ledger-receipt-20260828`
- Branch: `codex/dzn-store-sandbox-webhook-ledger-receipt-20260828`
- Base: `origin/codex/dzn-store-sandbox-checkout-session-approval-20260827`
- Base commit: `72ffe1d8cb3aa650b7fbd3355a3bd82b0c51f1b1`
- Protected OneDrive checkout was not modified.

## Scope

This slice adds a disabled-by-default Store sandbox webhook receipt route:

- `POST /api/stripe/store-webhook`
- `functions/api/stripe/store-webhook.ts`
- `functions/_lib/dzn-store-webhook.ts`
- `docs/DZN_STORE_SANDBOX_WEBHOOK_LEDGER_RECEIPT.md`
- `scripts/test-dzn-store-sandbox-webhook-ledger-receipt.ts`

The route verifies the Stripe signature, accepts test-mode events only, and writes sanitized `store_payment_events` receipt rows only. It is receipt-only.

## Architecture Found

DZN already had:

- Owner subscription checkout using `mode: "subscription"`.
- Owner subscription webhook handling.
- Canonical owner billing/readiness safety in `functions/_lib/plans.ts`.
- Store catalog and preview contracts in `functions/_lib/dzn-store-catalog.ts`.
- Pending Store order creation through `POST /api/store/orders`.
- Test-mode sandbox Checkout Session creation through `POST /api/store/orders/:orderId/checkout`.
- Store catalog schema in `migrations/0071_dzn_store_catalog_admin_draft.sql`.
- Store order ledger schema in `migrations/0072_dzn_store_order_ledger_schema.sql`, including `store_payment_events`.
- Public-safe read-only `/store` preview.

This route does not use owner entitlements and does not unlock `/setup`, Nitrado linking, owner dashboards, owner onboarding, server-management APIs, server ownership, Starter/Pro plans, rankings, discovery score, reviews, badges, seasons, events, CTF, Server Wars, XP awards, earned calling-card awards, public profile visibility, retained exports, moderation decisions, or competitive eligibility.

## Implementation

Added:

- `functions/_lib/dzn-store-webhook.ts`
- `functions/api/stripe/store-webhook.ts`
- `docs/DZN_STORE_SANDBOX_WEBHOOK_LEDGER_RECEIPT.md`
- `docs/DZN_STORE_SANDBOX_WEBHOOK_LEDGER_RECEIPT_HANDOFF.md`
- `scripts/test-dzn-store-sandbox-webhook-ledger-receipt.ts`

Updated:

- `functions/_lib/stripe.ts`
- `functions/_lib/dzn-store-orders.ts`
- Prior Store guard tests and Store docs.
- `package.json`

## Access And Write Matrix

| Case | Result | D1 writes | Stripe calls |
| --- | --- | --- | --- |
| Method other than `POST` | `405` | None | None |
| Store flags absent/default | `403` | None | None |
| `DZN_STORE_SANDBOX_RUNTIME` missing | `403` | None | None |
| `DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_ENABLED` missing | `403` | None | None |
| `STRIPE_WEBHOOK_SECRET` missing or not `whsec_...` | `403` | None | None |
| Live checkout flag enabled | `403` | None | None |
| Webhook fulfilment, Supporter Card, earned-spin, or wheel runtime flag enabled | `403` | None | None |
| Missing or invalid Stripe signature | `400` | None | None |
| Signed malformed event envelope | `400` | None | None |
| Signed live-mode event | `422` | None | None |
| Signed duplicate test-mode event | `200` duplicate | None after first receipt | None |
| Signed valid test-mode event | `200` | `store_payment_events` insert only | None |

## Receipt-Only Guarantees

- No fulfilment.
- No entitlements.
- No Supporter Cards.
- No earned spins.
- No wheel runtime.
- No owner plan or owner entitlement changes.
- No server ownership, Nitrado, or setup access changes.
- No Stripe Product, Price, Customer, Checkout Session, refund, dispute, or webhook endpoint mutation by DZN.
- No Cloudflare secret/config/binding mutation.
- No production D1 writes.
- No live checkout.
- No issue #49 change.

## Validation Completed

Completed on 2026-08-28 in the isolated worktree:

- `npm run test:dzn-store-sandbox-webhook-ledger-receipt`
- `npm run test:dzn-store-catalog-admin-draft`
- `npm run test:dzn-store-public-preview-contract`
- `npm run test:dzn-store-sandbox-checkout-approval-preflight`
- `npm run test:dzn-store-order-ledger-schema`
- `npm run test:dzn-store-sandbox-order-route-approval`
- `npm run test:dzn-store-sandbox-checkout-session-approval`
- `npm run test:dzn-safe-monetisation-supporter-preflight`
- `npm run test:billing-plans`
- `npm run test:stripe-live-readiness`
- `npm run test:stripe-live-activation-checklist`
- `npm run check:billing-config`
- `npx tsc --noEmit --incremental false`
- `npm run lint` passed with existing repository warnings in `components/network/public-network.tsx`, `components/servers/live-server-rail.tsx`, and `functions/api/servers/[serverId]/dashboard/advanced-stats.ts`.
- `npm test`
- `npm run build`
- `git diff --check`

`npm run check:billing-config` confirmed live billing remains not configured and live checkout remains disabled.

## Security Review Completed

Completed on 2026-08-28:

- Codex Security diff scan id: `246b4495-1e17-4641-b10f-9fda58c94e9f`
- Base: `72ffe1d8cb3aa650b7fbd3355a3bd82b0c51f1b1`
- Scope: branch working-tree diff only.
- Result: no findings.
- Report: `C:\Users\rafae\AppData\Local\Temp\codex-security-scans-gJPi0O\dzn-store-sandbox-webhook-ledger-receipt-20260828\72ffe1d8cb3aa650b7fbd3355a3bd82b0c51f1b1_20260828T013041Z_kvdwqnf2\report.md`
- TAC status could not be verified because the security-access connector was not logged in; the scan continued because TAC is advisory and not a gate.

Reviewed controls:

- Store webhook receipt remains disabled by default.
- Store webhook receipt requires local/test Store sandbox gates and `DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_ENABLED=true`.
- Webhook signing secret must be a bounded `whsec_` value.
- Stripe signature is verified against the raw request body before parsing.
- Live-mode Stripe events are rejected before D1 writes.
- Duplicate event ids use `ON CONFLICT(stripe_event_id) DO NOTHING`.
- Related order linkage only resolves to existing local/sandbox `store_orders` rows.
- Stored summaries are sanitized and omit raw bodies, customer details, payment method details, and metadata values.
- The route writes only `store_payment_events` and performs no fulfilment, entitlement, Supporter Card, earned-spin, wheel, live checkout, Stripe object mutation, Cloudflare config mutation, production D1 write, or issue #49 action.

## Production-Mutation Confirmation

No production mutation command is part of this slice. The branch must not run:

- `npm run db:migrate:remote`
- `wrangler d1 migrations apply dzn_network_db --remote`
- `wrangler pages secret put`
- Stripe Product or Price mutation.
- Stripe webhook endpoint creation.
- Store webhook fulfilment.
- Account entitlement writes.
- Supporter Card issuance.
- Earned-spin or reward-wheel runtime.
- Nitrado or Discord mutations.
- Live checkout activation.
- Issue #49 mutation or merge.

## Next Recommended Slice

Next should be Store webhook fulfilment approval preflight only if deliberately approved: define the verified test-mode fulfilment contract, exact eligible events, order-status transitions, idempotent entitlement/supporter-card boundaries, refund/chargeback rollback rules, and proof matrix before any fulfilment route writes account entitlements, Supporter Cards, earned spins, wheel runtime, live checkout activation, Stripe Product/Price mutation, Cloudflare config mutation, production D1 writes, or issue #49 changes.

Delivered follow-on reference: the DZN Store webhook fulfilment approval preflight in `docs/DZN_STORE_WEBHOOK_FULFILMENT_APPROVAL_PREFLIGHT.md` defines that approval contract only. The current webhook route remains receipt-only.
