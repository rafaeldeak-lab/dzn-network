# DZN Homepage Ambient Assets Handoff

Date: 2026-09-01

## Scope

This slice upgrades the public homepage visual treatment using the supplied no-text DZN UI assets:

- Master homepage background.
- Game-mode section background.
- Network Pulse/live intelligence background.
- Game-mode card skins.
- Stat card skins.
- Network Pulse card skins.
- Small icon assets for subtle rotating/levitating homepage effects.

The slice is presentation-only. It must not add Store/payment runtime, live checkout, chat runtime, analytics/tracking, production service writes, or competitive-system effects.

## Start State

- Base branch: `origin/main`
- Base commit at worktree creation: `9d2d5f9ee67773b74f8faabb260dace6d25936dd`
- Work branch: `codex/homepage-ambient-assets-20260901`
- Worktree: `C:\Users\rafae\Desktop\DZN-Audits\worktrees\dzn-homepage-ambient-assets-20260901`
- Source asset ZIP: `C:\Users\rafae\Downloads\DZN_no_text_UI_assets.zip`
- Extracted review copy: `C:\Users\rafae\Desktop\DZN-Audits\artifacts\dzn-homepage-ambient-assets-20260901\source-assets`

PR `#134` remains a separate header sizing release candidate. This branch does not merge, deploy, or approve PR `#134`.

## Implementation Contract

- Copy only selected WebP files into `public/media/homepage-ui`.
- Wire the homepage to the new assets through `HOMEPAGE_AMBIENT_ASSETS`.
- Keep the homepage data model and public API behavior unchanged.
- Keep full pricing/payment content on `/pricing`.
- Keep owner setup behind `/pricing` and canonical entitlement checks.
- Keep `DZN_LIVE_CHECKOUT_ENABLED` disabled.
- Do not mutate Stripe products/prices, Cloudflare secrets/config, production D1, Nitrado, Discord, retained exports, Store ledgers, chat ledgers, or issue `#49`.

## Protected Isolation

This slice must not affect:

- Billing or owner entitlements.
- Server ownership and Nitrado linking.
- Rankings, discovery score, reviews, badges, seasons, Server Wars, CTF scoring, XP awards, calling-card awards, events, public profile visibility, retained exports, moderation decisions, or competitive eligibility.
- Store orders, account entitlements, Supporter Cards, earned spins, reward wheel runtime, checkout sessions, or Stripe webhook fulfilment.
- DZN Comms sending, message persistence, reactions, report/moderation mutations, Durable Objects/WebSockets, DZN Assist AI runtime, vector stores, analytics, or metered calls.

## Validation Plan

Run before PR:

- `npm run test:homepage-ambient-assets`
- `npm run test:public-access-gating`
- `npm run check:billing-config`
- `git diff --check`
- `npx tsc --noEmit --incremental false`
- `npm run lint -- --ignore-pattern .wrangler/**`
- `npm run build`
- Local rendered homepage QA at desktop and mobile widths, with screenshots stored under the slice artifact directory.

## Validation Results

Completed on 2026-09-01:

- `npm run test:homepage-ambient-assets` passed.
- `npm run test:public-access-gating` passed.
- `npm run check:billing-config` passed as a read-only safety report and confirmed live checkout is not configured/enabled.
- `npm run test:site-header-overlap` passed.
- `git diff --check` passed; Git reported only Windows LF-to-CRLF working-copy warnings.
- `npx tsc --noEmit --incremental false` passed.
- `npm run lint -- --ignore-pattern .wrangler/**` passed with four existing warnings outside this slice.
- `npm run build` passed.
- Local rendered homepage QA passed at desktop and mobile widths.

Rendered evidence:

- Desktop screenshot: `C:\Users\rafae\Desktop\DZN-Audits\artifacts\dzn-homepage-ambient-assets-20260901\home-ambient-desktop.png`
- Mobile screenshot: `C:\Users\rafae\Desktop\DZN-Audits\artifacts\dzn-homepage-ambient-assets-20260901\home-ambient-mobile.png`
- Local asset checks returned HTTP `200` and `image/webp` for the selected homepage background, section, card, pulse, and icon assets.
- Browser proof confirmed `dznHomeBgDrift`, five floating ambient icons, forty-eight ember particles, and no header/main overlap at desktop or mobile widths.

Notes:

- Local Next dev does not serve Cloudflare Pages function routes, so `/api/auth/me`, `/api/public/home-stats`, `/api/public/server-rail`, and `/api/dzn-pulse/config` returned local dev `404` responses and the homepage used its existing fallback state.
- The server log included the existing Three.js `THREE.Clock` deprecation warning from `dzn-operational-globe`; this slice did not change that code.

## Next Order

The release order remains:

1. Review/merge/release PR `#134` separately when explicitly approved. No production D1 migration is needed for PR `#134`.
2. Review this homepage ambient-assets PR separately.
3. Continue with Player Hub profile/progression entry-point real-data polish after the current visual/header release path is settled.
