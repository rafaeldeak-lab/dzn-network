# DZN Chat And Support Architecture Preflight

## Scope

This slice is architecture-preflight only.

It records the product, access, moderation, privacy, AI-support, and proof requirements for future DZN chat work before implementation starts.

No runtime chat routes are added. No support bot runtime is added. No Durable Objects/WebSockets are added. No moderation tables are added. No bot prompts are added. No vector stores are added. No AI provider credentials are added. No metered model calls are added.

The user-provided DZN Comms references show the intended direction: a dark DZN-branded command center with public channels, private groups, pinned guidance, online members, DZN Assist, and a visible Safety Ladder. The references are design direction only, not executable requirements.

## Product Surfaces

Future DZN chat should be split into three product surfaces.

### Site-Wide Support Chat

Support entry points may be visible on most pages as a compact DZN Assist launcher.

DZN Assist should present itself as Website support only until a later implementation slice proves a safe, approved support source boundary.

Allowed purpose:

- Setup help.
- Account guidance.
- Owner setup guidance.
- Server linking guidance.
- Event guide navigation.
- Pricing explanation from public pricing copy.
- Public DZN feature questions.

The support launcher can be visible to logged-out visitors, but logged-out answers must stay public and generic. Account-specific help must require login before any private account state is considered.

### Global Community Chat

Global community chat is logged-in player only.

Planned channels:

- Public Channels.
- Global Chat.
- New Players.
- Server Owners.
- Events.

Global chat is for community help and player discussion. It is not a leaderboard, scoring, review, XP, event, billing, or owner-entitlement system.

### Private Group Chat

Private group chat requires a trusted DZN membership bridge.

Allowed future group sources:

- Trusted community member rows.
- Approved event/team membership rows.
- Server-linked staff/moderator membership rows.
- Owner/admin-created groups after server-side authorization.

Private group chat must not infer membership from Discord display names, gamertags, review names, leaderboard names, request-supplied handles, or cosmetic profile labels.

## Access Matrix

| Surface | Visitor | Free logged-in player | Server owner | DZN admin | Billing dependency |
| --- | --- | --- | --- | --- | --- |
| Support launcher | Public entry, public answers only | Public answers plus login prompt for account help | Same, with owner setup guidance after auth | Same | No paid plan required |
| DZN Assist bot | Public DZN/help content only | Public DZN/help content only | Public DZN/help content only | Public DZN/help content only | No paid plan required |
| Global community chat | Must log in before participating | Can participate if not muted/banned | Can participate as player identity | Can participate/moderate | No paid plan required |
| Private group chat | Not visible | Only if trusted membership exists | Only if trusted membership or owner scope exists | Can moderate by admin scope | No paid plan required for player participation |
| Server-linked group management | Not visible | Not visible | Owner entitlement plus linked-server ownership required | Admin scope required | Owner management action only |
| Moderation queue | Not visible | Not visible except own reports/appeals if implemented | Own server/community scope only | Global moderation scope | Owner/admin tooling only |

Normal player chat access must remain free after Discord login. Starter and Pro plans may unlock owner presentation, publishing, analytics, or server-management tools, but they must not give chat ranking priority, moderation immunity, scoring advantages, event advantages, XP advantages, badge advantages, or competitive eligibility advantages.

## DZN Comms Visual Contract

Future UI should feel like DZN Comms, not a generic website chat widget.

Visual direction:

- DZN Comms title and short line such as "Connect. Coordinate. Get support."
- Left rail with Public Channels and Private Groups.
- Center feed with pinned messages, message rows, reply actions, filtered-message notices, and a stable composer.
- Right rail with DZN Assist, Channel Safety, Online Members, or Group Members depending on context.
- Safety Ladder states displayed clearly: Message blocked, Friendly warning, 10-minute timeout, Staff review.
- Support cards for Setup Help, Server Linking, and Event Guides.
- Online status and member roles such as Owner, Mod, VIP, and Member.
- Dark tactical DZN styling with cyan, purple, green, and amber accents, matching the Player Hub/profile visual direction.

The UI must be mobile-first when built: channel list, feed, assistant, safety, and member panels need compact responsive states, keyboard navigation, screen-reader labels, and reduced-motion behavior.

## Moderation And Safety Model

Community chat must include profanity filtering, warning, and timed-mute controls.

Required future moderation layers:

- Profanity filter.
- Spam protection.
- Link protection.
- Invite approval for private groups.
- Rate limits and slow mode for busy public channels.
- Report message action.
- Blocked-message feedback before send where practical.
- Friendly warning after first low-severity violation.
- Timed mute/timeout for repeated violations.
- Staff review for severe or repeated abuse.
- Reversible moderator actions where practical.
- Scoped audit history for moderation actions.

