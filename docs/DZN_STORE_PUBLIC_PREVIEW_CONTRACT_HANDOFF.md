# DZN Store Public Browse And Supporter Card Preview Contract Handoff

## Start State

- Worktree: `C:\Users\rafae\Desktop\DZN-Audits\worktrees\dzn-store-public-preview-contract-20260826`
- Branch: `codex/dzn-store-public-preview-contract-20260826`
- Base: `origin/codex/dzn-store-catalog-admin-draft-20260826`
- Base commit: `2a2de04`
- Protected OneDrive checkout was not modified.

## Scope

This slice adds the first public-facing DZN Store contract without enabling commerce runtime:

- Read-only `/store` preview.
- Safe catalog metadata from `functions/_lib/dzn-store-catalog.ts`.
- DZN Supporter Card preview copy and sample visual contract.
- Guaranteed-purchase, account-bound, no-competitive-advantage labels.
- DZN-branded animated background treatment with reduced-motion fallback.
- Default-disabled Store preview state.

The route is disabled by default and remains visible only as a non-checkout preview contract.

## Implementation

Added:

- `app/store/page.tsx`
- `components/store/dzn-store-preview-page.tsx`
- `docs/DZN_STORE_PUBLIC_PREVIEW_CONTRACT_HANDOFF.md`
- `scripts/test-dzn-store-public-preview-contract.ts`

Updated:

- `functions/_lib/dzn-store-catalog.ts`
- `app/globals.css`
- `docs/DZN_STORE_CATALOG_ADMIN_DRAFT_HANDOFF.md`
- `docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md`
- `docs/DZN_SAFE_MONETISATION_SUPPORTER_SYSTEM_BACKLOG.md`
- `docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md`
- `docs/PUBLIC_ACCESS_POLICY.md`
- `docs/BILLING_PLANS.md`
- `package.json`
- `scripts/test-dzn-store-catalog-admin-draft.ts`
- `scripts/test-dzn-safe-monetisation-supporter-preflight.ts`

## Preview Contract

`readDznStorePublicPreviewContract()` returns:

- `enabled: false` by default.
- `state: "disabled_by_default"` by default.
- Six preview-only product cards.
- A blocked action list for checkout, order creation, payment events, entitlements, Supporter Card issuance, earned spins, wheel runtime, Stripe Price binding, and live checkout enablement.

The public preview products are:

- `DZN FOUNDING SUPPORTER PACK`
- `DZN Profile Theme Pack`
- `DZN Cosmetic Calling-Card Pack`
- `DZN Chat And Profile Cosmetic Pack`
- `DZN Group Banner And Insignia Pack`
- `DZN Event Presentation Theme`

Every product is:

- `catalogStatus: "preview_only"`
- `active: false`
- `checkoutAvailable: false`
- `accountBound: true`
- `guaranteedPurchase: true`
- `noCompetitiveAdvantage: true`

## Supporter Card Preview

The Founding Supporter preview shows sample-only card copy:

- sample serial: `DZN-SUP-002481`
- theme options: `Signal Crown`, `Ember Relay`, `Survivor Static`
- permanent fields: serial number, display name, Supporter Since, selected theme, and generated insignia

No Supporter Card is issued by this slice.

## Explicitly Not Implemented

- No checkout sessions.
- No orders.
- No webhooks.
- No entitlements.
- No supporter cards are issued.
- No earned spins.
- No wheel runtime.
- No Stripe object mutation.
- No Stripe Product or Price mutation.
- No Cloudflare secret/config mutation.
- No production D1 write.
- No live checkout activation.
- No account purchases page.
- No Store API route.
- No payment success fulfilment.
- No issue #49 change.
- No Nitrado, Discord, AI provider, vector store, analytics, tracking, metered model call, or retained-export change.

## Fair Progression Boundary

The `/store` preview is presentation and contract only. It cannot write or influence:

- owner billing accounts.
- owner plan entitlements.
- server ownership.
- `/setup` or Nitrado access.
- rankings or discovery score.
- reviews or review score.
- badges, seasons, crowns, or earned reputation.
- events, brackets, approvals, rosters, CTF scoring, or Server Wars scoring.
- XP awards.
- earned calling-card awards.
- public profile visibility.
- retained exports.
- moderation decisions.
- competitive eligibility.

## Validation Completed

Completed validation for this branch:

```text
npm ci
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

The older Safe Monetisation and catalog guards now explicitly allow only:

- `app/store/page.tsx`
- `components/store/dzn-store-preview-page.tsx`

They continue to reject Store APIs, checkout creation, webhook fulfilment, Store orders, payment events, account entitlement writes, Supporter Card issuance, earned-spin ledgers, wheel runtime, Stripe mutation, Cloudflare config mutation, production D1 writes, live checkout activation, and issue #49 changes.

Rendered local QA completed against `http://127.0.0.1:3072/store`:

- Desktop route loaded with `data-dzn-store-preview="read-only"` and `data-dzn-store-checkout="disabled"`.
- Mobile-sized route loaded without horizontal overflow.
- Six product preview cards rendered.
- `DZN FOUNDING SUPPORTER PACK`, `DZN-SUP-002481`, `Checkout disabled`, and `No competitive advantage` copy were visible.
- `/media/dzn-pricing-bg-layer.png` and `/media/dzn-pricing-fog-ember-overlay.png` loaded.
- No browser console errors were observed.

## Security Review

- Codex Security diff scan: `0593998b-8404-48b1-af8d-8ba7fb7cd7da`
- Result: zero findings.
- Coverage: complete over the 9 changed source files in the scan inventory.
- TAC advisory: not verified because the Codex Security Access connector was not connected.
- Manual bypass checks confirmed no checkout/session creation, Store API, order table, payment event table, account entitlement write, Supporter Card issuance, earned-spin ledger, reward-wheel runtime, Stripe secret access, external fetch, browser storage, analytics/tracking, Cloudflare flag/config mutation, production D1 write, or protected-system coupling in the Store preview files.

## Next Recommended Slice

Next should be the DZN Store sandbox order and checkout approval preflight: define the exact authenticated order-creation contract, one-time Stripe Checkout Session shape, webhook event ledger, idempotent fulfilment rules, refund/chargeback revocation plan, tax/receipt records, feature-flag defaults, rollback path, and proof matrix before any checkout route, order table, payment webhook, entitlement write, Supporter Card issuance, earned-spin ledger, wheel runtime, Stripe object mutation, Cloudflare secret/config mutation, production D1 write, live checkout activation, or issue #49 change is implemented.
