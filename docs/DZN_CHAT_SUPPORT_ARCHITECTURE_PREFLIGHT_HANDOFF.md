# DZN Chat Support Architecture Preflight Handoff

## Slice

DZN Chat Support Architecture Preflight designs future DZN Comms, site-wide support chat, global logged-in player chat, private group chat, moderation safety, and public-DZN-info-only AI support bot boundaries before implementation.

This slice is documentation/test only. It does not add runtime chat routes, support bot runtime, Durable Objects/WebSockets, moderation tables, bot prompts, vector stores, AI provider credentials, metered model calls, message storage, support history storage, chat analytics, production service calls, or deployments.

The user-provided references were treated as visual/product direction only. The durable product direction is now written into the architecture preflight document rather than copied as implementation instructions.

## Architecture Found

- The previous public profile social preview validation package slice already added a short chat/support roadmap stub to the master spec and public access policy.
- Existing DZN player surfaces are already split between public pages, free logged-in player pages, owner-gated management pages, and DZN admin/creator pages.
- Existing owner/admin moderation patterns are available through review moderation and community member source-management slices.
- Existing billing safety remains anchored by the canonical Starter/Pro entitlement gates and the live checkout activation checklist.
- No active runtime chat route, support bot route, WebSocket endpoint, Durable Object binding, chat migration, vector store, or AI provider dependency existed at the start of this slice.

## Implementation

- `docs/DZN_CHAT_SUPPORT_ARCHITECTURE_PREFLIGHT.md`
  - Defines the product surfaces: site-wide support chat, logged-in global community chat, private group chat, server-linked group management, and owner/admin moderation.
  - Captures the DZN Comms visual direction: Public Channels, Global Chat, New Players, Server Owners, Events, Private Groups, pinned guidance, DZN Assist, Channel Safety, Online Members, Group Members, and Safety Ladder.
  - Defines the safety ladder: Message blocked, Friendly warning, 10-minute timeout, Staff review.
  - Defines moderation requirements for profanity filtering, spam protection, link protection, invite approval, slow mode, report controls, timed mutes/timeouts, scoped audits, and cross-owner denial.
  - Defines the public-DZN-info-only AI support bot boundary and explicitly blocks private data, raw IDs, tokens, billing secrets, production D1 internals, retained exports, raw award evidence, private moderation notes, and private chat history.
  - Blocks runtime implementation until a later approved slice answers the runtime, storage, moderation, AI provider, retention, source-policy, cost-control, and rollback questions.

- `docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md`
  - Promotes the chat/support roadmap stub into a design-only preflight slice.
  - Links the preflight document.
  - Adds the detailed product, access, moderation, bot, billing/fairness, and implementation-blocker contract.
  - Updates the roadmap so the next safe step is the DZN Comms visual shell and support launcher prototype.

- `docs/PUBLIC_ACCESS_POLICY.md`
  - Records the future access split for public support entry points, logged-in global chat, private group chat, owner/admin management, and moderation.
  - Confirms free players can participate in allowed chat without Starter or Pro.
  - Confirms owner/community management remains owner/admin scoped.
  - Confirms the preflight adds no runtime route, Durable Object/WebSocket, moderation table, bot prompt, vector store, AI provider credential, metered model call, analytics/tracking path, or stored chat/support history.

- `docs/PUBLIC_PROFILE_SOCIAL_PREVIEW_VALIDATION_PACKAGE_HANDOFF.md`
  - Marks this preflight as the follow-on slice.
  - Changes the next recommended slice to the DZN Comms visual shell and support launcher prototype.

- `scripts/test-dzn-chat-support-architecture-preflight.ts`
  - Verifies the architecture preflight document, master spec, public access policy, and previous handoff include the required product/access/moderation/bot/no-runtime contract.
  - Verifies no implementation paths exist for chat/support runtime routes, DZN Assist routes, runtime community chat pages, chat components, support components, or chat/support libraries.
  - Verifies no chat/support migration filename exists.
  - Verifies no AI provider dependency was added.
  - Verifies runtime source files do not contain WebSocket, Durable Object chat, chat table, vector, or AI-provider call patterns.

- `package.json`
  - Adds `test:dzn-chat-support-architecture-preflight`.
  - Wires it into `npm test`.

## Entitlement And Access Matrix

| Surface | Boundary |
| --- | --- |
| Site-wide support launcher | May appear publicly, but public answers only until login |
| DZN Assist support bot | Public DZN/help/pricing/support content only |
| Global community chat | Free logged-in player access, subject to moderation state |
| Private group chat | Logged-in user plus trusted DZN membership bridge |
| Server-linked group management | Owner entitlement plus linked-server ownership, or DZN admin scope |
| Moderation queue | Owner/admin only, cross-owner denial required |

Starter and Pro must not grant chat ranking priority, moderation immunity, scoring advantages, event advantages, XP advantages, badge advantages, or competitive eligibility advantages.

## Protected Surfaces

The preflight explicitly protects:

- Private player data.
- Private owner data.
- Hidden profile sections.
- Raw Discord IDs.
- Discord OAuth tokens.
- Nitrado tokens.
- Billing secrets and Stripe state.
- Production D1 internals.
- Retained export artifacts.
- Raw award evidence.
- Internal moderation notes.
- Private chat history outside the active support session.
- Billing, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars, CTF scoring, XP awards, calling-card awards, and competitive eligibility.

## Production-Mutation Confirmation

This slice does not mutate:

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

- `npm run test:dzn-chat-support-architecture-preflight`
- `npm run test:public-profile-social-preview-validation-package`
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
- Production-mutation scans for migrations, runtime chat routes, Durable Objects/WebSockets, AI provider packages, vector stores, live checkout, Stripe/Nitrado/Discord/Cloudflare/D1 mutations, and issue #49.
- Codex Security diff scan.

## Next Recommended Slice

The DZN Comms visual shell and support launcher prototype is now the approved follow-on slice. It should build the logged-in community/support UI shell from static local mock data, with the DZN Comms layout, channel rail, safety rail, DZN Assist panel, member presence, pinned guidance, and disabled/non-sending composer states. That slice should still avoid message storage, runtime chat APIs, Durable Objects/WebSockets, moderation tables, bot prompts, vector stores, AI provider credentials, metered model calls, live checkout, production services, and issue #49.

Next after that should be the DZN Comms interaction contract and moderation preflight: define the exact client/server contracts for future send attempts, filtering decisions, warning/timeout state, report actions, owner/admin moderation scope, private group membership proofs, support source policy, logging/retention rules, and rollback controls before any runtime chat APIs, message tables, Durable Objects/WebSockets, AI provider credentials, vector stores, or metered model calls are implemented.

The DZN Comms interaction contract and moderation preflight is now the approved follow-on after the visual shell. It must remain documentation/test-only and must keep runtime chat APIs, message tables, Durable Objects/WebSockets, moderation tables, bot prompts, vector stores, AI provider credentials, metered model calls, analytics/tracking, stored support/chat history, live checkout, production services, and issue #49 blocked until a later runtime approval preflight.
