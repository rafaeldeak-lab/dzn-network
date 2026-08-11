# DZN Operators Foundation

## Product Concept

DZN Operators is a premium cosmetic character platform for original DZN player identity. The identity can eventually appear across profiles, player-vs-player competitions, server-vs-server competitions, seasons, contracts, events, tournaments, leaderboards, and winner spotlights.

Phase 1 adds only the frontend and domain foundation. It does not change competition scoring, event administration, player attribution, production subscriptions, billing, or production data.

## Free Entitlement

Free users retain full competition participation, public statistics, normal leaderboards, voting rights, core progression, badges, trophies, normal contracts, and one standard/default DZN operator identity.

The free identity includes one starter colourway, one basic pose, one basic frame, and one basic background. Free users cannot create a custom operator, save a custom loadout, equip premium cosmetics, display a custom premium operator, or bypass entitlement checks.

## Premium Entitlement

Premium users may build custom operators, save multiple cosmetic loadouts, equip premium clothing and gear, use premium poses, use premium frames, use premium profile backgrounds, use entrance and victory animations, and use additional Operator Card showcase slots.

Premium cosmetics are presentation only. They never affect competition score, K/D, event points, eligibility, voting power, rankings, seeding, tournament slots, server enrolment priority, matchmaking, win probability, reward probability, telemetry, verification confidence, score multipliers, or server publicity scoring.

## Fairness Rules

DZN Operators must never include paid random loot boxes, gambling mechanics, random paid rewards, stat boosts, gameplay advantages, pay-to-win mechanics, or adverts. Cosmetics are identity and presentation only.

The runtime operator assertion rejects prohibited competitive keys in serialized operator data, including score, damage, health, protection, speed, ranking, matchmaking, voting, reward, and win-chance modifiers.

## Character Slots

The Phase 1 model supports:

- head
- face
- hair
- upper_body
- lower_body
- outerwear
- hands
- feet
- back
- armour
- utility
- accessories
- pose
- background
- frame
- entrance_animation
- victory_animation

Every slot has a deterministic starter fallback.

## Catalog Structure

Every catalog item includes a stable ID, display name, slot, rarity or presentation tier, free or premium entitlement, compatible operator IDs, optional season or event label, preview metadata, and an accessibility label.

Catalog items do not include gameplay statistics or competitive modifiers.

## Loadout Validation

The pure loadout functions are:

- `getDefaultOperatorLoadout()`
- `getOperatorEntitlements(planTier)`
- `canUseOperatorItem(planTier, item)`
- `validateOperatorLoadout(planTier, loadout, catalog)`
- `sanitizeOperatorLoadout(planTier, loadout, catalog)`
- `buildOperatorCardPresentation(loadout, catalog)`

Free loadouts sanitize to the standard DZN operator. Premium loadouts may use compatible premium items. Unknown items, incompatible slots, and missing starter slots fail safely by reporting validation issues and falling back to starter selections during sanitization.

Production save and equip APIs must recheck subscription entitlement server-side. Client plan state and demo state are never authoritative.

## Feature Flags

Frontend flags:

- `NEXT_PUBLIC_DZN_OPERATORS_ENABLED`
- `NEXT_PUBLIC_DZN_OPERATORS_DEMO_MODE`

Both default to false when absent. The navigation entry is exposed only when `NEXT_PUBLIC_DZN_OPERATORS_ENABLED` is exactly `"true"`. Premium demo switching exists only when `NEXT_PUBLIC_DZN_OPERATORS_DEMO_MODE` is exactly `"true"`.

No environment variable, secret, or production variable is created by Phase 1.

## Preview-Only Persistence

The Character Studio stores preview loadouts in localStorage only when demo mode is enabled, using:

`dzn:operators:demo:v1`

The stored payload includes the marker `preview_only_non_authoritative`. It never represents a purchase, a subscription, or an authoritative entitlement. Malformed storage resets safely to the default operator.

## Accessibility And Original Art

Phase 1 uses original DZN names, CSS geometry, gradients, and permitted icon components. It does not use Call of Duty operators, Fortnite skins, Apex Legends characters, DayZ official character artwork, protected third-party character designs, third-party game screenshots, external image downloads, or copyrighted game assets.

Interactive controls use buttons, visible focus rings, locked-item descriptions, reduced-motion compatible visual treatment, and responsive layouts.

## Future Integration Surfaces

Future surfaces can display DZN Operator identity in:

- player profiles
- event rosters
- tournament brackets
- seasonal winner spotlights
- leaderboards
- contract pages
- public competition recaps

Display integration must remain cosmetic and must not change scoring, eligibility, rankings, or rewards.

## Future D1 Tables

No migration is included in Phase 1. No D1 table is created.

Future reviewed phases may propose:

- `operator_profiles`
- `operator_loadouts`
- `operator_cosmetic_items`
- `operator_unlocks`
- `operator_entitlements`
- `operator_showcase_slots`
- `operator_mastery_progress`

## Future API Concepts

Phase 1 does not implement read/write APIs. Future reviewed API concepts:

- `GET /api/operators/catalog`
- `GET /api/operators/me`
- `POST /api/operators/loadouts`
- `PUT /api/operators/loadouts/:id/equip`

Future D1 and API implementation requires a separate reviewed phase with server-authoritative entitlement checks. No billing API is changed in Phase 1, and production entitlement must never be trusted from the browser.
