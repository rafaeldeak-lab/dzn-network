# Public Profile Owner Preview/Share Polish Handoff

Date: 2026-09-01

Branch: `codex/public-profile-owner-preview-share-polish-20260901`

Base: `origin/main` at `a674ef4d2977a523f3fc1b340b80339eceb712bf`

## Scope

This slice adds private owner-facing preview/share polish for a logged-in player's own public profile link.

It does not add migrations, public profile write APIs, privacy-setting writes beyond the existing save controls, public card sharing, analytics, tracking, Store/payment work, live checkout, DZN Comms runtime, AI runtime, Nitrado/Discord runtime changes, production D1 writes, or issue `#49` changes.

## Implementation

- Adds `components/player/public-profile-owner-preview-panel.tsx`.
- Mounts the panel inside the logged-in `/player/profile` privacy settings surface.
- Reads the current user's private `GET /api/player/profile/privacy` payload through the existing settings panel.
- Reads the existing public-safe `GET /api/public/players/[handle]` endpoint to mirror exactly what visitors can see.
- Validates generated `/players/[handle]` hrefs before opening/copying/sharing.
- Keeps copy/open/share status in local React state for the current page session only.
- Handles hidden, disabled, missing-handle, loading, and unavailable preview states.
- Shows visible/hidden/not-yet-earned section states without exposing private identifiers or raw award evidence.

## PR Review Fixes

- Revalidates the visitor-safe preview whenever saved section visibility changes.
- Keeps the owner preview/share panel stacked so it does not collapse inside the narrower profile-page column.
- Renders the locked "Open Public Page" state as a disabled button, not a keyboard-activatable link.

## Privacy And Fairness Boundary

The panel is a private player convenience surface only.

It must not:

- Store share history.
- Create tracking events.
- Call tracking or analytics endpoints.
- Write profile privacy settings unless the user uses the existing saved preference controls.
- Change billing, owner entitlement, server ownership, Store/payment state, live checkout, rankings, discovery, reviews, badges, seasons, events, Server Wars, CTF, XP awards, calling-card awards, or competitive eligibility.

## Reviewer Checklist

- Confirm `/player/profile` still requires logged-in player access.
- Confirm `/players/[handle]` remains public-safe and does not include owner-only share controls.
- Confirm the preview panel uses `credentials: "omit"` when reading the public profile endpoint.
- Confirm no new mutation route or migration is introduced.
- Confirm no production D1 migration is required.
- Confirm DZN Comms and AI support remain queued for their own future approval slices.

## Validation

Completed locally on 2026-09-01:

- `npm run test:player-profile-privacy-preferences`
- `npm run test:public-player-profile-viewer`
- `npm run test:public-profile-owner-preview-share-polish`
- `npm run test:public-profile-discovery-linking`
- `npm run test:player-hub-profile-progression`
- `npm run qa:public-profile-owner-preview-share`
- `npm run lint`
- `npm run build`
- `npm run test`
- `git diff --check`

Rendered QA artifact:

- `docs/qa/public-profile-owner-preview-share-qa-20260901/README.md`

Validation note:

- The first full `npm run test` pass exposed a stale `test:dzn-player-nav-main-release-candidate` guard that rejected approved public `/players/[handle]` leaderboard attribution from PR `#142` because it matched any `/player` substring. The guard is narrowed in this slice to keep blocking private `/player` and `/player/profile` route dependencies while allowing public `/players/[handle]` links. The corrected full test chain passed.
