# DZN Store Fulfilment Ledger Schema Migration Approval Preflight Handoff

## Start State

- Worktree: `C:\Users\rafae\Desktop\DZN-Audits\worktrees\dzn-store-fulfilment-ledger-schema-preflight-20260828`
- Branch: `codex/dzn-store-fulfilment-ledger-schema-preflight-20260828`
- Base: `codex/dzn-store-webhook-fulfilment-approval-preflight-20260828`
- Base commit: `a28706da104863a9e6926ab0d2fec812b60f9935`
- Prior stacked PR: `#104` for the Store webhook fulfilment approval preflight.
- Protected OneDrive checkout was not modified.

## Scope

This slice is preflight-only documentation and guard-test work for future DZN Store fulfilment ledger schema.

Added:

- `docs/DZN_STORE_FULFILMENT_LEDGER_SCHEMA_PREFLIGHT.md`
- `docs/DZN_STORE_FULFILMENT_LEDGER_SCHEMA_PREFLIGHT_HANDOFF.md`
- `scripts/test-dzn-store-fulfilment-ledger-schema-preflight.ts`

Updated:

- `docs/DZN_STORE_WEBHOOK_FULFILMENT_APPROVAL_PREFLIGHT.md`
- `docs/DZN_STORE_WEBHOOK_FULFILMENT_APPROVAL_PREFLIGHT_HANDOFF.md`
- `docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md`
- `docs/DZN_SAFE_MONETISATION_SUPPORTER_SYSTEM_BACKLOG.md`
- `docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md`
- `docs/PUBLIC_ACCESS_POLICY.md`
- `docs/BILLING_PLANS.md`
- `docs/STRIPE_LIVE_ACTIVATION_CHECKLIST.md`
- `package.json`

## Architecture Found

DZN currently separates:

- Owner subscription checkout and webhooks for Starter/Pro owner access.
- Player/account DZN Store sandbox order and Checkout Session work for guaranteed cosmetics/supporter purchases.
- Receipt-only Store webhook handling that verifies Stripe signatures and records sanitized test-mode `store_payment_events` rows only.

The current Store schema has only:

- `store_products`
- `store_prices`
- `store_orders`
- `store_order_items`
- `store_payment_events`

The current Store schema does not have `account_entitlements`, `supporter_cards`, `store_fulfilment_attempts`, refund/dispute audit tables, earned-spin ledgers, wheel ledgers, or account-purchase UI tables.

## Schema Contract Defined

The preflight defines the future local/test-only migration contract for:

- `account_entitlements`
- `supporter_cards`
- `store_fulfilment_attempts`
- `store_order_status_history`
- `store_entitlement_status_history`
- `store_refund_dispute_audit`

It also defines:

- Future migration name reservation rules.
- Exact table/column intent.
- Status lifecycle values.
- Uniqueness constraints for source order items, payment-event processing, Supporter Card serials, and one Founding Supporter Card per user.
- Refund, reversal, chargeback, dispute, suspension, restoration, and revocation audit rules.
- SQL guardrails blocking data backfills, remote apply commands, Stripe commands, live flags, and protected-system couplings.
- Runtime dependency proof required after schema exists.

## Access And Write Matrix

| Surface | Current result | Future schema rule |
| --- | --- | --- |
| `/store` | Read-only preview plus sandbox order/checkout routes behind flags | No entitlement until verified webhook fulfilment exists later. |
| `POST /api/stripe/store-webhook` | Signed test-mode receipt row only | Schema may support later processing audit, but route stays receipt-only in this slice. |
| `store_payment_events` | Receipt-only with fixed-zero blockers | Existing blockers remain unchanged in this slice. |
| Future `account_entitlements` | Not implemented | Private account-bound cosmetic/supporter entitlement table only. |
| Future `supporter_cards` | Not implemented | One Founding Supporter Card per qualifying account, serial-unique. |
| Future fulfilment attempts/history | Not implemented | Private idempotency and audit state only; no runtime side effects from this preflight. |
| Future earned spins/wheel | Not implemented | Excluded from this migration; requires a separate earned-only wheel slice. |
| Owner `/setup` and Nitrado | Unchanged owner entitlement gate | Store schema must never unlock owner access. |

## Personal Player Page Entry Check

