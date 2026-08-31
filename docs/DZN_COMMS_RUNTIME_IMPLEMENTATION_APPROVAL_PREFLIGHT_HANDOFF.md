# DZN Comms Runtime Implementation Approval Preflight Handoff

## Slice

DZN Comms Runtime Implementation Approval Preflight chooses the first future runtime shape and adds the requested public live website counter to the DZN Comms plan.

This slice is documentation/test only. It does not add chat APIs, support chat APIs, presence APIs, live visitor counter APIs, message tables, presence tables, database migrations, Durable Objects/WebSockets, moderation tables, AI provider credentials, vector stores, metered model calls, analytics/tracking, message persistence, support history persistence, retained exports, production service calls, deployments, or issue #49 changes.

## Architecture Found

- The DZN Chat And Support Architecture Preflight defined the high-level DZN Comms, support chat, global chat, private groups, safety, and AI support boundaries.
- The DZN Comms Visual Shell Prototype added the static `/community` visual route, mock online/member counts, and static DZN Assist launcher using local mock data and disabled/non-sending controls.
- The DZN Comms Interaction Contract And Moderation Preflight defined future send, filtering, warning, timeout, history, report, moderation, private group, support-source, retention, and rollback contracts.
- Existing public/player/owner/admin rules separate public surfaces, free logged-in player surfaces, owner-entitled management surfaces, and DZN admin surfaces.
- Existing guard tests already block chat/support runtime routes, chat/support migrations, provider dependencies, vector/model-call patterns, WebSockets/Durable Objects, live checkout activation, analytics/tracking, and production mutations.

## Implementation

- `docs/DZN_COMMS_RUNTIME_IMPLEMENTATION_APPROVAL_PREFLIGHT.md`
  - Selects the first future runtime slice as the DZN Comms live presence counter foundation.
  - Adds the requested public live website counter as a public-safe aggregate presence feature and "DZN online" presence indicator.
  - Prefers `/community` or the Global Chat shell as the first placement, with later site-header/major-page placement after proof.
  - Defines the future presence counter response shape, short TTL requirement, public fallback behavior, and strict no-identifying-output rules.
  - Defines transport sequencing, migration choices, feature-flag defaults, retention defaults, moderation separation, support-bot runtime blocking, testing matrix, rollback path, and the approval checklist for the first runtime PR.

- `docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md`
  - Adds the runtime implementation approval preflight as the next DZN Comms planning section.
  - Records the public live website counter as a planned aggregate presence feature, not analytics.
  - Updates the roadmap so the next recommended slice is the live presence counter foundation.

- `docs/PUBLIC_ACCESS_POLICY.md`
  - Records that the runtime approval preflight may define a future public online counter and DZN Comms feature flags.
  - Keeps this slice blocked from runtime APIs, persistence, migrations, WebSockets/Durable Objects, AI provider credentials, metered calls, analytics/tracking, live checkout, and production mutation.

- `docs/DZN_COMMS_INTERACTION_CONTRACT_PREFLIGHT.md`
  - Advances its next recommended slice from runtime approval preflight to the live presence counter foundation.
  - Keeps the first runtime proof expectations intact.

- `docs/DZN_COMMS_INTERACTION_CONTRACT_PREFLIGHT_HANDOFF.md`
  - Records this runtime approval preflight as the approved follow-on.

- `scripts/test-dzn-comms-runtime-approval-preflight.ts`
  - Verifies the new preflight, handoff, master spec, public policy, and prior interaction contract docs include the runtime approval, live counter, transport, migration, flags, retention, testing, rollback, and next-slice contract.
  - Verifies this slice does not add runtime chat/support/presence API paths, chat/presence migrations, AI provider dependencies, Durable Objects/WebSockets, vector/model-call patterns, analytics/tracking, live checkout activation, package-lock changes, media changes, or production mutation wiring.

- `package.json`
  - Adds `test:dzn-comms-runtime-approval-preflight`.
  - Wires it into `npm test` after the interaction contract preflight guard.

## Access And Entitlement Matrix

