# DZN Header Command Bar Visual Handoff

Date: 2026-09-01

Branch: `codex/header-command-bar-20260901`

Base: `origin/main` at `9f00cafb6b9a4514d24ddeb374f271e4b1977c32`

## Scope

This slice updates the shared public/header experience to a DZN command-bar style based on the latest reference direction.

- Keeps the existing animated DZN corner logo component and its WebM/MP4/poster fallback sources.
- Reframes the header into three command zones: animated logo, primary navigation, and authenticated/action controls.
- Adds icon-over-label nav buttons with hover and keyboard focus glow states.
- Adds icon-led action buttons for Discord, Dashboard, owner setup, package actions, login, and logout.
- Adds a brighter red unread DZN Pulse notification badge for outstanding notifications.
- Keeps `/player` visible for logged-in users through the existing personal Player Hub nav path.
- Keeps public/logged-out navigation limited to the public funnel.

## Boundaries

This is a visual/header slice only.

No Store, Supporter Card, checkout, live payment, Stripe, Cloudflare, D1, Discord API, Nitrado, owner entitlement, ranking, discovery, review, event, progression, Server Wars, CTF, chat runtime, AI, analytics, retained export, migration, or production deployment code is changed.

Issue `#49` remains reserved for final live checkout activation and is not touched by this slice.

## Expected Manual QA

- The shared header should look like a wider DZN command deck on pages that use the root header.
- The animated logo should still autoplay when motion is allowed and fall back to the approved poster when video is unavailable or reduced motion is preferred.
- Hovering across nav/action buttons should clearly highlight the current target.
- Keyboard focus should receive the same visible treatment as hover.
- Logged-in Player Hub access should remain clear.
- The unread DZN Pulse badge should be bright red and visible.
- Header controls should not overlap on desktop, mid-width, tablet, or mobile layouts.

## Validation

Completed before PR/release review:

- `npm run test:site-header-overlap` passed.
- `npm run test:dzn-player-nav-main-release-candidate` passed.
- `npm run test:nav-access-visibility` passed.
- `npm run test:public-access-gating` passed.
- `npm run test:dashboard-loading` passed.
- `npm run check:billing-config` passed as a read-only safety check. Stripe secret/price variables remain absent, live checkout remains disabled, and checkout session creation remains blocked.
- `npx tsc --noEmit --incremental false` passed.
- `npm run lint -- --ignore-pattern .wrangler/**` passed with the existing unrelated warnings in `components/network/public-network.tsx`, `components/servers/live-server-rail.tsx`, and `functions/api/servers/[serverId]/dashboard/advanced-stats.ts`.
- `npm run build` passed and produced the Cloudflare Pages static export.
- `git diff --check` passed with only Windows CRLF notices.

Rendered local proof was captured from the rebuilt static export at `http://localhost:3075` using browser-only stubs for `/api/auth/me` and DZN Pulse so no real account, notification, or service was touched.

Artifacts: `C:\Users\rafae\Desktop\DZN-Audits\artifacts\dzn-header-command-bar-20260901`

- Public homepage desktop, mid-width, and mobile: zero measured header control overlaps or overflows.
- Public `/servers` and the existing `/pricing` entry route, which currently redirects to `/#pricing`: zero measured header control overlaps or overflows.
- Authenticated mock homepage desktop, mid-width, and mobile: zero measured header control overlaps or overflows, 13 shared-header controls, animated logo rendered as `video` with two sources, and unread badge rendered as bright red `rgb(239, 29, 40)`.
- Authenticated mock `/player`: active Player Hub state preserved, zero measured header control overlaps or overflows, and unread badge anchored to the notification button.
- Hover proof: moving the cursor over the Servers nav item produced the highlighted nav state.
- Reduced-motion proof: logo rendered through the poster/image fallback instead of video.
- Pulse unavailable proof: the authenticated header remained stable without an unread badge when the local Pulse config stub returned unavailable.

## Next Product Slice

After this header slice is reviewed, merged, and released separately, continue with Player Hub suggested event/tournament relevance polish:

- Prioritise public events connected to followed servers.
- Prioritise public events connected to privately matched Discord communities.
- Keep suggestions presentation-only and isolated from scoring, eligibility, billing, owner workflows, progression, reviews, rankings, and discovery formulas.
