# DZN Store Sandbox Order And Checkout Approval Preflight Handoff

## Start State

- Worktree: `C:\Users\rafae\Desktop\DZN-Audits\worktrees\dzn-store-sandbox-checkout-preflight-20260827`
- Branch: `codex/dzn-store-sandbox-checkout-preflight-20260827`
- Base: `origin/codex/dzn-store-public-preview-contract-20260826`
- Base commit: `d83e185`
- Protected OneDrive checkout was not modified.

## Scope

This slice defines the approval contract for the first future DZN Store sandbox order and one-time Checkout runtime. It is documentation and guard-test work only.

It does not implement:

- Checkout routes.
- Order tables.
- Payment webhook tables or handlers.
- Account entitlement writes.
- Supporter Card issuance.
- Earned-spin ledgers.
- Reward wheel runtime.
- Stripe Checkout Sessions.
- Stripe Product or Price mutation.
- Cloudflare secret/config mutation.
- Production D1 writes.
- Live checkout activation.
- Issue #49 changes.

## Architecture Found

The repo already contains:

- Owner subscription checkout at `functions/api/billing/create-checkout-session.ts` using `mode: "subscription"`.
- Subscription webhook handling at `functions/api/stripe/webhook.ts`.
- Canonical billing/entitlement safety in `functions/_lib/plans.ts`.
- Stripe raw-body signature verification in `functions/_lib/stripe.ts`.
- Disabled-by-default Store catalog and preview helpers in `functions/_lib/dzn-store-catalog.ts`.
- A public-safe read-only `/store` preview route in `app/store/page.tsx`.

Future DZN Store purchases remain player/account cosmetics only. They must not unlock owner setup, Nitrado linking, owner dashboards, server management, server ownership, Starter/Pro plan status, rankings, discovery score, reviews, badges, seasons, events, CTF, Server Wars, XP awards, earned calling-card awards, public profile visibility, retained exports, moderation decisions, or competitive eligibility.

## Implementation

Added:

- `docs/DZN_STORE_SANDBOX_ORDER_CHECKOUT_APPROVAL_PREFLIGHT.md`
- `docs/DZN_STORE_SANDBOX_ORDER_CHECKOUT_APPROVAL_PREFLIGHT_HANDOFF.md`
- `scripts/test-dzn-store-sandbox-checkout-approval-preflight.ts`

Updated:

- `docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md`
- `docs/DZN_SAFE_MONETISATION_SUPPORTER_SYSTEM_BACKLOG.md`
- `docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md`
- `docs/PUBLIC_ACCESS_POLICY.md`
- `docs/BILLING_PLANS.md`
- `docs/STRIPE_LIVE_ACTIVATION_CHECKLIST.md`
- `docs/DZN_STORE_PUBLIC_PREVIEW_CONTRACT_HANDOFF.md`
- `package.json`

## Contract Defined

The preflight defines, but does not implement:

- Future authenticated `POST /api/store/orders`.
- Session-derived purchasing account only; request body account ids are ignored or rejected.
- One order item, quantity `1`, active Store product and active Store price only.
- Store checkout flag chain with sandbox enabled and live checkout disabled.
- Server-side one-time Stripe Checkout Session shape using `mode=payment`.
- Non-sensitive Stripe idempotency key strategy derived from local order id.
- No success-page fulfilment.
- Future `POST /api/stripe/store-webhook` verification and event-ledger rules.
- Duplicate Stripe event no-op behavior.
- Idempotent account entitlement and Supporter Card fulfilment rules.
- Refund, reversal, and chargeback revocation plan.
- Tax/receipt/private payment record boundaries.
- Non-destructive rollback path.
- Proof matrix for sandbox runtime acceptance.

## Validation Completed

Completed validation for this branch:

```text
npm ci
npm run test:dzn-store-sandbox-checkout-approval-preflight
npm run test:dzn-store-public-preview-contract
npm run test:dzn-store-catalog-admin-draft
npm run test:dzn-safe-monetisation-supporter-preflight
npm run check:billing-config
npm run test:billing-plans
npm run test:stripe-live-readiness
npm run test:stripe-live-activation-checklist
npm run test:public-access-gating
npm run test:player-owner-access-foundation
npm run test:player-hub-foundation
npm run test:player-saved-servers
npm run test:dzn-comms-live-presence-counter
npx tsc --noEmit --incremental false
npm run lint
npm run build
npm test
npm run autodev:quality
git diff --check
```

Notes:

- `npm ci` completed in the isolated worktree and reported existing dependency advisories; no package dependency changes were introduced by this slice.
- `npm run lint` passed with the existing four warnings in `components/network/public-network.tsx`, `components/servers/live-server-rail.tsx`, and `functions/api/servers/[serverId]/dashboard/advanced-stats.ts`.
- `npm run check:billing-config` confirmed Stripe secrets/prices are absent in this worktree, live billing is not configured, live checkout is not enabled, and the check was read-only.
- `npm test` passed and included `npm run test:dzn-store-sandbox-checkout-approval-preflight`.

## Security Review

Codex Security diff scan:

- Result: zero findings.
- Coverage: complete over the 11 staged files in this preflight branch.
- The final task report records the exact final scan ID and artifact paths for the final staged patch.

TAC advisory status could not be verified because the Codex Security Access connector is not connected. The scan continued because TAC status is advisory and not an authorization gate.

Manual bypass checks confirmed:

- No Store order, order item, payment event, account entitlement, Supporter Card, earned-spin, spin-ledger, or wheel-cooldown runtime tables were added.
- No one-time `mode=payment` checkout runtime, refund/dispute handler, Store checkout route, or Store webhook route was added.
- No Store checkout/live flags were declared in Cloudflare env/config files.
- No Stripe, Cloudflare, production D1, Nitrado, Discord, AI provider, vector store, analytics/tracking, metered model, live checkout, or issue #49 mutation was made.

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

Next should be the DZN Store sandbox order ledger schema preflight/implementation slice only if deliberately approved: add local/sandbox-only `store_orders`, `store_order_items`, and `store_payment_events` migration drafts plus validation tests behind disabled-by-default Store checkout flags, with no checkout route, no Stripe Checkout Session creation, no webhook fulfilment, no account entitlement writes, no Supporter Card issuance, no earned-spin ledger, no wheel runtime, no Stripe object mutation, no Cloudflare secret/config mutation, no production D1 write, no live checkout activation, and no issue #49 change.

## Follow-On Ledger Schema Slice Delivered

The DZN Store sandbox order ledger schema slice is delivered in `docs/DZN_STORE_SANDBOX_ORDER_LEDGER_SCHEMA.md` and `migrations/0072_dzn_store_order_ledger_schema.sql`.

It adds the private local/sandbox ledger tables:

- `store_orders`
- `store_order_items`
- `store_payment_events`

It still adds no checkout route, no Store API, no Stripe Checkout Session creation, no Store webhook handler, no webhook fulfilment, no account entitlement write, no Supporter Card issuance, no earned-spin ledger, no wheel runtime, no Stripe mutation, no Cloudflare secret/config mutation, no production D1 write, no live checkout activation, and no issue #49 change.
