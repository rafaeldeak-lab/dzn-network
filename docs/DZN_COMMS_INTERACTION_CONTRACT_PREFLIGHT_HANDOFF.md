# DZN Comms Interaction Contract And Moderation Preflight Handoff

## Slice

DZN Comms Interaction Contract And Moderation Preflight defines the exact contracts future runtime chat/support work must satisfy.

This slice is documentation/test only. It does not add runtime chat APIs, message tables, chat message database migrations, Durable Objects/WebSockets, moderation tables, bot prompts, vector stores, AI provider credentials, metered model calls, analytics/tracking, message persistence, support history persistence, retained exports, production service calls, deployments, or issue #49 changes.

## Architecture Found

- The DZN Chat And Support Architecture Preflight already defined the high-level product, access, moderation, AI-support, and no-runtime boundaries.
- The DZN Comms Visual Shell Prototype added the static `/community` visual route and static DZN Assist launcher using local mock data and disabled/non-sending composer controls.
- Existing DZN access design separates public pages, free logged-in player surfaces, owner-entitled management surfaces, and DZN admin surfaces.
- Existing owner/admin patterns already require canonical owner entitlement plus linked-server ownership for server-management actions.
- Existing guard tests already block chat/support runtime routes, chat/support migrations, provider dependencies, vector/model-call patterns, WebSockets/Durable Objects, live checkout activation, and production mutations.

## Implementation

- `docs/DZN_COMMS_INTERACTION_CONTRACT_PREFLIGHT.md`
  - Defines future surface contracts for site-wide support, Global Chat, New Players, Server Owners, Events, private group chat, server-linked group management, and moderation queues.
  - Captures the exact named sections: Send Attempt Contract, Filtering Decision Contract, Warning And Timeout State Contract, Read-Only History Contract, Report Action Contract, Owner/Admin Moderation Scope Contract, Private Group Membership Proof Contract, Support Source Policy, Logging And Retention Contract, and Rollback Controls.
  - Defines send attempt request/response behavior with `clientMutationId`, server-side channel resolution, membership checks, rate limits, safety filtering, persistence after acceptance only, and safe blocked/warning/timeout responses.
  - Defines filtering decision inputs/outputs for allow, allow-with-notice, block, warn, timeout, and escalate.
  - Defines the Safety Ladder: Message blocked, Friendly warning, 10-minute timeout, Staff review.
  - Defines read-only history redaction, no-store caching, cookie variation, cursor pagination, and private-identifier protection.
  - Defines report action, owner/admin moderation scope, cross-owner denial, private group membership proof, DZN Assist public-source policy, logging/retention, feature-flag rollback, and first-runtime proof requirements.

- `docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md`
  - Adds the interaction contract preflight as the next DZN Comms planning section.
  - Updates the roadmap so the visual shell is delivered and runtime implementation remains blocked until a runtime approval preflight chooses transport, migrations, flags, retention, moderation model, tests, and rollback.

- `docs/PUBLIC_ACCESS_POLICY.md`
  - Records the player/owner/admin access and isolation rules for future DZN Comms interaction contracts.
  - Keeps global player chat free after Discord login, private groups behind trusted user bridge membership, and owner moderation behind entitlement plus linked-server ownership.

- `docs/DZN_CHAT_SUPPORT_ARCHITECTURE_PREFLIGHT.md`
  - Marks the interaction contract preflight as the current follow-on after the visual shell.
  - Keeps runtime chat APIs, message tables, Durable Objects/WebSockets, provider credentials, vector stores, and metered model calls blocked.

- `docs/DZN_COMMS_VISUAL_SHELL_HANDOFF.md`
  - Records this contract preflight as the next follow-on after the visual prototype.

- `scripts/test-dzn-comms-interaction-contract-preflight.ts`
  - Verifies the contract document, master spec, public policy, and handoffs include the required send/filter/warning/timeout/history/report/moderation/private-group/support-source/logging/retention/rollback contracts.
  - Verifies no runtime chat/support API paths, chat backend libraries, chat/support migrations, AI provider dependencies, WebSockets/Durable Objects, vector/model-call patterns, storage/tracking paths, live checkout activation, production mutation commands, or issue #49 changes are introduced.

