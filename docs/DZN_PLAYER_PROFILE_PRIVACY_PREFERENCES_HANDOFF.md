# DZN Player Profile Privacy Preferences Handoff

Date: 2026-09-01

## Scope

This slice adds persistent, player-owned profile display preferences for future public profile publishing. It is intentionally limited to private account settings:

- Add additive migration `0062_player_profile_privacy_preferences.sql`.
- Add private authenticated `GET/PATCH /api/player/profile/privacy`.
- Add a logged-in `/player/profile` privacy preferences panel.
- Keep public profile route publishing, handle generation, attribution, share controls, card images, and public viewer APIs blocked for later dedicated slices.

## Data Model

`player_profile_privacy_preferences` stores exactly one row per `users.id`:

- `public_profile_enabled`
- `show_display_name`
- `show_gameplay_summary`
- `show_featured_server`
- `show_xp_progress`
- `show_challenge_progress`
- `show_calling_cards`
- `show_award_dates`

All display preference fields are constrained to `0` or `1`. The table has a `UNIQUE(user_id)` guard and cascades when the owning account is removed.

## API Contract

`GET /api/player/profile/privacy`:

- Requires the current Discord session.
- Returns private no-store data.
- Returns defaults without writing when no row exists.
- Returns `public_profile_href: null`; this slice does not create public handles or profile URLs.

`PATCH /api/player/profile/privacy`:

- Requires the current Discord session.
- Requires same-origin mutation.
- Accepts a bounded JSON body shaped as `{ "settings": { "<allowed_key>": true|false } }`.
- Rejects unknown keys and non-boolean values.
- Upserts only the current user's row through `ON CONFLICT(user_id) DO UPDATE`.

## Isolation Guarantees

Profile privacy preferences are display settings only. They cannot affect:

- Billing, Store, checkout, Supporter Cards, or issue `#49`.
- Rankings, discovery score, public leaderboard formulas, or competitive eligibility.
- Reviews, badges, seasons, events, Server Wars, CTF, XP awards, or calling-card awards.
- Owner setup, Nitrado linking, server ownership, Discord owner workflows, or production services.

## Validation

Dedicated guardrail/runtime coverage is registered as:

```bash
npm run test:player-profile-privacy-preferences
```

The test proves anonymous denial, private no-store headers, same-origin PATCH enforcement, strict allowed boolean keys, idempotent current-user upsert, other-user isolation, no implicit GET writes, no public profile URL creation, and no protected table writes.

## Next Slice

Superseded by the later public profile publishing/viewer foundation slice:

- Generate or use a trusted public handle only after explicit approval.
- Add a public-safe profile route/API that reads these saved preferences.
- Show only approved sections.
- Hide private identifiers and raw award evidence.
- Prove again that visibility choices are presentation-only and cannot affect billing, rankings, discovery, reviews, badges, seasons, events, Server Wars, XP awards, calling-card awards, CTF, or competitive eligibility.

After that viewer slice, `/api/player/profile/privacy` may return the current user's active `public_profile_href` only when `public_profile_enabled` is true and a generated current-user handle exists. Profile attribution across other DZN surfaces remains a separate approval slice.
