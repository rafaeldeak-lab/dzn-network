# DZN Header Compact Command Bar Handoff

Date: 2026-09-01

Branch: `codex/header-compact-command-bar-20260901`

Base: `origin/main` at `9d2d5f9ee67773b74f8faabb260dace6d25936dd`

## Scope

This slice reduces the shared DZN command-bar header size across pages that use the root header.

- Shrinks the outer header spacing so the header no longer dominates the first viewport.
- Reduces the desktop command bar, logo pod, nav link cells, action buttons, plan pill, and notification button heights.
- Keeps the animated DZN logo component and approved WebM/MP4/poster sources unchanged.
- Keeps hover and keyboard focus highlight behavior on nav/action controls.
- Keeps the bright red DZN Pulse unread badge anchored to the notification button.
- Keeps logged-in Player Hub access and owner actions present.

## Boundaries

This is a visual/layout slice only.

No auth, billing, Store, checkout, Stripe, Cloudflare secret/config, production D1, Discord runtime, Nitrado, owner entitlement, ranking, discovery, review, event, progression, Server Wars, CTF, chat/runtime, AI, analytics, retained export, migration, or live deployment code is changed.

Issue `#49` remains reserved for final live checkout activation and is not touched by this slice.

## Manual QA Target

- The shared header should feel closer to a compact command deck than a large hero panel.
- The animated corner logo should still play when motion is allowed and fall back to the poster when motion is reduced or video is unavailable.
- Hovering across header buttons should visibly highlight the current target.
- Outstanding notification counts should remain bright red and readable.
- Header controls should not overlap on desktop, mid-width, tablet, or mobile layouts.

## Validation

Completed locally on 2026-09-01:

- `npm run test:site-header-overlap` passed.
- `npm run test:dzn-player-nav-main-release-candidate` passed.
- `npm run test:nav-access-visibility` passed.
- `npm run test:public-access-gating` passed.
- `npm run test:dashboard-loading` passed.
- `npm run check:billing-config` passed as a read-only safety check. Stripe secret/price variables remain absent, live checkout remains disabled, and checkout session creation remains blocked.
- `npx tsc --noEmit --incremental false` passed.
- `npm run lint -- --ignore-pattern .wrangler/**` passed with existing unrelated warnings in `components/network/public-network.tsx`, `components/servers/live-server-rail.tsx`, and `functions/api/servers/[serverId]/dashboard/advanced-stats.ts`.
- `npm run build` passed and produced the Cloudflare Pages static export.
- `git diff --check` passed with only Windows CRLF notices.

Rendered local proof was captured from `http://127.0.0.1:3094` using browser-only stubs for `/api/auth/me`, `/api/dzn-pulse/config`, and `/api/dzn-pulse/notifications/unread-count`. No real account, notification, or service was touched.

Artifacts: `C:\Users\rafae\Desktop\DZN-Audits\artifacts\dzn-header-compact-command-bar-20260901`

- Authenticated homepage desktop `1774x520`: shared header measured `108px` tall, animated logo rendered as `video` with two sources, unread badge rendered as bright red `rgb(239, 29, 40)`, and zero measured control overlaps.
- Authenticated `/servers` desktop `1440x620`: shared header measured `108px` tall, animated logo rendered as `video` with two sources, unread badge rendered as bright red `rgb(239, 29, 40)`, and zero measured control overlaps.
- Authenticated homepage mobile `390x820`: shared header measured `363px` tall with two-column action controls, animated logo rendered as `video` with two sources, unread badge rendered as bright red `rgb(239, 29, 40)`, and zero measured control overlaps.
- Anonymous homepage mid-width `1250x620`: shared header measured `92px` tall, animated logo rendered as `video`, public controls remained inside the compact frame, and zero measured control overlaps.
- Hover proof: moving the cursor over the Servers nav item produced the highlighted nav glow state.

## Next Product Slice

After this header polish is reviewed, merged, and released separately, continue with Player Hub profile/progression entry-point real-data polish:

- Surface safe current-user profile/progression summaries inside `/player`.
- Keep visibility preferences, award rules, billing, scoring, rankings, reviews, events, Server Wars, CTF, and competitive eligibility isolated.
