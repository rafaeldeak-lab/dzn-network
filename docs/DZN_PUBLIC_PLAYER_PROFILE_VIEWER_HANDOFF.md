# DZN Public Player Profile Viewer Foundation Handoff

Date: 2026-09-01

## Scope

This slice adds the first public-safe, opt-in player profile publishing path:

- Add additive migration `0063_player_public_profiles.sql`.
- Add canonical public profile helpers in `functions/_lib/player-public-profiles.ts`.
- Add public read-only `GET /api/public/players/[handle]`.
- Add `/players/[handle]` static shell routing through Cloudflare Pages assets.
- Add a public DZN-branded `/players/[handle]` viewer.
- Update private `/api/player/profile/privacy` and `/player/profile` so the current player can see their active public profile link after opt-in.

The slice does not add profile attribution across reviews, leaderboards, community directories, events, or roster/member rows. It also does not add share analytics, social metadata, card images, public Supporter Card reveal, Store checkout, DZN Comms runtime, or AI Assist runtime.

## Data Model

`player_public_profiles` stores one generated public handle per `users.id`:

- `user_id` is `UNIQUE` and cascades on account deletion.
- `handle` is `UNIQUE`, lower-case, 3-48 characters, and restricted to `a-z`, `0-9`, and hyphens.
- `status` is constrained to `active` or `disabled`.

Publishing requires both:

- An active `player_public_profiles` row.
- `player_profile_privacy_preferences.public_profile_enabled = 1`.

## API Contract

`GET /api/public/players/[handle]`:

- Is public and read-only.
- Returns 404 for missing, hidden, disabled, or not-opted-in profiles.
- Uses the same safe 404 shape for hidden and missing handles.
- Returns only public-safe display fields and saved visible sections.
- Does not require or send player cookies.
- Uses no-store headers, including successful published payloads, so saved privacy changes are not served stale from browser or shared caches.

`/players/[handle]`:

- Uses the shared root DZN header and lets it resolve the current visitor's real login state.
- Keeps the public profile API fetch cookie-free with `credentials: "omit"`.

`GET/PATCH /api/player/profile/privacy`:

- Remains authenticated, same-origin for mutations, bounded, private, and no-store.
- Generates or reactivates only the current user's handle when `public_profile_enabled` is enabled.
- Returns `public_profile_href` only when the current user is opted in and has an active handle.

## Public Payload Boundary

The public viewer may show:

- Safe display name only when `show_display_name` is true.
- Public-safe aggregate gameplay totals only when `show_gameplay_summary` is true.
- One public-safe featured server only when `show_featured_server` is true.
- Future-state copy for XP, challenges, calling cards, and award dates only when each saved section is visible.

It must not expose:

- DZN `user_id`.
- Discord ID.
- Raw `player_id` or `player_name`.
- Raw award evidence.
- Hidden server rows.
- Other-user private state.
- Billing, Store, owner entitlement, Supporter Card, checkout, Nitrado, review, ranking, discovery, event, scoring, XP award, calling-card award, or competitive eligibility data.

## Validation

Dedicated coverage is registered as:

```bash
npm run test:public-player-profile-viewer
npm run qa:public-player-profile-rendered
```

The test proves handle constraints, public-safe 404 behavior, current-user handle generation, saved preference enforcement, hidden-section omission, no private identifiers in public payloads, read-only public route behavior, Pages route inclusion for `/players/*`, and no protected payment/owner/review/event/scoring/progression/competitive table writes.

Rendered local QA artifact:

- `docs/qa/public-player-profile-viewer-qa-20260901/README.md`
- Desktop/mobile published profile screenshots.
- Hidden, unavailable, and no-handle fallback screenshots.
- Local mock/intercepted API responses only.

## Next Slice

The next clean product slice should be public profile discovery/linking polish:

- Add profile entry links from relevant player-facing surfaces only when a generated public handle exists.
- Add private owner copy/share controls for the player.
- Add richer empty states for hidden or not-yet-earned sections.
- Keep public profiles read-only and isolated from billing, rankings, discovery score, reviews, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, and competitive eligibility.

The DZN Comms/support backlog remains separate: site-wide support launcher, logged-in global chat, private group chat, emoji reactions, live presence counter, profanity warnings/timeouts, moderation hooks, and public-DZN-info-only AI support bot all still require their own approval/preflight/runtime slices before persistence, WebSockets/Durable Objects, AI credentials, vector stores, analytics, metered calls, or production mutations are introduced.
