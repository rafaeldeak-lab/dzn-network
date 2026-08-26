# Community Member Directory and Player Hub Surfacing Polish

Date: 2026-08-26

Branch: `codex/community-member-directory-player-hub-polish-20260826`

Base branch: `codex/community-member-retained-export-approval-design-20260826`

Base commit: `9de98b7 Add retained export approval design guardrails`

## Purpose

This slice makes the already-public-safe community member directory easier for players and owners to find:

- Free logged-in Player Hub users can open public community member directories for matched, saved, or suggested servers that already have a safe public slug.
- Public visitors can search and role-filter visible member rows on `/servers/[slug]/community`.
- Owners/admins can preview whether a candidate/imported bridge is public-ready from the community member source dashboard.

## Implementation

- `GET /api/player/hub` now returns a separate `community_href` next to each server profile `href`.
- `components/player/player-hub-page.tsx` adds:
  - "Community Member Directories" section.
  - "Members" actions on matched community rows.
  - "Member Directory" actions on saved/suggested server cards.
- `components/community/public-community-members-page.tsx` adds:
  - search across already-public display names and public role labels;
  - role filtering for already-public role labels;
  - copy/share controls for the public community URL;
  - clearer hidden/private empty states.
- `components/community/community-member-source-dashboard.tsx` adds:
  - `PublicDirectoryStatus` preview on candidate cards;
  - public directory links for candidate servers with safe public slugs;
  - "public-ready" vs "private" presentation state.
- `communityMemberSourceManagementSafeguards()` adds `public_directory_preview_presentation_only: true`.

## Access And Entitlement Matrix

| Surface | Visitor | Free Discord player | Starter/Pro owner | Notes |
| --- | --- | --- | --- | --- |
| `/servers/[slug]/community` | Allowed | Allowed | Allowed | Public-safe read-only shell |
| `GET /api/public/servers/[serverId]/community-members` | Allowed | Allowed | Allowed | Public-safe read-only JSON |
| `/player` community directory links | Login required | Allowed | Allowed | Free player surface; no owner entitlement |
| `/dashboard/community-members` public directory preview | Login/pricing boundary | Owner plan required | Own scope or DZN admin | Preview only; cannot publish a player profile |
| Owner setup | Login/pricing boundary | Pricing redirect | Entitlement-gated setup | Unchanged |

## Protected Boundaries

The public directory continues to expose only members that pass all of these checks:

- `community_members.public_member_enabled = 1`
- `community_members.source = 'trusted_dzn_bridge'`
- trusted bridge from `community_members.community_guild_id + community_members.user_id` to `users.id`
- opted-in generated public profile handle from `player_profile_privacy_preferences`

This slice does not expose:

- raw Discord IDs;
- raw DZN user IDs;
- raw linked-server IDs;
- raw community guild IDs;
- OAuth tokens;
- Nitrado tokens;
- Stripe state or secrets;
- source candidate rows;
- raw award evidence;
- scoring, approval, owner workflow, or billing state.

## Isolation Guarantees

The new links, filters, and preview blocks are presentation-only. They must not affect:

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
- live checkout activation;
- Stripe product or price changes;
- Cloudflare secret changes;
- production D1 writes;
- Nitrado calls;
- Discord mutations;
- issue #49 merge.

Live checkout remains disabled, and issue #49 remains reserved for final live payment activation.

## Validation Plan

Run at minimum:

- `npm run test:community-member-directory-player-hub-polish`
- `npm run test:player-hub-foundation`
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

Next should be community member directory discovery/search polish for public visitors: add richer public sorting/grouping and server/community context cards for already-visible members only, while continuing to keep hidden players private, owner/admin import controls gated, retained exports blocked unless separately approved, live checkout disabled, and all scoring, billing, rankings, reviews, badges, seasons, Server Wars, XP, calling-card awards, and competitive eligibility isolated.
