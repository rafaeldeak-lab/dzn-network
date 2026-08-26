# DZN Store Catalog And Admin Product/Price Draft Model Handoff

## Start State

- Worktree: `C:\Users\rafae\Desktop\DZN-Audits\worktrees\dzn-store-catalog-admin-draft-20260826`
- Branch: `codex/dzn-store-catalog-admin-draft-20260826`
- Base: `origin/codex/dzn-safe-monetisation-supporter-preflight-20260826`
- Base commit: `a27ab99`
- Protected OneDrive checkout was not modified.

## Scope

This slice starts the real DZN Safe Monetisation implementation with the smallest safe database/model step:

- Add inactive catalog schema for `store_products`.
- Add inactive catalog schema for `store_prices`.
- Add local server-side draft validation for admin product/price proposals.
- Keep Store flags default-disabled and undeclared in Cloudflare config.
- Keep Store catalog drafts separate from owner subscription billing and competitive systems.

## Implementation

Added:

- `migrations/0071_dzn_store_catalog_admin_draft.sql`
- `functions/_lib/dzn-store-catalog.ts`
- `scripts/test-dzn-store-catalog-admin-draft.ts`

Updated:

- `docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md`
- `docs/DZN_SAFE_MONETISATION_SUPPORTER_SYSTEM_BACKLOG.md`
- `docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md`
- `docs/PUBLIC_ACCESS_POLICY.md`
- `docs/BILLING_PLANS.md`
- `package.json`
- `scripts/test-dzn-safe-monetisation-supporter-preflight.ts`

## Catalog Model

`store_products` stores catalog metadata only:

- Approved product families: supporter pack, profile theme, calling-card pack, chat/profile cosmetic pack, group branding pack, and event presentation theme.
- Approved fulfilment kinds: supporter card, cosmetic entitlement, profile frame, chat badge, theme pack, and event theme.
- `active` defaults to `0`.
- `account_bound`, `guaranteed_purchase`, and `no_competitive_advantage` are fixed to `1`.
- paid-outcome flags for spins, XP, rank, discovery, review, event, Server Wars, CTF, owner subscription access, and competitive eligibility are fixed to `0`.

`store_prices` stores catalog price metadata only:

- Currency is restricted to lowercase `gbp` for this first draft model.
- `active` defaults to `0`.
- `unit_amount_minor` must be positive.
- `min_amount_minor` is blocked in this slice.
- `allow_pay_what_you_want` is fixed to `0`.
- `stripe_price_id` exists for the later payment slice, but this migration and draft validation keep it `NULL` in this slice.

## Admin Draft Validation

`functions/_lib/dzn-store-catalog.ts` adds:

- Default-false Store feature flag readers.
- `canValidateDznStoreDrafts(...)`, which requires both Store/admin flags and an already admin-authorized caller.
- `validateDznStoreProductDraft(...)`.
- `validateDznStorePriceDraft(...)`.
- A Founding Supporter product draft constant without a price seed or Stripe binding.

Validation rejects:

- active product or price drafts
- approved, paused, archived, or otherwise non-draft/review statuses
- unsupported product families or fulfilment kinds
- incompatible product/fulfilment combinations
- paid spin, XP, rank, discovery, review, event, Server Wars, CTF, owner setup, Nitrado, or competitive eligibility benefits
- pay-what-you-want pricing
- Stripe Price IDs
- non-GBP currency
- zero or negative local price drafts

## Explicitly Not Implemented

- No checkout creation.
- No webhook fulfilment.
- No `/account/purchases`.
- No reward wheel route or runtime.
- No order table.
- No payment event table.
- No account entitlement table.
- No supporter card table or issuance.
- No earned-spin ledger.
- No wheel cooldown table.
- No Stripe Product or Price mutation.
- No Stripe Checkout Session creation.
- No Cloudflare secret/config mutation.
- No production D1 writes.
- No live checkout activation.
- No issue #49 change or merge.
- No Nitrado, Discord, AI provider, vector store, analytics, tracking, or metered model call.

## Follow-On Preview Contract Delivered

The next slice adds the DZN Store public browse and Supporter Card preview contract without turning on commerce runtime:

- `app/store/page.tsx`
- `components/store/dzn-store-preview-page.tsx`

That follow-on `/store` page is read-only, disabled by default, and renders safe catalog preview metadata only. It does not create checkout sessions, orders, webhooks, entitlements, supporter cards, earned spins, wheel runtime, Stripe objects, Cloudflare secrets, production D1 writes, live checkout activation, or issue #49 changes.

## Fair Progression Boundary

The catalog model is presentation/payment-catalog metadata only. It cannot write or influence:

- Starter/Pro owner entitlement.
- server ownership.
- `/setup` or Nitrado access.
- rankings or discovery score.
- reviews or review score.
- badges, seasons, crowns, or earned reputation.
- events, brackets, approvals, rosters, or CTF scoring.
- Server Wars scoring.
- XP awards.
- earned calling-card awards.
- public profile visibility.
- retained exports.
- moderation decisions.
- competitive eligibility.

## Validation Completed

Completed validation for this branch:

- `npm ci`
- `npm run test:dzn-store-catalog-admin-draft`
- `npm run test:dzn-safe-monetisation-supporter-preflight`
- `npx wrangler d1 execute dzn_network_db --local --file migrations/0071_dzn_store_catalog_admin_draft.sql`
- `git diff --check`
- `npm run test:billing-plans`
- `npm run test:stripe-live-readiness`
- `npm run test:stripe-live-activation-checklist`
- `npm run check:billing-config`
- `npm run test:public-access-gating`
- `npm run test:player-owner-access-foundation`
- `npm run test:player-hub-foundation`
- `npm run test:player-saved-servers`
- `npm run test:dzn-comms-live-presence-counter`
- `npx tsc --noEmit --incremental false`
- `npm run lint`
- `npm run build`
- `npm test`
- `npm run autodev:quality`

## Security Review

- Codex Security diff scan: `2693ffd9-4c22-4dac-bb55-5e42cd568aa4`
- Result: zero findings.
- Reviewed security surfaces: `functions/_lib/dzn-store-catalog.ts`, `migrations/0071_dzn_store_catalog_admin_draft.sql`, `scripts/test-dzn-store-catalog-admin-draft.ts`, `scripts/test-dzn-safe-monetisation-supporter-preflight.ts`, and `package.json`.
- Manual bypass checks confirmed no checkout/session creation, webhook fulfilment, Store UI, order table, entitlement write, supporter-card issuance, earned-spin ledger, reward-wheel runtime, Stripe secret access, external fetch, Cloudflare flag/config mutation, production D1 write, or competitive-system coupling.

## Prior Next Recommended Slice

Next should be the DZN Store public browse and Supporter Card preview contract: define and, if approved, add a disabled-by-default read-only `/store` preview surface that reads only inactive/approved-safe catalog metadata, shows guaranteed purchase/account-bound/no competitive advantage copy and supporter-card theme preview copy, and still creates no checkout sessions, orders, webhooks, entitlements, supporter cards, earned spins, wheel runtime, Stripe objects, Cloudflare secrets, production D1 writes, live checkout activation, or issue #49 changes.
