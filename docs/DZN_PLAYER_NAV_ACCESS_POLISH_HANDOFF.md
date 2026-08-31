# DZN Player Navigation Access Polish Handoff

Date: 2026-08-31

Branch: `codex/dzn-player-nav-main-release-candidate-20260831`

Base: `origin/main` at `7f00d2eb6b68bae112eb02d771036c5b97f8e9ea`

## Scope

This slice adds a clear logged-in personal player entry point on top of current `main`:

- `/player` for the private Player Hub entry.
- `/player/profile` for the private profile entry.
- Authenticated header navigation includes `Player Hub`.
- Logged-out header navigation still does not advertise private player pages.
- Cloudflare page middleware and routes include `/player` and `/player/*`.

## Boundaries

This slice intentionally does not add Store/payment fulfilment, Supporter Card reveal, chat sending, Comms reactions, AI Assist runtime, presence runtime, Durable Objects/WebSockets, analytics, production writes, or live checkout activation.

The new player pages read only from `/api/auth/me`. They do not write privacy settings, purchases, reviews, events, rankings, scores, XP, calling cards, badges, seasons, Server Wars, Nitrado, Stripe, Discord, or Store ledgers.

## Expected Behavior

- Logged-out direct visits to `/player` or `/player/profile` are redirected to `/login?returnTo=...` by the Cloudflare Pages middleware.
- In local app preview without the Pages middleware/API runtime, the player page shows a login-required fallback instead of exposing private account content.
- Logged-in users see a clear Player Hub button in the shared header and can open `/player` or `/player/profile`.
- Owner setup remains separate and billing/entitlement gates remain authoritative server-side.

## Validation

Local validation completed on 2026-08-31:

- `npm run test:dzn-player-nav-main-release-candidate`
- `npm run test:public-access-gating`
- `npm run test:nav-access-visibility`
- `npm run check:billing-config`
- `npx tsc --noEmit --incremental false`
- `npm run lint -- --ignore-pattern .wrangler/**`
- `npm run build`
- `npm test`
- `git diff --check`

Rendered local QA used `http://127.0.0.1:3075` and saved screenshots outside the repository under `C:\Users\rafae\Desktop\DZN-Audits\artifacts\dzn-player-nav-main-release-candidate-20260831`.

Captured states:

- `/player` logged-out/API-unavailable fallback, desktop.
- `/player` logged-in local account stub, desktop.
- `/player` logged-in local account stub, 1280px mid-width after header wrap fix.
- `/player/profile` logged-in local account stub, mobile.

Notes:

- Next dev does not serve this repository's Cloudflare Pages Functions directly, so unauthenticated local preview shows the built-in login-required fallback when `/api/auth/me` is unavailable.
- Authenticated rendered QA used browser-level local request fulfilment for `/api/auth/me` only. No application test-only route, production service, database write, cookie edit, or account mutation was added.
- At mobile width, header links keep the existing horizontal scroll behavior. The `Player Hub` link is visible in the first screen.