The safety ladder must be explicit:

1. Message blocked.
2. Friendly warning.
3. 10-minute timeout.
4. Staff review.

Moderation must be scoped. A server owner may moderate only chats tied to their authorized server/community scope. DZN admins may have global moderation scope. Cross-owner access must be denied.

## AI Support Bot Boundary

DZN Assist is a future support helper, not an autonomous operator.

The AI support bot must answer only from public DZN website content, setup-help content, pricing content, and public support policy.

The bot must not answer from:

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
- Private chat history outside the active support session.

The bot must not:

- Create checkout sessions.
- Change billing.
- Change owner entitlements.
- Call Nitrado.
- Mutate Discord resources.
- Award XP.
- Award calling cards.
- Change rankings.
- Change discovery score.
- Change reviews or review score.
- Change events, brackets, rosters, or approvals.
- Change Server Wars or CTF scoring.
- Affect competitive eligibility.

No AI provider credential, paid API key, metered model call, vector store, training/eval job, automated spend path, prompt registry, or tool-calling route may be added until a later dedicated implementation approval explicitly defines provider choice, cost controls, data boundaries, source policy, abuse handling, logging, retention, and rollback.

## Future Data Model Direction

No migration is added in this slice.

Future implementation may propose tables only after a dedicated implementation issue/PR:

- `chat_channels`.
- `chat_channel_memberships`.
- `chat_messages`.
- `chat_message_reports`.
- `chat_moderation_actions`.
- `chat_user_mutes`.
- `chat_support_sessions`.
- `chat_support_messages`.
- `chat_support_source_documents`.

Required future database rules:

- Messages must be scoped to channel/group membership.
- Private group membership must resolve through trusted DZN user IDs.
- Message writes must be rate-limited and moderation-filtered before persistence where practical.
- Moderation actions must record actor, scope, action, reason, and reversal state without exposing private identifiers publicly.
- Support sessions must not become analytics or share-history storage.
- Retention and deletion rules must be reviewed before any chat message storage is added.

## Runtime Architecture Questions

These questions must be answered before runtime work starts:

- Whether chat uses Cloudflare Durable Objects, WebSockets, polling, or a staged hybrid.
- How message fanout is bounded under Cloudflare limits.
- How offline delivery, unread counts, and presence expire.
- How public support entry points route logged-out visitors versus logged-in players.
- How the bot retrieves only approved public DZN/help content.
- How abuse filtering runs before write/publish.
- How moderation queues map to owner scope, DZN admin scope, and cross-owner denial.
- How chat retention, deletion, export, and audit rules work.
- How the implementation avoids new metered AI spend unless explicitly approved.
- How rollback disables bot and chat writes without affecting read-only public pages.

## Implementation Blockers

Do not implement any of the following until a later approved implementation slice:

- `/api/chat/*`.
- `/api/support-chat/*`.
- `/api/dzn-assist/*`.
- `/community` runtime page.
- Chat message database migrations.
- Chat moderation database migrations.
- Durable Object bindings.
- WebSocket endpoints.
- R2, KV, Queue, Vectorize, or AI bindings for chat/support.
- Bot prompts or prompt registries.
- AI provider packages or credentials.
- Analytics or tracking for support/chat usage.
- Stored share/support/chat history outside a reviewed retention model.

## Required Proof For Future Runtime Slices

Every future chat/support implementation slice must prove:

- Logged-out visitors cannot participate in global or private chat.
- Free logged-in players can use allowed player chat without a paid owner plan.
- Private group access requires a trusted membership bridge.
- Cross-owner private group and moderation access is denied.
- Profanity/spam/link filtering can block or warn without publishing the rejected message.
- Timeouts/mutes block sending but do not affect player profile, ranking, scoring, XP, calling cards, events, or billing.
- DZN Assist uses only approved public DZN/help/pricing/support content.
- DZN Assist refuses private, billing, token, Nitrado, Discord, profile-hidden, raw-evidence, scoring, and moderation-internal questions.
- No live Stripe checkout activation, issue #49 mutation, Cloudflare secret change, production D1 write, Nitrado mutation, Discord mutation, deployment, or retained export change is required.

## Next Recommended Slice

Next should be a DZN Comms visual shell and support launcher prototype: build the logged-in community/support UI shell from static local mock data, with the DZN Comms layout, channel rail, safety rail, DZN Assist panel, and disabled/non-sending composer states. That slice should still avoid message storage, runtime chat APIs, Durable Objects/WebSockets, moderation tables, bot prompts, vector stores, AI provider credentials, metered model calls, live checkout, production services, and issue #49.