| Surface | Boundary |
| --- | --- |
| Public aggregate DZN online counter | Public aggregate read when enabled; no identifying output |
| Presence heartbeat/write | Future feature-flagged runtime only; short-lived presence state |
| `/community` counter placement | First preferred placement because it is already the DZN Comms shell |
| Major page/header counter placement | Later polish after privacy and fallback proof |
| Global/New Players/Server Owners/Events chat | Still future only; free logged-in player participation after runtime approval |
| Private group chat | Still future only; trusted DZN user ID bridge membership required |
| Owner/community moderation | Still future only; owner entitlement plus linked-server ownership |
| DZN Assist AI runtime | Still blocked until separate support-bot approval |

Starter and Pro must not change the counter result, grant chat priority, grant moderation immunity, bypass safety, alter online visibility, or affect scoring, rankings, discovery, reviews, badges, seasons, events, Server Wars, CTF, XP, calling-card awards, public profile visibility, retained exports, owner decisions, or competitive eligibility.

## Protected Surfaces

The live counter plan protects:

- Private player data.
- Private owner data.
- Hidden profile sections.
- Raw Discord IDs.
- Discord OAuth tokens.
- Nitrado tokens.
- Billing secrets.
- Stripe state.
- Production D1 internals.
- Raw DZN user IDs.
- Profile handles.
- IP addresses.
- User agents.
- Referrers.
- Route history.
- Cross-page browsing history.
- Retained export artifacts.
- Raw award evidence.
- Internal moderation notes.
- Message bodies.
- Support transcripts.
- Analytics/tracking paths.

The public counter must remain aggregate, short-lived, presentation-only, and unable to affect billing, owner entitlement, server ownership, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars, CTF scoring, XP awards, calling-card awards, public profile visibility, retained exports, moderation decisions, or competitive eligibility.

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
- Runtime presence services.
- AI provider credentials.
- Vector stores.
- Metered model calls.
- Analytics/tracking systems.
- Deployments.
- Issue #49.

Live checkout remains disabled. Issue #49 remains reserved for final live payment activation.

## Validation Targets

- `npm run test:dzn-comms-runtime-approval-preflight`
- `npm run test:dzn-comms-interaction-contract-preflight`
- `npm run test:dzn-comms-visual-shell`
- `npm run test:dzn-chat-support-architecture-preflight`
- `npm run test:nav-access-visibility`
- `npm run test:player-owner-access-foundation`
- `npm run test:player-hub-foundation`
- `npm run test:billing-plans`
- `npm run test:stripe-live-readiness`
- `npm run test:stripe-live-activation-checklist`
- `npm run check:billing-config`
- `npx tsc --noEmit --incremental false`
- `npm run lint`
- `npm run build`
- `npm test`
- `git diff --check`
- Production-mutation scans for runtime chat routes, presence routes, message tables, presence tables, migrations, Durable Objects/WebSockets, provider packages, vector stores, analytics/tracking, live checkout, Stripe/Nitrado/Discord/Cloudflare/D1 mutations, package-lock changes, media changes, and issue #49.
- Codex Security diff scan.

## Next Recommended Slice

Next should be the DZN Comms live presence counter foundation: implement the first public-safe aggregate online counter behind disabled-by-default read/write flags, starting on `/community` or the Global Chat shell with a static fallback, short TTL, no identifying public output, no analytics/tracking, no chat message sending, no message persistence, no moderation tables, no Durable Objects/WebSockets unless separately approved in that slice, no AI provider credentials, no vector stores, no metered model calls, no live checkout, no production mutations, and no effect on billing, owner entitlement, server ownership, rankings, discovery, reviews, badges, seasons, events, Server Wars, CTF scoring, XP awards, calling-card awards, public profile visibility, retained exports, moderation decisions, or competitive eligibility.

After the presence counter foundation, message-adjacent reactions should follow the dedicated DZN Comms reaction interaction contract preflight in `docs/DZN_COMMS_REACTION_INTERACTION_CONTRACT_PREFLIGHT.md` and then a separate runtime reaction implementation approval slice before any reaction API, message table, reaction table, Durable Object, WebSocket, persistence, analytics/tracking, AI provider, vector store, metered model call, production mutation, live checkout, or issue #49 change.
