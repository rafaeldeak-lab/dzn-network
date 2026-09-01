# DZN Header Navigation Overlap Fix Handoff

Date: 2026-09-01

Branch: `codex/header-nav-overlap-fix-20260901`

Base: `origin/main` at `f606c042633f5532cb971ced99beb4131a726349`

## Scope

This slice fixes the shared top header layout where authenticated nav buttons could overlap around the homepage/features header at desktop widths.

- Widens the shared header cap from `1500px` to `1880px`.
- Allows the header row, link group, and action group to wrap instead of colliding.
- Adds a container-width rule that moves authenticated nav links onto a second row before owner actions crowd them.
- Keeps logged-in Player Hub, DZN Pulse, Discord, owner setup, package, and logout controls present.
- Adds a focused source test for the responsive header contract.

## Boundaries

This is a visual/layout fix only.

No auth, billing, Store, checkout, Stripe, Cloudflare, D1, Discord, Nitrado, owner entitlement, ranking, discovery, review, event, progression, Server Wars, CTF, chat/runtime, analytics, or production deployment code is changed.

## Expected Manual QA

- On the homepage and any page using the shared root header, authenticated buttons should wrap cleanly before they overlap.
- The personal Player Hub header link remains visible for logged-in users.
- At crowded desktop widths, the primary navigation can move to a neat second row.
- At mobile widths, action buttons still collapse into the existing full-width grid.

## Validation

Completed locally on 2026-09-01:

- `npm run test:site-header-overlap` passed.
- `npm run test:nav-access-visibility` passed.
- `npm run test:dzn-player-nav-main-release-candidate` passed.
- `npm run test:public-access-gating` passed.
- `npm run check:billing-config` passed and confirmed live checkout remains disabled/not configured.
- `npx tsc --noEmit --incremental false` passed.
- `npm run lint -- --ignore-pattern .wrangler/**` passed with existing unrelated warnings only.
- `npm run build` passed.
- `npm test` passed.
- `git diff --check` passed with Windows line-ending warnings only.
- Local headless Edge render of an authenticated crowded header at `1774px` reported `linksActionsOverlap: false`.

Dependency install note: `npm ci` completed, with existing dependency audit warnings in the current tree.

## Next Product Slice

After PR `#129` is reviewed, merged, and released separately, the next clean product slice should be Player Hub suggested event/tournament relevance polish:

- Prioritise public events connected to followed servers.
- Prioritise public events connected to privately matched Discord communities.
- Keep the suggestions presentation-only and isolated from scoring, eligibility, billing, owner workflows, progression, reviews, rankings, and discovery formulas.
