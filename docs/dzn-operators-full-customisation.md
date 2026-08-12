# DZN Operators Full Customisation

## Product Goal

DZN Operators Phase 3 replaces the abstract placeholder avatar with an original procedural tactical Operator platform. The Studio is designed for character identity, wardrobe, weapon presentation, powers, loadouts, Operator Cards, player pages, server pages, and mobile use while preserving the Phase 1 and Phase 2 fairness rules.

The full Studio is gated by:

- `NEXT_PUBLIC_DZN_OPERATORS_ENABLED`
- `NEXT_PUBLIC_DZN_OPERATORS_ENGAGEMENT_ENABLED`
- `NEXT_PUBLIC_DZN_OPERATORS_DEMO_MODE`
- `NEXT_PUBLIC_DZN_OPERATORS_FULL_STUDIO_ENABLED`

`NEXT_PUBLIC_DZN_OPERATORS_FULL_STUDIO_ENABLED` defaults to false and must equal exactly `"true"` before the full customisation UI is shown.

## Procedural 3D Architecture

The Operator is generated from local procedural geometry. No downloaded model, external image URL, copied game screenshot, Call of Duty asset, DayZ artwork, or third-party character file is used.

The client-only renderer uses Three.js with:

- `THREE.Scene`
- `THREE.PerspectiveCamera`
- `THREE.WebGLRenderer`
- ambient, directional, and rim lighting
- a DZN holographic platform
- mouse and touch rotation
- scroll zoom
- camera reset and fixed view controls
- turntable mode
- idle breathing animation
- responsive resizing
- capped device pixel ratio
- page-hidden and offscreen pause behavior
- explicit geometry/material disposal
- reduced-motion handling
- a non-WebGL fallback

The rig exposes reusable groups for pelvis, torso, neck, head, upper arms, forearms, hands, thighs, lower legs, feet, clothing layers, armour layers, equipment attachment points, weapon attachment points, backpack attachment, headgear attachment, face attachment, hair attachment, and emblem attachment.

## Identity Customisation

The Studio supports cosmetic body presets, body sliders, skin tones, face presets, facial sliders, eyes, brows, scars, face paint, hair, facial hair, and hair colours. These values change presentation only. They do not affect speed, health, score, matchmaking, ranking, eligibility, voting, XP, rewards, or competition outcomes.

## Wardrobe And Armour

Wardrobe categories include helmet, face mask, upper body, outerwear, chest plate or tactical vest, gloves, belt, trousers, knee pads, boots, backpack, accessories, patches, and emblems.

Every catalog item has:

- a stable ID
- display name
- description
- category and slot
- rarity
- entitlement
- level requirement
- fixed unlock condition
- compatible body presets
- colour/material metadata
- procedural geometry metadata
- accessibility label
- preview label
- fixed unlock source

## Weapons And Attachments

Weapons are original DZN display items. Families include DZN AR-4 Assault Rifle, DZN Sentinel DMR, DZN Raptor SMG, DZN Vanguard Shotgun, DZN Field LMG, DZN Recon Carbine, DZN Sidearm-9, DZN Heavy Pistol, DZN Tactical Knife, DZN Breach Axe, DZN Survival Blade, and DZN Smoke Canister.

Weapon customisation includes primary and secondary skins, optic, muzzle, stock, magazine, and weapon charm. These are visual identity components only and contain no damage, fire-rate, recoil, accuracy, armour penetration, speed, health, or gameplay-stat field.

## Powers And Perks

Powers and perks are cosmetic identity modules. Examples include Recon Pulse, Field Medic, Pathfinder, Night Operations, Warden Shield, Engineer, Tracker, Survivalist, Vanguard, Community Leader, Event Specialist, and Network Scout.

Powers may influence only aura, idle presentation, profile badge, Operator Card treatment, UI title, or challenge recommendation grouping. They cannot alter XP rate, challenge targets, rewards, leaderboard scoring, event points, eligibility, voting, matchmaking, rankings, or server publicity scoring.

Runtime and focused tests reject prohibited competitive fields in Operator, weapon, mastery, and power data.

