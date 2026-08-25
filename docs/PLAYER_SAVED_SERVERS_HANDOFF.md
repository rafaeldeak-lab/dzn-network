# DZN Player Saved Servers Handoff

## Scope

This slice is stacked on the Player Hub Foundation branch. It adds the first saved/followed server interaction for logged-in players without changing live checkout, production D1, Stripe, Nitrado, Discord, owner billing products, server ownership, reviews, events, rankings, or competitive scoring.

## Branching

- Base dependency: `codex/player-hub-foundation-20260825` / PR #51.
- Slice branch: `codex/player-saved-servers-20260825`.
- Production merge/deploy/payment activation: not included.

## Product Contract

Saved/followed servers are private player preferences. A normal Discord player can save or remove a public server from public server cards and public server profiles. This helps their Player Hub remember servers they care about, but it does not make them a server owner and does not influence any shared DZN result.

## Access Matrix

| Surface | Visitor | Free Discord player | Starter trial/active | Pro active/effective Pro |
| --- | --- | --- | --- | --- |
| `/api/player/saved-servers` `GET` | 401 | Allowed | Allowed | Allowed |
| `/api/player/saved-servers` `POST` | 401 | Allowed | Allowed | Allowed |
| `/api/player/saved-servers` `DELETE` | 401 | Allowed | Allowed | Allowed |
| Public server save/follow buttons | Login redirect on action | Allowed | Allowed | Allowed |
| `/setup` and owner tools | Login/pricing boundary | Pricing redirect until entitled | Allowed | Allowed |

## Implementation Notes

- `functions/api/player/saved-servers.ts` uses `getRequestSessionUser` for normal session auth.
- `POST` and `DELETE` resolve the target against visible public `linked_servers` before changing preference state.
- The only preference mutation target is `player_saved_servers`.
- Public server cards, discovery cards, and server profiles fetch saved state from `/api/player/saved-servers` separately from `/api/public/servers`.
- Logged-out save/follow attempts redirect to `/login?returnTo=...`, not `/pricing`.

## Fairness Contract

Saved/followed state must not affect:

- Leaderboard rank, server score, K/D, ADM stats, or discovery score.
- Billing entitlement, owner access, server ownership, Nitrado linking, or Discord ownership.
- Reviews, ratings, events, tournaments, Server Wars, seasons, badges, XP, challenge outcomes, calling cards, or competitive eligibility.

## Future Pricing Redesign Note

The dedicated `/pricing` visual upgrade is intentionally handled in the next stacked slice, `codex/pricing-visual-upgrade-20260825`. That slice makes the comparison clearer with red X marks and green ticks, makes Pro visibly richer than Starter, uses bolder DZN-styled presentation, and adds subtle slow pan/zoom background motion while respecting reduced-motion settings. It remains separate from saved-server interaction behavior.

## Validation Checklist

- `git diff --check`
- `npm run test:player-saved-servers`
- `npm run test:player-hub-foundation`
- `npm run test:player-owner-access-foundation`
- `npm run test:public-access-gating`
- `npm run test:public-servers-fallback`
- `npm run test:premium-visibility`
- `npm run test:promotions`
- `npm run test:billing-plans`
- `npm run test:stripe-live-readiness`
- Typecheck, lint, and build when dependencies are installed.
