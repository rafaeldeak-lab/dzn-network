# DZN Comms Visual Shell Prototype Handoff

## Slice

DZN Comms Visual Shell Prototype builds the first static visual experience for the future DZN chat/support system.

This is a UI prototype only. It uses static local mock data and disabled/non-sending composer controls. It does not add runtime chat APIs, support bot APIs, Durable Objects/WebSockets, message persistence, moderation tables, bot prompts, vector stores, AI provider credentials, metered model calls, analytics/tracking, production service calls, deployments, or issue #49 changes.

The user-provided DZN Comms references were used as visual direction for the command-center layout, left channel rail, central message feed, private group preview, DZN Assist panel, member presence rail, safety controls, and Safety Ladder.

## Architecture Found

- The chat/support architecture preflight already defines the product, access, moderation, privacy, AI-support, and proof boundaries.
- Existing DZN authenticated navigation supports free player surfaces such as Player Hub, servers, leaderboards, and events.
- Existing DZN styling already includes dark tactical panels, cyan/violet/amber accents, slow background motion, reduced-motion fallbacks, and public-player profile polish.
- No runtime chat API, support bot API, Durable Object/WebSocket binding, chat migration, vector store, AI provider dependency, or chat persistence existed before this slice.

## Implementation

- `app/community/page.tsx`
  - Adds the `/community` route for the static DZN Comms visual shell.
  - Renders only `DznCommsVisualShell`.
  - Does not call APIs, fetch session data, gate billing, send messages, or mutate state outside client display state.

- `components/community/dzn-comms-visual-shell.tsx`
  - Adds the DZN Comms page shell using static local mock data.
  - Provides public channel previews for Global Chat, New Players, Server Owners, Events, and DZN Assist.
  - Provides a private Pandora Squad preview with invite-only styling and trusted-membership copy.
  - Provides a center message feed with pinned guidance, message rows, filtered-message notice, static warning preview, and disabled/non-sending composer.
  - Provides a right rail with DZN Assist, Channel Safety/Group Safety, Online Members/Group Members, and the Safety Ladder.
  - Uses local React state only for switching visible mock surfaces.

- `components/community/dzn-support-launcher.tsx`
  - Adds a site-wide static DZN Assist launcher prototype from the root layout.
  - Opens and closes with local component state only.
  - Shows Website support only boundaries and disabled support actions/input.
  - Links to login and `/community`, but performs no support request, no bot call, no storage, no analytics, and no tracking.

- `components/site-header.tsx`
  - Adds Community as a free authenticated player navigation target.
  - Keeps logged-out normal navigation focused on public funnel items.
  - Adds `/community` active-route handling.

- `app/layout.tsx`
  - Mounts the static support launcher near the app root so it can appear across most non-hidden pages.

- `app/globals.css`
  - Adds DZN Comms background image and fog layer animation classes with reduced-motion fallback.
  - Reuses existing DZN pricing media assets; no new media files are added.

- `scripts/test-dzn-comms-visual-shell.ts`
  - Verifies the static route, shell, support launcher, header, layout, docs, and package script.
  - Verifies no chat/support backend paths, migrations, provider dependencies, WebSockets, storage, tracking, checkout, D1 writes, Nitrado, Discord bot token, vector, or AI model-call patterns are introduced.

- `scripts/test-dzn-chat-support-architecture-preflight.ts`
  - Advances the previous preflight guard so it no longer forbids the now-approved static `/community` visual prototype.
  - Keeps backend chat/support routes, chat/support libraries, migrations, provider dependencies, Durable Object/WebSocket patterns, vector/model-call patterns, and chat-table patterns blocked.

- `package.json`
  - Adds `test:dzn-comms-visual-shell`.
  - Wires the focused test into `npm test` immediately after the chat/support preflight test.

## Entitlement And Access Matrix

| Surface | Prototype behavior |
| --- | --- |
| `/community` DZN Comms shell | Static local mock-data visual page; no backend participation or message sending |
| Global Chat preview | Shows free logged-in player direction visually; no live access check or message write in this slice |
| New Players preview | Shows player-help channel direction; no persistence or account lookup |
| Server Owners preview | Shows setup guidance and owner plan link; no entitlement read/write and no checkout call |
| Events preview | Shows coordination direction; no event, bracket, roster, approval, or scoring mutation |
| Private Groups preview | Shows trusted-membership direction; no membership persistence or private data lookup |
| DZN Assist panel and launcher | Website support only static preview; no AI runtime, prompt, provider dependency, model call, vector store, tracking, or stored support history |

Starter and Pro do not grant chat priority, moderation immunity, scoring advantages, event advantages, XP advantages, badge advantages, Server Wars advantages, CTF advantages, or competitive eligibility advantages.

## Protected Surfaces

The visual shell is presentation-only and must not affect:

- Billing.
- Owner entitlements.
- Live checkout.
- Issue #49.
- Stripe products or prices.
- Cloudflare secrets.
- Production D1.
- Nitrado.
- Discord resources.
- Rankings.
- Discovery score.
- Reviews or review score.
- Badges.
- Seasons.
- Events, brackets, rosters, or approvals.
- Server Wars scoring.
- CTF scoring.
- XP awards.
- Calling-card awards.
- Competitive eligibility.
- Public profile visibility.
- Retained exports.

The visual shell cannot affect billing, scoring, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars, CTF scoring, XP awards, calling-card awards, or competitive eligibility.

## Production-Mutation Confirmation

This slice must not mutate:

- Live Stripe products or prices.
- Live checkout configuration.
- Cloudflare secrets.
- Production D1.
- Nitrado.
- Discord.
- Retained exports.
- Migrations.
- Runtime chat services.
- AI provider credentials.
- Vector stores.
- Metered model calls.
- Deployments.
- Issue #49.

Live checkout remains disabled. Issue #49 remains reserved for final live payment activation.

## Validation Targets

- `npm run test:dzn-comms-visual-shell`
- `npm run test:dzn-chat-support-architecture-preflight`
- `npm run test:nav-access-visibility`
- `npm run test:pricing-visual-upgrade`
- `npm run test:player-owner-access-foundation`
- `npm run test:player-hub-foundation`
- `npm run test:community-member-source-management-audit`
- `npm run test:billing-plans`
- `npm run test:stripe-live-readiness`
- `npm run test:stripe-live-activation-checklist`
- `npm run check:billing-config`
- `npx tsc --noEmit --incremental false`
- `npm run lint`
- `npm run build`
- `npm test`
- `git diff --check`
- Production-mutation scans for API routes, migrations, Durable Objects/WebSockets, provider packages, vector stores, analytics/tracking, live checkout, Stripe/Nitrado/Discord/Cloudflare/D1 mutations, package-lock changes, media changes, and issue #49.
- Rendered visual QA for desktop, mid-width, mobile, reduced-motion, disabled composer state, static DZN Assist launcher, and console/network safety.
- Codex Security diff scan.

## Next Recommended Slice

Next should be the DZN Comms interaction contract and moderation preflight: define the exact client/server contracts for future send attempts, filtering decisions, warning/timeout state, read-only history, report actions, owner/admin moderation scope, private group membership proofs, support source policy, logging/retention rules, and rollback controls before any chat APIs, message tables, Durable Objects/WebSockets, AI provider credentials, vector stores, or metered model calls are implemented.