- `package.json`
  - Adds `test:dzn-comms-interaction-contract-preflight`.
  - Wires it into `npm test` after the visual shell guard.

## Entitlement And Access Matrix

| Surface | Boundary |
| --- | --- |
| Site-wide DZN Assist launcher | Public generic help only until login; no paid plan requirement |
| Global/New Players/Server Owners/Events chat | Free logged-in player access, subject to safety state |
| Private group chat | Logged-in user plus trusted DZN user ID bridge membership |
| Server-linked group management | Owner entitlement plus linked-server ownership, or DZN admin scope |
| Owner/community moderation | Owner entitlement plus linked-server ownership for owned scopes |
| DZN global moderation | DZN admin/global moderator scope |
| DZN Assist bot runtime | Blocked until public-source/cost/provider/retention/rollback approval exists |

Starter and Pro must not grant chat priority, moderation immunity, safety bypasses, scoring advantages, event advantages, XP advantages, calling-card advantages, badge advantages, Server Wars advantages, CTF advantages, ranking boosts, discovery boosts, review boosts, or competitive eligibility advantages.

## Protected Surfaces

The interaction contract preflight protects:

- Private player data.
- Private owner data.
- Hidden profile sections.
- Raw Discord IDs.
- Discord OAuth tokens.
- Nitrado tokens.
- Billing secrets.
- Stripe state.
- Production D1 internals.
- Retained export artifacts.
- Raw award evidence.
- Internal moderation notes.
- Private chat history outside an approved active support session model.
- Owner-only dashboard payloads.
- Non-public admin notes.
- Public rejected-message logs.
- Analytics/tracking paths.
- Bot training data collection.

Future DZN Comms interaction work must not affect billing, owner entitlements, server ownership, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars, CTF scoring, XP awards, calling-card awards, public profile visibility, retained exports, or competitive eligibility.

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
- Analytics/tracking systems.
- Deployments.
- Issue #49.

Live checkout remains disabled. Issue #49 remains reserved for final live payment activation.

## Validation Targets

- `npm run test:dzn-comms-interaction-contract-preflight`
- `npm run test:dzn-comms-visual-shell`
- `npm run test:dzn-chat-support-architecture-preflight`
- `npm run test:nav-access-visibility`
- `npm run test:player-owner-access-foundation`
- `npm run test:player-hub-foundation`
- `npm run test:community-member-source-management-audit`
- `npm run test:reviews-moderation-dashboard`
- `npm run test:reviews-moderation-workflow-polish`
- `npm run test:billing-plans`
- `npm run test:stripe-live-readiness`
- `npm run test:stripe-live-activation-checklist`
- `npm run check:billing-config`
- `npx tsc --noEmit --incremental false`
- `npm run lint`
- `npm run build`
- `npm test`
- `git diff --check`
- Production-mutation scans for runtime chat routes, message tables, migrations, Durable Objects/WebSockets, provider packages, vector stores, analytics/tracking, live checkout, Stripe/Nitrado/Discord/Cloudflare/D1 mutations, package-lock changes, media changes, and issue #49.
- Codex Security diff scan.

## Next Recommended Slice

Next should be the DZN Comms runtime implementation approval preflight: choose the first runtime slice shape, transport plan, migration plan, feature-flag defaults, retention defaults, moderation data model, testing matrix, and rollback path before implementing any chat APIs, message tables, Durable Objects/WebSockets, AI provider credentials, vector stores, or metered model calls.

That runtime implementation approval preflight is now the approved follow-on slice. It should add the public live website counter to the plan as a public-safe aggregate presence feature, choose the first runtime direction, keep this branch documentation/test-only, and move the next implementation slice to the DZN Comms live presence counter foundation.