## Levels, Unlocks, And Mastery

The Studio reuses the Phase 2 Operator XP and rank framing for preview presentation. Items show level requirements, owned or locked state, exact unlock condition, and fixed reward source.

Operator mastery summarizes total Operator level, rank, XP, next unlock, unlocked item count, and total catalog count. Weapon mastery unlocks cosmetic skins, charms, badges, and titles only. Outfit mastery is a preview-only visual concept. No mastery value changes competition scoring.

## Loadouts

The full loadout includes identity settings, wardrobe selections, weapon selections, attachments, power slots, pose, card frame, background, title, profile accent, and animations.

The local demo loadout system supports:

- create
- rename
- duplicate
- delete
- equip
- reset all
- reset one category
- preview locked items
- save current draft
- discard draft changes
- compare draft to equipped loadout
- apply colour theme
- save up to ten local demo loadouts
- choose featured loadout

The v2 preview key is:

`dzn:operators:studio:demo:v2`

It can safely migrate the Phase 1 key:

`dzn:operators:demo:v1`

It preserves the separate engagement key:

`dzn:operators:engagement:demo:v1`

Malformed state resets safely. Unknown or incompatible item IDs fall back safely. Browser state never represents a purchase, active subscription, production entitlement, verified ADM telemetry, or authoritative progression.

## Operator Cards, Player Pages, And Server Pages

Operator Cards now render the equipped procedural Operator composition, player name, call sign, title, rank emblem, frame, background, pose, primary weapon, selected powers, level, and DZN visual treatment.

Player pages use the equipped loadout for the full-body Operator hero, weapons, powers, rank, XP, featured loadout, challenge progress, achievements, and privacy-safe aggregate stats.

Server pages show read-only community Operator information, top Operators, equipped thumbnails, levels, XP, community challenge progress, fixed rewards, and links to player Operator pages. Server admin quick actions are preview-only and do not mutate production.

## Mobile, Accessibility, And Performance

The Studio uses responsive rails, large tap targets, visible focus rings, labelled buttons, accessible sliders, selected-state text, locked-state text, accessible canvas labelling, progress values, reduced-motion handling, and non-WebGL fallback content.

The renderer is lazy-loaded and client-only. It avoids server-side WebGL access, caps device pixel ratio, pauses when offscreen, and disposes materials and geometry.

## No Photo Upload

Phase 3 does not include photo upload, selfie upload, face scan, camera capture, image recognition, biometric processing, or real-person facial reconstruction. Every face is generated from original DZN presets and sliders.

## No Pay-To-Win

Free competition participation remains unrestricted. Premium and demo presentation may unlock cosmetic controls only. There is no premium XP multiplier, easier challenge target, ranking boost, vote multiplier, matchmaking modifier, event priority, reward odds increase, paid XP, random paid reward, gambling mechanic, or spin wheel.

## Future Data Tables

These tables are design notes only. No migration is included and no D1 table is created in Phase 3.

- `operator_profiles`
- `operator_identity_settings`
- `operator_loadouts`
- `operator_loadout_items`
- `operator_weapon_loadouts`
- `operator_power_slots`
- `operator_unlocks`
- `operator_mastery`
- `operator_equipped_state`

## Future APIs

These APIs are design notes only. No production write API is implemented in Phase 3.

- `GET /api/operators/catalog`
- `GET /api/operators/me`
- `POST /api/operators/loadouts`
- `PUT /api/operators/loadouts/:id`
- `DELETE /api/operators/loadouts/:id`
- `PUT /api/operators/loadouts/:id/equip`
- `GET /api/operators/players/:playerRef`
- `GET /api/operators/servers/:serverRef`

Future persistence must verify authentication, subscription entitlement, unlock ownership, idempotency, and server-side authorization. Production entitlement must never be trusted from browser demo state.

## Phase 3 Boundaries

Phase 3 includes no migration, no D1 write, no production API write, no billing change, no subscription mutation, no workflow change, no deployment, no Discord action, no scheduler action, and no ADM or Nitrado operation.
