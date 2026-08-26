# DZN Safe Monetisation And Supporter System Implementation Preflight Handoff

## Start State

- Worktree: `C:\Users\rafae\Desktop\DZN-Audits\worktrees\dzn-safe-monetisation-supporter-preflight-20260826`
- Branch: `codex/dzn-safe-monetisation-supporter-preflight-20260826`
- Base: `origin/codex/dzn-comms-live-presence-counter-foundation-20260826`
- Base commit: `54b17a1`
- Protected OneDrive checkout was not modified.

## Architecture Found

The current repository already has a subscription billing foundation for owner/server-management access:

- `lib/billing/plans.ts` contains the public Starter/Pro plan contract and legacy effective-Pro normalization.
- `functions/_lib/plans.ts` contains canonical billing readiness, checkout safety, entitlement normalization, and Starter trial claim logic.
- `functions/_lib/stripe.ts` contains Stripe helpers, raw-body webhook verification, and timing-safe signature comparison.
- `functions/api/billing/create-checkout-session.ts` creates owner subscription Checkout Sessions with `mode: "subscription"`.
- `functions/api/stripe/webhook.ts` handles subscription-oriented webhook events after signature verification.
- `docs/STRIPE_LIVE_ACTIVATION_CHECKLIST.md` keeps live checkout activation manual and tied to issue #49.

## Implementation

Added `docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md` as the durable production preflight for:

- Store/catalog/order/payment implementation sequencing.
- Disabled-by-default Store, checkout, webhook fulfilment, supporter-card, earned-spin, reward-wheel, and admin flags.
- Future migration shapes for `store_products`, `store_prices`, `store_orders`, `store_order_items`, `store_payment_events`, `account_entitlements`, `supporter_cards`, `earned_spins`, `spin_ledger`, and `wheel_cooldowns`.
- One-time Stripe Checkout `mode=payment` boundary for future Store orders.
- Raw-body signed webhook verification.
- Idempotent fulfilment and duplicate-event protection.
- Refund, reversal, and chargeback handling.
- Admin pricing and immutable completed-order snapshots.
- Tax/receipt/private payment-data boundaries.
- Fair Progression Boundary and no-buyable-spins policy.
- Rollback plan and runtime security proof requirements.

Updated:

- `docs/DZN_SAFE_MONETISATION_SUPPORTER_SYSTEM_BACKLOG.md`
- `docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md`
- `docs/PUBLIC_ACCESS_POLICY.md`
- `docs/BILLING_PLANS.md`
- `docs/STRIPE_LIVE_ACTIVATION_CHECKLIST.md`
- `package.json`
- `scripts/test-dzn-safe-monetisation-supporter-preflight.ts`

## Entitlement And Access Matrix

Future Store purchases are player/account cosmetic entitlements only. They must not unlock:

- `/setup`
- Nitrado linking
- owner onboarding
- owner dashboards
- server-management APIs
- owner billing plan status
- server ownership

Future Store, Supporter, and Wheel work must not affect:

- rankings
- discovery score
- reviews or review score
- badges, seasons, crowns, or earned reputation
- events, brackets, rosters, approvals, or CTF scoring
- Server Wars scoring
- XP awards
- earned calling-card awards
- public profile visibility
- retained exports
- moderation decisions
- competitive eligibility

## Protected Surfaces

This preflight explicitly keeps these unimplemented:

- `/store`
- `/account/purchases`
- reward wheel UI/runtime
- Store checkout routes
- Store webhook fulfilment
- Store/supporter/wheel database migrations
- account entitlement writes
- Supporter Card issuance
- earned-spin ledgers
- Stripe product/Price mutation
- Cloudflare secret/config mutation
- production D1 writes
- live checkout activation
- issue #49 changes

## Validation

Completed:

- `npm ci`
- `npm run test:dzn-safe-monetisation-supporter-preflight`
- `git diff --check`
- `npm run test:billing-plans`
- `npm run test:stripe-live-readiness`
- `npm run test:stripe-live-activation-checklist`
- `npm run test:dzn-comms-live-presence-counter`
- `npm run test:public-access-gating`
- `npm run test:player-owner-access-foundation`
- `npm run test:billing-integrity`
- `npm run test:nitrado-diagnostics`
- `npm run test:auth-return-flow`
- `npm run test:auth-mission-briefing`
- `npm run test:nav-access-visibility`
- `npm run test:server-lifecycle-resource-control`
- `npx tsc --noEmit --incremental false`
- `npm run lint`
- `npm run build`
- `npm test`
- `npm run check:billing-config`
- `npm run autodev:quality`

Notes:

- `npm run lint` passed with four existing warnings.
- `npm run check:billing-config` confirmed Stripe variables are absent in this worktree, live billing is not configured, and live checkout is not enabled.
- `npm ci` reported existing dependency advisories; no package dependency changes were introduced by this slice.

## Security Review

Codex Security diff scan:

- Result: zero findings.
- The final task report records the scan ID and local report artifact path for the exact final patch reviewed.

TAC advisory status could not be verified because the Codex Security Access connector is not connected. The scan continued because TAC status is advisory and not an authorization gate.

## Production-Mutation Confirmation

No live checkout was enabled.

No one-time Stripe Checkout Session, Stripe product, Stripe Price, Stripe customer, Stripe webhook endpoint, Cloudflare secret, Cloudflare binding, production D1 migration, production D1 row, Nitrado resource, Discord resource, AI provider credential, vector store, analytics/tracking path, metered model call, or issue #49 change was created or modified.

## Next Recommended Slice

Next should be the DZN Store catalog and admin product/price draft model: add the disabled-by-default catalog migrations and admin-only draft product/price validation locally, with no checkout creation, no webhook fulfilment, no supporter card issuance, no earned-spin ledger, no wheel runtime, no account entitlement writes, no live checkout, no Stripe product/Price changes, no Cloudflare secret changes, no production D1 writes, and no issue #49 changes.
