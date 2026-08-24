# DZN Public Access Policy

This policy separates public entry points from authenticated product pages. It is intentionally conservative: hidden navigation is not enough; direct URLs must match the same access model.

## Logged-Out Visitors

Logged-out visitors may access:

- `/`
- `/#features`
- `/#pricing`
- `/pricing`
- `/login`
- `/signup`
- the public Discord invite link

Logged-out navigation must only expose the public funnel: homepage/features, pricing, Login/Signup, and Discord. It must not show dashboard, server browser, leaderboards, stats, events, owner tools, or add-server controls before a session is known.

Logged-out visitors are redirected to `/login?returnTo=...` before app-page rendering for:

- `/dashboard`
- `/dzn-pulse`
- `/events`
- `/leaderboards`
- `/seasons`
- `/servers`
- `/setup`
- `/test`

Nested routes under those paths follow the same rule. Examples include `/events/suggest`, `/events/server-wars`, `/servers/profile?slug=...`, `/servers/[slug]`, `/dashboard/events`, and `/setup/...`.

## Logged-In Visitors

Logged-in visitors may open the authenticated app pages above. Page visibility inside those pages still depends on the existing server ownership, role, and package checks.

Starter trial and Pro behavior must continue to come from the billing/entitlement helpers and API responses. A page redirect must not replace owner authorization, plan enforcement, Stripe webhook checks, Nitrado ownership checks, or protected API 401/403 behavior.

Free or Starter/trial accounts should see trial-safe app navigation plus a clear Pro upgrade action. Pro-effective accounts should see Pro tools in the header. This header visibility is product guidance only; APIs and owner/product pages must continue enforcing access server-side.

Dashboard package visibility must follow the same split. Starter/trial users may see the normal setup, public listing, basic stats, events, billing comparison, and basic Discord posting surfaces, but any Pro-only analytics, promotion, Server VS Server hosting, or enhanced Discord post controls must read as locked or upgrade-gated. Pro-effective users may see those tools as active, while server-side entitlement checks remain authoritative.

Package copy must not imply a competitive advantage. Pro presentation, promotion, analytics, and owner tooling must not change leaderboard rank, K/D, score, reviews, crowns, badges, season wins, event outcomes, or gameplay results.

## Owner Pages

`/owner` and nested owner pages remain stricter than normal logged-in pages. They must continue to require platform-owner or platform-creator authorization through the owner page functions.

## Public APIs

The homepage and public preview surfaces still need public read-only JSON. These APIs remain callable without a session unless a later high-risk access redesign explicitly changes them:

- `/api/public/servers`
- `/api/public/home-stats`
- `/api/public/server-rail`
- `/api/public/leaderboards`
- `/api/public/leaderboards/advanced`
- `/api/public/server-wars`
- `/api/events`
- `/api/events/suggestions?sort=newest&limit=5`
- `/api/dzn-pulse/config`

These APIs must keep their existing preview redaction and `Vary: Cookie` behavior where applicable. Public API availability does not mean the corresponding app page is public.

## Production Verification

Post-merge verification should expect:

- `/` returns `200`.
- `/pricing` returns `200` and opens the homepage pricing comparison.
- Logged-out direct app pages such as `/events`, `/leaderboards`, `/servers`, `/dashboard`, `/setup`, `/dzn-pulse`, and `/seasons` return a login redirect.
- Logged-out header/navigation does not expose app/product controls, while authenticated headers show package-appropriate Starter/Pro actions.
- The dashboard sidebar shows package-aware guidance: trial-safe tools, Pro locks/upgrade prompts, or active Pro tools based on the authenticated account summary.
- Public APIs above return `200` and no unexpected 5xx.
- Owner/protected APIs such as `/api/owner/events`, `/api/billing/status`, and `/api/nitrado/services` remain `401` without authentication.
- No production D1, Stripe, Nitrado, Discord, or secrets mutation is required for this policy.
