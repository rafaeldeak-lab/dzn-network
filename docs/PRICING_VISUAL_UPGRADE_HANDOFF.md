# DZN Pricing Visual Upgrade Handoff

## Scope

This slice upgrades the dedicated `/pricing` page presentation only. It is stacked on the saved/followed server interaction branch and does not change entitlement rules, checkout activation, live payment configuration, production data, Nitrado, Discord, rankings, reviews, events, or competitive scoring.

## Branching

- Base dependency: `codex/player-saved-servers-20260825` / PR #52.
- Slice branch: `codex/pricing-visual-upgrade-20260825`.
- Production merge/deploy/payment activation: not included.

## Product Contract

The homepage remains a light plan teaser. The dedicated `/pricing` page owns the full Starter vs Pro owner-plan comparison, checkout actions, plan details, and fairness explanation.

Starter remains:

- 2-day free trial.
- £0 today, then £2/month.
- One linked DayZ server and basic owner setup/listing tools.

Pro remains:

- £10/month.
- Richer owner toolkit with higher limits, stronger presentation, more Discord automation, promotion credits, analytics, gallery/banner support, event promotion tools, and Pro visual treatment.

Payment improves owner tools and presentation only. It never changes competitive rank, leaderboard formulas, ADM stats, reviews, event outcomes, crowns, badges, seasons, challenges, XP, or competitive eligibility.

## Implementation Notes

- `app/pricing/page.tsx` keeps `getBillingPlans()` and `createCheckoutSession(planKey, returnTo)` so checkout remains behind the existing guarded billing API.
- The page renders clear green ticks and red X marks through the comparison value component.
- The Pro feature list is materially larger than Starter and avoids claims of bought competitive advantage.
- User-provided reference assets are copied into `public/media/dzn-pricing-*.png`.
- `app/globals.css` adds subtle background pan/zoom classes and reduced-motion fallback.

## Live Checkout Safety

This slice must not enable live checkout. It must not mutate Stripe products/prices, Cloudflare secrets, production D1, Nitrado, or Discord resources. Issue #49 remains reserved for final live checkout activation.

The page may mention `DZN_LIVE_CHECKOUT_ENABLED=true` only as explanatory go-live copy. It must not assign that flag or add any production mutation command.

## Validation Checklist

- `git diff --check`
- `npm run test:pricing-visual-upgrade`
- `npm run test:billing-plans`
- `npm run test:stripe-live-readiness`
- `npm run check:billing-config`
- `npm run test:stripe-live-activation-checklist`
- `npm run test:public-access-gating`
- `npm run test:player-owner-access-foundation`
- Typecheck, lint, and build when dependencies are installed.
