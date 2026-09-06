# DZN Verified Player Game-Identity Linking Handoff

Date: 2026-09-02

## Scope

This slice adds the first verified Discord-to-ADM player identity bridge so player stats can be attached to the right logged-in Discord account without name-only matching.

## Implementation Contract

- Players use private `GET/POST /api/player/game-identities`.
- A claim targets one public-safe server and one exact ADM `player_id`.
- Player-facing UI should hide the technical "slug" concept behind a simple public server picker/search, then ask only for the game ID or proof code supplied by the owner.
- Claims are stored in `player_game_identity_claims`.
- Server owners and DZN admins use private owner/admin routes:
  - `GET /api/owner/player-game-identity-claims`
  - `PATCH /api/owner/player-game-identity-claims/[claimId]`
- Approval creates an active `player_game_identity_links` row and writes audit facts in `player_game_identity_audit_log`.
- Approval may backfill `player_profiles.discord_id` for the exact `id + linked_server_id + player_id` row for compatibility.
- The shared stat bridge now reads active verified links first and keeps the older direct `player_profiles.discord_id` path as compatibility.
- Public leaderboard profile attribution can resolve handles through active verified links, but ranking/order/score calculations remain unchanged.
- `/player/profile` now includes a private "Link My Game Stats" panel with link status and claim creation.
- Normal players should see "choose server", "game ID", and "owner/admin check" language. Internal `server_slug`, `linked_server_id`, and ADM `player_id` wording should remain limited to code, tests, docs, or owner/admin technical surfaces.
- `/owner/player-game-identity-claims` is the private troubleshooting queue for matching server owners and DZN admins. It shows the exact submitted game ID, selected server, imported game profile label, approve/reject guidance, and missing-evidence copy.
- The owner/admin queue can show `submitted_player_id` only because it is private no-store and scoped through the owner/admin review API. Player-facing and public profile payloads continue to mask game IDs.

## Release Notes

This branch adds `migrations/0064_player_game_identity_links.sql`.

PR `#144` currently also uses migration number `0064` for the DZN Comms read-history foundation. If this identity-linking branch lands first, PR `#144` must be retargeted and its migration renumbered before it is released.

## Owner/Admin Troubleshooting Polish

The follow-up troubleshooting slice adds no migration. It exposes the existing pending-claim review route through `/owner/player-game-identity-claims` and adds private review context to the owner/admin payload. The page helps owners/admins see the selected server, imported game profile label, exact submitted game ID, player account label, approve/reject rules, and missing-evidence guidance.

Exact submitted game IDs remain blocked from public/player-facing payloads. They are visible only in the private owner/admin queue, which uses private no-store responses and server-side owner/admin claim review gates.

## Non-Goals

- No production D1 migration was applied by this slice.
- No deployment was performed.
- No payment, Stripe, Store, Supporter Card, live checkout, Cloudflare secret/config, Nitrado runtime, Discord runtime, chat, AI, retained export, scoring, ranking, discovery, review, event, XP, calling-card, Server Wars, CTF, or competitive eligibility mutation is part of this slice.
- The owner/admin troubleshooting page does not add new identity proof storage, uploads, Discord calls, Nitrado calls, webhooks, admin overrides, ranking formulas, discovery formulas, or competitive decisions.

## Next Slice

After the identity-linking and troubleshooting polish are reviewed and released, verify `/player`, `/player/profile`, the relevant public `/players/[handle]`, and `/owner/player-game-identity-claims` with a real pending/approved identity link. Then return to the queued DZN Comms path, starting with PR `#144` read-history release/renumbering if approved.
