# Public Community Member Card Preview Polish Handoff

Branch: `codex/public-community-member-card-preview-polish-20260826`

Base branch: `codex/public-community-directory-discovery-polish-20260826`

Base commit: `79474285c4258620dbf7b85c2d1154f972f21977`

This slice enriches `/servers/[slug]/community` public member cards with preview metadata from already-published player profile sections only. It does not add a migration, owner/admin import write, retained export feature, checkout behavior, scoring hook, award path, or production mutation.

## Implementation

- `functions/_lib/public-player-profile.ts`
  - Adds `PublicPlayerProfileDirectoryPreview`.
  - Adds `readPublicPlayerProfileDirectoryPreviewsByUserIds`.
  - Adds `projectPublicPlayerProfileDirectoryPreviewForPublicTest`.
  - Reads section summaries only after the public profile row confirms that section is visible.
- `functions/_lib/public-community-members.ts`
  - Adds nullable `profile_preview` to public member rows.
  - Attaches previews only for members already returned through the trusted `community_members` bridge and generated public profile attribution.
  - Adds `preview_uses_published_profile_sections_only` and `preview_omits_hidden_profile_sections` safeguards.
- `components/community/public-community-members-page.tsx`
  - Validates the `published_profile_sections` preview contract before rendering.
  - Shows visible XP, challenge, and calling-card highlights.
  - Shows an empty state when profile sections are hidden or not yet earned.
- `scripts/test-public-community-member-card-preview-polish.ts`
  - Adds focused coverage for section-level privacy, public projection, no private fields, no protected influence, and no write behavior.
- `docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md`, `docs/PUBLIC_ACCESS_POLICY.md`, and `docs/PUBLIC_PLAYER_PROFILE_VIEWER_HANDOFF.md`
  - Record the slice and its boundaries.

## Public Data Boundary

The preview may show only:

- public-safe XP level label and XP total label when `show_xp` is visible;
- public-safe challenge joined/completed counts when `show_challenge_progress` is visible;
- public-safe calling-card count and one calling-card name when `show_calling_cards` is visible.

The preview must not expose:

- raw Discord IDs;
- internal DZN user IDs;
- raw source IDs;
- raw award evidence;
- exact award timestamps;
- private profile settings;
- owner/admin import records;
- retained export artifacts;
- billing state;
- scoring state;
- approval state;
- review internals.

## Access Matrix

| Surface | Visitor | Free Discord player | Starter/Pro owner | Boundary |
| --- | --- | --- | --- | --- |
| `/servers/[slug]/community` | Allowed | Allowed | Allowed | Public-safe read-only directory |
| Public member card preview | Already-published visible profile sections only | Already-published visible profile sections only | Already-published visible profile sections only | `community_members` trusted bridge plus generated public handle plus section-level privacy |
| Hidden profile section | Hidden | Hidden | Hidden | Not queried for card preview |
| Owner/admin import controls | Denied | Denied | Entitlement/admin scoped | Separate private owner/admin source-management surface |
| Retained exports | Blocked | Blocked | Blocked unless separately approved | No retained export implementation in this slice |

## Isolation

This slice must not affect billing, scoring, rankings, discovery score, reviews, review score, badges, seasons, events, CTF rows, bracket outcomes, owner workflow decisions, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility.

It must not add migrations, background jobs, checkout sessions, profile handle generation, profile privacy writes, billing updates, server ownership changes, ranking updates, discovery score updates, review mutations, badge awards, season changes, event mutations, roster mutations, CTF scoring changes, Server Wars score/result changes, XP awards, calling-card awards, Nitrado calls, Discord mutations, Cloudflare secret changes, production D1 writes, retained export files, export-history rows, sharing links, storage bindings, retention write APIs, live checkout activation, or issue #49 changes.

Live checkout remains disabled. Issue #49 remains reserved for final live payment activation.

## Validation Targets

- `npm run test:public-community-member-card-preview-polish`
- `npm run test:public-community-directory-discovery-polish`
- `npm run test:community-member-directory-player-hub-polish`
- `npm run test:public-community-member-directory-foundation`
- `npm run test:public-player-profile-viewer`
- `npm run test:player-profile-privacy-preferences`
- `npm run test:player-profile-progression-showcase`
- `npm run test:challenges-xp-calling-cards-foundation`
- `npm run test:progression-awards-foundation`
- `npm run test:billing-plans`
- `npm run test:stripe-live-readiness`
- `npm run test:stripe-live-activation-checklist`
- `npm run check:billing-config`
- `npx tsc --noEmit --incremental false`
- `npm run lint`
- `npm run build`

## Next Recommended Slice

Next should be player public-profile visual polish: make `/players/[handle]` itself feel richer and more DZN-branded now that community cards can preview visible sections, while preserving the same privacy controls and proving public profile styling cannot affect billing, scoring, rankings, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, or competitive eligibility.
