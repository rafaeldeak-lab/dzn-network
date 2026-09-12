# DZN Player Hub Event Relevance Polish Handoff

Date: 2026-09-01

Branch: `codex/player-event-relevance-polish-20260901`

## Scope

This slice makes the private `/player` suggested event/tournament panel more useful for logged-in players. It does not create events, register servers, alter event participation, or change public discovery/ranking formulas.

## Implemented Contract

- `/api/player/hub` remains authenticated, `GET` only, and private no-store.
- The route still reads public eligible rows from `competitive_events`.
- The route now reads bounded `competitive_event_servers` rows for those candidate events only.
- The route privately derives display relevance from:
  - Current user's `player_saved_servers` output.
  - Already-filtered matched-community server previews from the private Discord community bridge.
- Suggested events are privately ordered:
  - `Followed server`
  - `Matched community`
  - `Public network`
- Each suggestion carries `relevance.presentation_only = true`.
- Event suggestions do not expose raw Discord guild identifiers.

## Access And Isolation Matrix

| Surface | Access | Writes | Boundary |
| --- | --- | --- | --- |
| `/api/player/hub` | Logged-in current user only | None | Private no-store Player Hub data |
| `/player` suggested events | Logged-in current user UI | None | Presentation-only relevance labels |
| `competitive_events` | Read public eligible candidates | None | No event outcome, scoring, or eligibility writes |
| `competitive_event_servers` | Read candidate server links | None | Used only for private display ordering |
| `player_saved_servers` | Current-user private read via canonical helper | None in this route | Saved state stays a private preference |
| `player_discord_community_memberships` | Current-user private read | None in this route | No raw Discord guild list in event suggestions |

## Explicit Non-Goals

- No event registration writes.
- No owner workflow changes.
- No scoring, eligibility, bracket, CTF, or Server Wars changes.
- No billing, Store, Stripe, checkout, Supporter Card, or live payment changes.
- No Nitrado or Discord runtime mutation.
- No profile visibility/public directory change.
- No discovery formula, ranking, review, badge, season, XP, or calling-card award change.
- No production D1 migration.
- No deployment from this branch until separately approved.

## Review Checklist

- Confirm suggested event relevance is only in the private Player Hub route.
- Confirm fallback behavior still works if event storage or server-link reads are unavailable.
- Confirm suggested event JSON does not include raw Discord guild ids.
- Confirm UI copy says suggestions are private and presentation-only.
- Run focused Player Hub tests, public access gates, billing config check, typecheck, lint, build, and `git diff --check`.

## Next Recommended Slice

Player Hub suggested event/tournament rendered QA and release review: run `/player` locally with representative saved-server and matched-community data, capture desktop/mobile proof of relevance badges and fallback states, then approve merge/release separately.
