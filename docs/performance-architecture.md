# DZN Performance Architecture

## Current Baseline

- Runtime model: Next.js static export (`output: "export"`) deployed to Cloudflare Pages with Pages Functions for `/api/*`, `/owner`, and other dynamic routes.
- Image model: `next/image` optimization is disabled for Cloudflare static compatibility. Image performance relies on explicit dimensions, responsive sizing, lazy loading, and safe fallbacks.
- Public traffic model: public pages are static or client-hydrated from Pages Functions. Public APIs read stored D1 state and must not trigger ADM, Nitrado, scheduler, Discord, or tournament automation work.
- Private traffic model: owner and authenticated APIs use session cookies and must always return `Cache-Control: private, no-store`.
- Current hot public reads:
  - `/api/public/home-stats`
  - `/api/public/servers`
  - `/api/public/server-rail`
  - `/api/public/leaderboards`
  - `/api/events`
  - `/api/events/suggestions`
  - `/api/dzn-pulse/config`
- Known structural risks before Phase 2A:
  - several public reads used endpoint-local cache header logic instead of a shared Cloudflare cache guard;
  - suggestion data did not have a persisted model, bounded list query, or moderation/vote indexes;
  - public loading states were inconsistent and sometimes fell back to broad loading panels;
  - route transitions had no global feedback on slower navigation;
  - future tournament work did not yet have a written separation between public reads and heavy automation.

## Implemented Phase 2A Fixes

- Added a reusable public GET edge-cache helper for Cloudflare Pages Functions.
- Added no-store helpers for private/authenticated responses.
- Added safe request IDs, D1 timing measurement, `Server-Timing`, `X-DZN-Cache`, and safe slow-request warnings.
- Added bounded public suggestion listing with a default page size of 20 and hard cap of 100.
- Added event suggestion tables, counters, moderation rows, reports, votes, and indexes through additive migration `0057`.
- Added creator-only moderation and conversion APIs for suggestions.
- Added site-wide delayed navigation progress feedback.
- Added route-specific skeleton loading states for events, suggestions, servers, leaderboards, DZN Pulse, owner, and Event Control.
- Added public suggestion board sections for Trending, New, Shortlisted, Accepted, and Converted into Events.
- Added Owner Event Control suggestion moderation summaries and creator-only action controls.

## Cache Rules

Public cache helper rules:

- cache only `GET` and `HEAD`;
- bypass when `Authorization` is present;
- bypass when session cookies are present;
- bypass if the response contains `Set-Cookie`;
- bypass non-2xx or error responses with no-store headers;
- allowlist cache-key query parameters per route;
- add bounded `max-age` and `stale-while-revalidate`;
- expose only safe cache status through `X-DZN-Cache`;
- never include raw identities, cookies, tokens, or session values in keys or headers.

Suggested TTLs:

- server rail and volatile status: 10 to 30 seconds;
- home/server summaries: 15 to 30 seconds;
- public leaderboards: 30 to 60 seconds;
- public suggestions: 10 to 20 seconds;
- public configuration: longer when the payload has no user-specific values.

Private no-store matrix:

- owner APIs: private, no-store;
- authenticated suggestion submit/vote/report APIs: private, no-store;
- creator moderation and conversion APIs: private, no-store;
- Discord/OAuth/session APIs: private, no-store;
- billing/subscription APIs: private, no-store.

## D1 Query Model

Rules for hot public endpoints:

- no unbounded list endpoints;
- no `SELECT *` on hot public routes;
- return public-safe projections only;
- use stable ordering with time and ID tie-breakers;
- prefer cursor pagination over large offsets;
- add indexes only for demonstrated query paths;
- avoid request-time schema mutation in public read paths.

Suggestion indexes added in migration `0057` support:

- moderation/public status by created time;
- public status by hot score and created time;
- public status by created time;
- submitted user by created time;
- duplicate fingerprint lookup;
- votes by suggestion and by user;
- reports by suggestion/status;
- moderation actions by suggestion/time.

## High-Traffic Request Rule

No public request may call Nitrado, download ADM logs, refresh metadata, dispatch Discord, rebuild standings, update player counts, execute scheduler logic, score tournaments, issue rewards, create snapshots, or perform event automation. Public reads must use stored state, cached responses, or stored snapshots. Heavy work belongs in Cloudflare scheduled Workers, Queues, explicit creator actions, idempotent jobs, task locks, retries, dead-letter state, and immutable audit logs.

## Resilience

Public APIs should prefer:

1. fresh cached response;
2. recent stored snapshot;
3. stale but safe snapshot with freshness metadata;
4. structured safe error response.

They should avoid repeated expensive recalculation, upstream requests, resource-limit failures, and stack traces in public responses.

Safe observability fields:

- request ID;
- route name;
- duration;
- cache status;
- D1 query duration;
- result count;
- fallback used;
- stale age;
- error category.

Never log raw Discord IDs, cookies, session values, authorization headers, tokens, bot tokens, OAuth secrets, raw Cloudflare IDs, raw IP addresses, or private moderation content.

## Target Budgets

Core Web Vitals targets:

- mobile p75 LCP: <= 2.5 seconds;
- mobile p75 INP: <= 200 milliseconds;
- CLS: <= 0.1.

Network targets:

- cached public API TTFB: <= 300 ms;
- uncached public API preview p95: <= 800 ms where practical;
- default public list size: about 20;
- hard public list max: about 100;
- no authenticated or private response is publicly cached.

Front-end targets:

- no visible loading flash for navigations under about 120 ms;
- no blank-page loading state;
- no major layout jump when data arrives;
- preserve useful stale content while refreshing;
- reduced-motion support.

## Remaining Risks

- Public event detail pages are statically generated from a limited route list, so newly converted draft event pages should be preview-tested before public links are surfaced.
- Some legacy public APIs still need individual query-plan review before they can claim p95 latency improvements.
- The Cloudflare cache helper is structural proof of caching behavior; production latency budgets require preview and production measurements before claims.
- Future scoring, bracket generation, announcements, and rewards must stay out of public request paths.

## Future Recommendations

- Move expensive aggregation to scheduled Workers or Queues with idempotency keys.
- Maintain stored public snapshots for high-traffic home stats, leaderboards, and event standings.
- Add sampled request logging for slow public APIs only after redaction review.
- Add bundle-budget reporting to CI once a stable production bundle baseline is recorded.