There is already a `Player Hub` top navigation item pointing to `/player`, and the Player Hub API includes entries for `/player/profile` and a public profile link/settings entry when available.

That is probably why you can reach the personal player area through Player Hub rather than a separate obvious "My Profile" button. The master spec now records a later player UX polish item to make that entry clearer with a direct "My Player Profile" or "My Profile" button in logged-in player navigation and Player Hub action areas.

## Protected Surfaces

This slice leaves these surfaces untouched:

- Owner billing plan normalization.
- Starter/Pro owner subscription checkout.
- Owner subscription webhook handling.
- `/setup`.
- Nitrado linking.
- Owner onboarding.
- Owner dashboards.
- Server-management APIs.
- Server ownership.
- Rankings and discovery score.
- Reviews and review score.
- Badges, seasons, crowns, events, brackets, CTF scoring, and Server Wars scoring.
- XP awards and earned calling-card awards.
- Public profile visibility and profile privacy settings.
- Retained exports.
- Moderation decisions.
- Competitive eligibility.

## Production-Mutation Confirmation

This slice must not run or approve:

- `npm run db:migrate:remote`
- `wrangler d1 migrations apply dzn_network_db --remote`
- `wrangler d1 migrations apply dzn_network_db --local`
- `wrangler pages secret put`
- Stripe Product or Price creation/mutation.
- Stripe Checkout Session creation beyond already approved sandbox route behavior.
- Stripe webhook endpoint creation/mutation.
- Stripe customer, refund, dispute, or payment mutation.
- Store webhook fulfilment.
- Account entitlement writes.
- Supporter Card issuance.
- Earned-spin or reward-wheel runtime.
- Cloudflare Pages deployment.
- Nitrado or Discord mutations.
- Live checkout activation.
- Issue #49 mutation or merge.

## Validation

Completed validation on 2026-08-28:

- `npm run test:dzn-store-fulfilment-ledger-schema-preflight`
- `npm run test:dzn-store-webhook-fulfilment-approval-preflight`
- `npm run test:dzn-store-sandbox-webhook-ledger-receipt`
- `npm run test:dzn-store-sandbox-checkout-session-approval`
- `npm run test:dzn-store-sandbox-order-route-approval`
- `npm run test:dzn-store-order-ledger-schema`
- `npm run test:dzn-safe-monetisation-supporter-preflight`
- `npm run test:billing-plans`
- `npm run test:stripe-live-readiness`
- `npm run test:stripe-live-activation-checklist`
- `npm run check:billing-config`
- `npx tsc --noEmit --incremental false`
- `npm run lint`
- `npm test`
- `npm run build`
- `git diff --check`

All commands passed.

Additional checks:

- Focused safety scan found no new live checkout flag assignment, no Store live checkout assignment, no new `checkout.sessions.create` use in this slice, no account entitlement write, no Supporter Card write, no earned-spin write, and no new account-entitlement/supporter-card/spin/wheel table creation.
- Migration directory still ends at `0072_dzn_store_order_ledger_schema.sql`; `migrations/0073_dzn_store_fulfilment_ledger_schema.sql` was not added.
- `npm ci` reported existing dependency audit warnings in the installed tree; no dependency changes were made in this slice.

## Security Review

Codex Security diff scan `4a2a4734-ea3a-404d-9bec-53ff780ed9e8` completed with zero findings.

Coverage included:

- `package.json`
- `scripts/test-dzn-store-fulfilment-ledger-schema-preflight.ts`
- `docs/DZN_STORE_FULFILMENT_LEDGER_SCHEMA_PREFLIGHT.md`
- `docs/DZN_STORE_FULFILMENT_LEDGER_SCHEMA_PREFLIGHT_HANDOFF.md`
- Store/payment/public access integration docs updated by this slice

TAC advisory could not be verified because the Codex Security Access connector is not connected.

## Next Recommended Slice

Next should be DZN Store fulfilment ledger schema migration implementation only if deliberately approved: add the local/test-only migration after rechecking migration numbering, create only the approved account-entitlement, Supporter Card, fulfilment-attempt, order-status-history, entitlement-status-history, and refund/dispute audit tables, keep Store fulfilment runtime disabled, and still avoid webhook fulfilment writes, Supporter Card issuance, earned spins, reward wheel runtime, live checkout, Stripe Product/Price mutation, Cloudflare config mutation, production D1 writes, and issue #49 changes.
