# Public Community Directory Discovery Polish

Date: 2026-08-26

Branch: `codex/public-community-directory-discovery-polish-20260826`

Base branch: `codex/community-member-directory-player-hub-polish-20260826`

Base commit: `e9f9462 Polish community member directory surfacing`

## Purpose

This slice improves the public-facing community member directory as a discovery surface without changing the directory's data boundary.

It keeps `/servers/[slug]/community` public-safe, read-only, and limited to already-visible opted-in members returned by the canonical public community member directory API.

## Implementation

The slice adds public UI polish only:

- richer public sort controls for featured order, name, role label, and newest public month;
- grouping controls for role groups, joined month, or no grouping;
- safe context cards that summarize visible profile count, role-group count, newest public month, and the no-influence guarantee;
- stronger member cards showing public role group, opt-in public state, and the generated public handle;
- explicit copy that sorting, grouping, and context use already-visible public rows only;
- `discovery_polish_presentation_only` and `sorts_and_groups_public_rows_only` safeguards on `publicCommunityMemberDirectorySafeguards()`;
- `test:public-community-directory-discovery-polish` as a focused regression check.

No API route, database migration, retained export model, owner import workflow, billing behavior, checkout path, or external-service call is added by this slice.

## Access And Visibility

| Surface | Visitor | Free Discord player | Owner/admin | Notes |
| --- | --- | --- | --- | --- |
| `/servers/[slug]/community` | Allowed | Allowed | Allowed | Public-safe read-only directory page |
| `GET /api/public/servers/[serverId]/community-members` | Allowed | Allowed | Allowed | Existing read-only public payload |
| Sorting and grouping controls | Allowed | Allowed | Allowed | Client-side only over already-visible public rows |
| Safe context cards | Allowed | Allowed | Allowed | Derived from visible public rows only |
| Owner/admin source import controls | Denied | Owner plan required | Existing owner/admin gates | Unchanged |
| Retained export storage | Blocked | Blocked | Blocked | Still requires separate approval before implementation |

## Safe Data Boundary

The public directory continues to expose only rows that already satisfy the existing rules:

- `community_members.public_member_enabled = 1`
- `community_members.source = 'trusted_dzn_bridge'`
- a trusted `community_members.community_guild_id` plus `community_members.user_id` bridge to `users.id`
- the player has opted into a generated public profile handle through profile privacy settings

The new discovery controls sort and group already-visible public rows only. They must not query, search, infer, or expose:

- hidden players;
- raw Discord IDs;
- raw DZN user IDs;
- raw linked-server IDs;
- raw community guild IDs;
- OAuth tokens;
- Nitrado tokens;
- Stripe state or secrets;
- source candidate rows;
- owner/admin import rows;
- raw award evidence;
- scoring, approval, owner workflow, or billing state.

## Isolation Guarantees

This slice is presentation-only. It must not affect:

- public profile visibility without the player's opt-in generated handle;
- CTF scoring rows;
- owner workflow decisions;
- approval decisions;
- bracket outcomes;
- billing or owner entitlement;
- rankings or discovery score;
- reviews or review score;
- badges;
- seasons;
- events;
- Server Wars scoring;
- XP awards;
- calling-card awards;
- competitive eligibility.

## Explicitly Out Of Scope

These remain blocked unless a separate approved slice deliberately opens them:

- retained export files;
- export-history rows;
- export sharing links;
- storage bindings;
- retention write APIs;
- retained-export migrations;
- owner/admin import workflow changes;
- community member source-management writes;
- live checkout activation;
- Stripe product or price changes;
- Cloudflare secret changes;
- production D1 writes;
- Nitrado calls;
- Discord mutations;
- issue #49 merge.

Live checkout remains disabled, and Issue #49 remains reserved for final live payment activation.

## Validation Plan

Run at minimum:

- `npm run test:public-community-directory-discovery-polish`
- `npm run test:community-member-directory-player-hub-polish`
- `npm run test:public-community-member-directory-foundation`
- `npm run test:community-member-source-management-audit`
- `npm run test:player-owner-access-foundation`
- `npm run test:public-access-gating`
- `npm run test:billing-plans`
- `npm run test:stripe-live-readiness`
- `npm run test:stripe-live-activation-checklist`
- `npm run check:billing-config`
- `npx tsc --noEmit --incremental false`
- `npm run lint`
- `npm run build`
- `git diff --check`

Run a security diff review before PR handoff. No merge or deployment is included in this slice.

## Next Recommended Slice

Next should be public community member card preview polish: add richer, public-safe preview metadata from each member's already-published profile sections, only when those sections are visible under the player's profile privacy settings, while keeping hidden profile sections private and preserving the same presentation-only isolation from billing, scoring, rankings, reviews, badges, seasons, Server Wars, XP, calling-card awards, and competitive eligibility.
