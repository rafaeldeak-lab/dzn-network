# DZN Public Profile Discovery Linking Handoff

Date: 2026-09-01

## Scope

This slice adds public profile entry links to existing player-facing read surfaces only when DZN already has a trusted account bridge and the player has opted into public profile publishing.

Linked surfaces:

- Public server review author rows.
- Public server profile PvP leaderboard rows.
- Public server profile top-player cards.
- Global leaderboard top-player rows.
- Global leaderboard longest-kill player mentions and personal-best rows.

Out of scope:

- No new migration.
- No profile handle generation outside the existing private `/player/profile` settings flow.
- No public directory expansion.
- No chat, reaction, message, support bot, live presence, or AI runtime work.
- No Store/payment, checkout, Stripe, Cloudflare secret/config, production D1, Nitrado, Discord runtime, deployment, or issue `#49` changes.

## Trust And Privacy Contract

The attribution read path is:

`public row Discord ID -> users.discord_id -> player_public_profiles.user_id -> player_profile_privacy_preferences.user_id`

A public profile link is returned only when:

- The public profile handle exists.
- `player_public_profiles.status = 'active'`.
- `player_profile_privacy_preferences.public_profile_enabled = 1`.

Kill-event and leaderboard attribution must also have a trusted per-server `player_profiles.player_id` bridge to a Discord-backed DZN account. Player-name matching alone is not trusted enough for profile attribution and must remain unlinked.

Public payloads expose only:

- `public_profile_handle`
- `public_profile_href`
- `player_public_profile_handle`
- `player_public_profile_href`

Public payloads must not expose:

- Discord IDs.
- DZN user IDs.
- Raw `player_id` values.
- Raw award evidence.
- Payment, entitlement, Supporter Card, owner, Nitrado, or Discord token state.

## Cache Boundary

Public profile attribution is volatile because a player can hide their public profile after a public API snapshot is generated.

`writePublicApiCache` strips these fields before saving fallback snapshots:

- `public_profile_handle`
- `public_profile_href`
- `player_public_profile_handle`
- `player_public_profile_href`

This means live responses can show opt-in links, while snapshot fallback responses preserve privacy by omitting profile attribution links.

## Entitlement And Access Matrix

| Surface | Logged-out | Logged-in player | Owner entitlement | Notes |
| --- | --- | --- | --- | --- |
| `/players/[handle]` | Public-safe published profile only | Same public-safe profile | No effect | Hidden profiles return safe not found. |
| Server reviews | Preview locked | Reviews with optional profile links | No effect | Review score/count unchanged. |
| Public server PvP leaderboard | Preview locked | Player rows with optional profile links | No effect | Rank order unchanged. |
| Global leaderboards | Preview locked for player rows | Player rows with optional profile links | No effect | Sorting formulas unchanged. |
| Owner setup/tools | Pricing/entitlement gated | Pricing/entitlement gated | Required | Unchanged by this slice. |

## Fairness Boundary

Public profile links are presentation-only. They cannot change:

- Billing or owner entitlement.
- Server ownership or Nitrado linking.
- Review scores or moderation status.
- Rankings, discovery scores, K/D, kills, deaths, longest kill, or leaderboard formulas.
- Event outcomes, brackets, CTF scoring, or Server Wars scoring.
- Badges, seasons, XP awards, calling-card awards, or competitive eligibility.

## Validation To Run

Targeted checks:

- `npm run test:public-profile-discovery-linking`
- `npm run test:public-player-profile-viewer`
- `npm run test:public-listing-reviews`
- `npm run test:public-leaderboards`

General checks:

- `npm run lint`
- `npm run build`
- `git diff --check`

Production release is not part of this slice. Merge and deploy require separate approval.
