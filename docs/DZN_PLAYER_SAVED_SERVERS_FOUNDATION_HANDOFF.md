# DZN Player Saved Servers Foundation Handoff

Date: 2026-08-31

Branch: `codex/player-saved-servers-foundation-20260831`

Base: `origin/main` at `ab9ace17c98cb52f2f72b92483a0c0cbc6f12fa6`

## Scope

This slice adds the first real saved/followed server interaction foundation for free logged-in players:

- `player_saved_servers` stores private user/server preferences.
- `GET /api/player/saved-servers` returns the current player's private saved state for UI hydration.
- `POST /api/player/saved-servers` saves a public listed server for the current player.
- `DELETE /api/player/saved-servers` removes the current player's saved preference.
- Public server discovery cards, standard server cards, and server profile pages show `Save Server`, `Saved`, or `Login to Save` controls.

## Access Contract

Saved/followed servers are player-side preferences:

- Discord login is required.
- No owner plan, Starter trial, Pro subscription, billing account, Nitrado connection, or server ownership is required.
- Reads and writes are scoped to the current DZN user.
- Responses are `private, no-store` and `Vary: Cookie`.
- Mutations reject mismatched `Origin` headers when present.
- Public server snapshots and public API cache payloads do not include saved-state data.

## Server-Side Boundaries

The new API route and helper may only:

- Read the current session user.
- Verify that a requested linked server is publicly listed, not hidden, not deleted/merged, and has a public slug.
- Insert or delete rows in `player_saved_servers`.
- Read the current user's saved rows joined to safe public server display fields.

They must not write or calculate:

- billing, account entitlements, Stripe checkout, Store, Supporter Cards, or issue `#49`
- Nitrado tokens, linked server ownership, setup, onboarding, or server-management state
- reviews, review score, moderation state, or owner replies
- events, tournaments, CTF, seasons, Server Wars, brackets, or eligibility
- rankings, discovery score, leaderboard formulas, K/D, ADM stats, XP, calling cards, badges, or crowns

## Entitlement And Fairness Matrix

| Surface | Logged-out | Free logged-in player | Starter owner | Pro owner |
| --- | --- | --- | --- | --- |
| Public server list/profile page | Login-gated by app-page middleware | Can browse and save privately | Can browse and save privately | Can browse and save privately |
| `GET /api/player/saved-servers` | `401` | Own saved state only | Own saved state only | Own saved state only |
| `POST /api/player/saved-servers` | `401` | Save own preference only | Save own preference only | Save own preference only |
| `DELETE /api/player/saved-servers` | `401` | Remove own preference only | Remove own preference only | Remove own preference only |
| Owner setup/Nitrado/dashboard tools | Login/pricing/entitlement boundary | Billing-gated | Entitlement-gated | Entitlement-gated |
| Competitive systems | No effect | No effect | No effect | No effect |

## Validation

Required before merge:

- `npm run test:player-saved-servers`
- `npm run test:public-servers-fallback`
- `npm run test:public-access-gating`
- `npm run test:dzn-player-nav-main-release-candidate`
- `npm run check:billing-config`
- `npx tsc --noEmit --incremental false`
- `npm run lint -- --ignore-pattern .wrangler/**`
- `npm run build`
- `npm test`
- `git diff --check`

## Manual QA Notes

Expected rendered behavior:

- Logged-out server cards/profile show `Login to Save`.
- Logged-in cards/profile load private saved state through `/api/player/saved-servers`.
- Clicking `Save Server` sends only `POST /api/player/saved-servers`.
- Clicking `Saved` sends only `DELETE /api/player/saved-servers`.
- Save controls do not call analytics, promotion tracking, local storage, session storage, chat routes, Store routes, billing routes, Nitrado routes, owner routes, review routes, event routes, or competitive APIs.

## Next Slice

After this PR is reviewed and released, the next product slice should be the Player Hub real-data foundation:

- show matched Discord communities
- show followed/saved servers
- show suggested events/tournaments
- show profile entry points
- keep owner setup behind `/pricing` and canonical entitlement gates
