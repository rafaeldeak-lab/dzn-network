# Community Member Source Management Audit Handoff

Branch: `codex/community-member-source-management-audit-20260826`
Base: `codex/community-member-directory-foundation-20260826` at `2e243b609215c3c2ff589b5b656999d01b86e9aa`

This slice adds trusted owner/admin controls for reviewing or importing candidate community members into the existing public-safe `community_members` bridge. It does not change public profile publishing, live checkout, billing plans, Stripe configuration, Cloudflare secrets, Nitrado, Discord resources, rankings, discovery, reviews, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility.

## Added

- `migrations/0068_community_member_source_management_audit.sql`
  - Adds `community_member_candidates`.
  - Adds `community_member_source_audit`.
  - Adds scoped indexes for linked-server filtering, candidate status review, duplicate checks, and audit lookup.
  - Keeps the migration additive only.

- `functions/_lib/community-member-source-management.ts`
  - Adds the canonical owner/admin helper for this source-management slice.
  - Uses `getRequestSessionUser`, `requireActiveOwnerEntitlement`, and `isDznAdminDiscordId`.
  - Keeps normal owners scoped to their own linked servers.
  - Allows configured DZN admins to inspect/manage global candidate source rows.
  - Rejects duplicate `community_members` imports.
  - Rejects ambiguous DZN user bridges.
  - Masks candidate Discord IDs in returned owner/admin payloads.
  - Reads profile privacy only to report whether a matched user is already public-profile linkable. It does not write profile privacy rows or generate handles.

- `functions/api/owner/community-members.ts`
  - Adds `GET /api/owner/community-members` for source-management candidates, counts, server options, safeguards, and audit history.
  - Adds `POST /api/owner/community-members` for saving source candidates.
  - Authenticates before reading request bodies.
  - Uses bounded JSON parsing and private no-store responses.

- `functions/api/owner/community-members/[candidateId].ts`
  - Adds candidate `import` and `reject` actions.
  - Rechecks duplicate/no-match/ambiguous source state before import.
  - Writes imported `community_members` only after a unique trusted DZN user bridge is confirmed.

- `components/community/community-member-source-dashboard.tsx`
  - Adds the owner/admin UI for candidate creation, source queue review, import/reject actions, duplicate/ambiguous visibility, and audit history.
  - Shows that public profile links stay hidden until the player opts into a generated public profile handle.

- `app/dashboard/community-members/page.tsx`
  - Adds the dedicated owner dashboard source-management page.

- `app/owner/community-members/page.tsx`
  - Adds the owner-console alias page.

- `components/onboarding/dashboard.tsx`
  - Adds a `Community Members` tab to the server owner dashboard.

- `components/owner/owner-console.tsx`
  - Adds a `Community Members` owner-console section linking to the dedicated page.

- `scripts/test-community-member-source-management-audit.ts`
  - Locks API, UI, migration, authorization, duplicate/ambiguous rejection, private profile, and competitive-isolation contracts.

## Access Contract

- Logged-out visitors receive 401/login behavior through the protected page/API boundaries.
- Free logged-in players remain free players and cannot access owner/admin source management unless they become entitled owners or configured DZN admins.
- Normal owners must pass the canonical owner entitlement boundary before using source-management APIs.
- Normal owners may manage only source rows for their own linked servers.
- Configured DZN admins may inspect and manage global source rows through the same API.
- A paid plan does not let an owner manage another owner's linked server.

## Trusted Bridge Contract

- Candidate import requires an exact DZN user bridge:
  - exact `users.discord_id` from a numeric Discord ID, or
  - exact `users.id` from a DZN user ID.
- Discord display names, DZN display names, player names, gamertags, review names, leaderboard names, public profile handles, and browser-supplied text are not identity bridges.
- Duplicate `(community_guild_id, user_id)` membership is rejected and audited.
- Ambiguous Discord-to-user matches are rejected and audited.
- No-match candidates may be stored for review, but import remains blocked until a unique trusted user bridge exists.

## Mutation Contract

Allowed writes:

- `community_member_candidates`
- `community_member_source_audit`
- `community_members` only for imported rows with `source = 'trusted_dzn_bridge'`

Forbidden writes:

- `player_profile_privacy_preferences`
- CTF scoring/roster/bracket tables
- owner workflow/approval decision tables
- billing/Stripe/plan tables
- ranking/discovery tables
- review/review score tables
- badge/season/event/Server Wars scoring tables
- XP/calling-card/challenge award tables
- Nitrado/Discord/Cloudflare secret state

Public visibility remains player-controlled. Importing a source row into `community_members` cannot make a player visible unless that player has enabled public profile visibility and already has a generated `player_profile_privacy_preferences.public_handle`.

## Fairness

Community member source management is an owner/admin presentation bridge workflow only. It must not affect:

- public profile visibility without player opt-in
- CTF scoring rows
- owner workflow decisions
- approval decisions
- bracket outcomes
- billing
- rankings
- discovery score
- reviews or review score
- badges
- seasons
- events or tournaments
- Server Wars scoring/results
- XP awards
- calling-card awards
- competitive eligibility

## Production Safety

- `DZN_LIVE_CHECKOUT_ENABLED` remains disabled.
- No Stripe products/prices were created or changed.
- No Cloudflare secrets were created or changed.
- No production D1 migration was applied.
- No Nitrado mutation was performed.
- No Discord mutation was performed.
- Issue #49 remains reserved for final live checkout activation.
- Production merge/deploy/migration application: not included.

## Validation

Run before PR handoff:

- `npm run test:community-member-source-management-audit`
- `npm run test:public-community-member-directory-foundation`
- `npm run test:public-profile-attribution-controls-polish`
- `npm run test:public-profile-cross-surface-attribution`
- `npm run test:public-player-profile-viewer`
- `npm run test:player-profile-privacy-preferences`
- `npm run test:player-profile-progression-showcase`
- `npm run test:reviews-foundation`
- `npm run test:reviews-moderation-dashboard`
- `npm run test:reviews-moderation-workflow-polish`
- `npm run test:review-notification-read-state`
- `npm run test:ctf-event-roster-attribution-proof`
- `npm run test:event-roster-member-public-safe-expansion`
- `npm run test:player-owner-access-foundation`
- `npm run test:billing-plans`
- `npm run test:stripe-live-readiness`
- `npm run test:stripe-live-activation-checklist`
- `npm run check:billing-config`
- `npx tsc --noEmit --incremental false`
- `npm run lint`
- `npm run build`
- `git diff --check`

## Next Slice

Next should be community member source import usability polish: add safer import previews from trusted Discord/guild snapshots where available, improve admin filtering for repeated no-match or duplicate source rows, and add notification hooks for owners when a source candidate becomes importable, while still proving imports are presentation-only and cannot affect public profile visibility without player opt-in, CTF scoring rows, owner workflow decisions, approval decisions, bracket outcomes, billing, rankings, discovery score, reviews, badges, seasons, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility.
