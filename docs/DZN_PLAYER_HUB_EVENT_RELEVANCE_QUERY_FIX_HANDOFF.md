# DZN Player Hub Event Relevance Query Fix Handoff

Date: 2026-09-01

Branch: `codex/player-event-relevance-query-cap-fix-20260901`

## Scope

This follow-up fixes a private Player Hub relevance edge case from the event/tournament relevance polish release. It does not change the UI contract, create events, register servers, alter event outcomes, or touch production data.

## Implemented Contract

- `/api/player/hub` remains authenticated, `GET` only, and private no-store.
- The route still reads a bounded public candidate set from `competitive_events`.
- The route still keeps registered-server counts separate from private relevance labels.
- The route now reads `competitive_event_servers` with both:
  - Candidate event ids.
  - The current player's followed or matched-community server ids.
- Crowded public event registrations cannot hide a followed-server or matched-community relevance match.
- Suggested events still use presentation-only labels:
  - `Followed server`
  - `Matched community`
  - `Public network`
- Suggested event payloads still do not expose raw Discord guild ids.

## Access And Isolation Matrix

| Surface | Access | Writes | Boundary |
| --- | --- | --- | --- |
| `/api/player/hub` | Logged-in current user only | None | Private no-store Player Hub data |
| `competitive_events` | Read public eligible candidates | None | No event scoring, eligibility, or outcome writes |
| `competitive_event_servers` | Read candidate links for current-player relevant server ids only | None | Relevance input only |
| `player_saved_servers` | Current-user private read via canonical helper | None in this route | Private player preference |
| `player_discord_community_memberships` | Current-user private read | None in this route | Private Discord context |

## Explicit Non-Goals

- No event registration writes.
- No owner workflow changes.
- No public discovery, ranking, review, badge, season, progression, XP, calling-card, Server Wars, CTF, scoring, eligibility, or competitive-system changes.
- No billing, Store, Stripe, checkout, Supporter Card, or live payment changes.
- No Nitrado or Discord runtime mutation.
- No production D1 migration.
- No deployment from this branch until separately approved.

## Validation

- `npm run test:player-hub-real-data`
- `npm run test:player-hub-event-relevance`
- `git diff --check`

## Next Recommended Slice

Rendered `/player` QA/release polish with representative saved-server and matched-community data, proving relevance badges, crowded-event matching, empty states, and fallback states before the next Player Hub product feature.
