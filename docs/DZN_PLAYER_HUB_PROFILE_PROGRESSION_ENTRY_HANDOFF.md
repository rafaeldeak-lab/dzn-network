# DZN Player Hub Profile/Progression Entry Handoff

Date: 2026-09-01

Branch: `codex/player-profile-progression-entry-20260901`

Base: `origin/main` after rollback merge `af091a13dd778f7343068882f58d8980253d2dc6`

## Scope

This slice makes the private Player Hub profile area more useful with current-user read-only data:

- Adds `profile_summary` and `progression_summary` to `GET /api/player/hub`.
- Reads Discord-scoped `player_profiles` rows for the current logged-in user.
- Joins only to public-safe `linked_servers` display fields.
- Renders a richer `/player` and `/player/profile` Profile & Progression panel.
- Keeps existing followed servers, matched communities, suggested events, and owner-pricing boundaries intact.

No migration is added. No production D1 write is required.

## Data Contract

The private hub payload now includes:

- `profile_summary`: display name, private profile href, public profile status, linked gameplay profile count, linked public-server count, latest seen timestamp, source, and private/presentation-only flags.
- `progression_summary`: safe aggregate gameplay totals, one public-safe featured server, earned-track readiness entries for XP/challenges/calling cards, source, and private/presentation-only flags.

The route deliberately does not return:

- Raw `player_name`.
- Raw `player_id`.
- Other-user profile rows.
- Hidden/deleted/merged/slugless server rows.
- Public profile handles.
- Profile privacy settings.
- Award evidence or award ledgers.
- Billing, Store, owner entitlement, Nitrado, or server-management state.

## Boundary Matrix

| Surface | Change | Boundary |
| --- | --- | --- |
| `/api/player/hub` | Adds private profile/progression read model | `GET` only, private no-store, current Discord user only |
| `/player` | Shows Profile & Progression panel | Presentation only, no writes |
| `/player/profile` | Shares the same private panel shell | No public profile publishing |
| XP/challenges/calling cards | Shows future earned-track readiness | No award runtime, no self-awards |
| Owner setup | Still links to `/pricing?intent=owner_setup&returnTo=%2Fsetup` | No setup bypass |

## Security And Fairness

This slice must not alter:

- Privacy settings or public profile visibility.
- XP awards or calling-card awards.
- Billing, Store, Stripe, live checkout, or issue `#49`.
- Owner entitlement, Nitrado linking, server ownership, or setup APIs.
- Review state or review scores.
- Event registrations, outcomes, brackets, Server Wars, CTF, or scoring.
- Rankings, discovery formulas, badge/crown/season state, or competitive eligibility.

## Validation

Run before PR:

- `npm run test:player-hub-real-data`
- `npm run test:player-hub-profile-progression`
- `npm run test:player-hub-event-relevance`
- `npm run test:player-community-refresh-status`
- `npm run test:player-community-matching`
- `npm run test:player-community-matching-ui`
- `npm run test:player-saved-servers`
- `npm run test:dzn-player-nav-main-release-candidate`
- `npm run test:public-access-gating`
- `npm run check:billing-config`
- `npx tsc --noEmit --incremental false`
- `npm run lint -- --ignore-pattern .wrangler/**`
- `npm run build`
- `git diff --check`

## Next Slice

Recommended next product slice:

- Player profile privacy settings model: add persistent player-owned public profile visibility and per-section display preferences behind private settings APIs, with tests proving those settings cannot affect billing, rankings, discovery, reviews, badges, seasons, events, Server Wars, XP awards, calling-card awards, or competitive eligibility.
