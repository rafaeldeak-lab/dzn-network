# DZN Visual Loadout System

Visual loadouts let a server owner choose how earned DZN visuals appear on public server cards and public server profiles. The system uses existing badge, reputation, crown, seasonal, and plan visuals; it does not let owners create fake achievements or change competitive ranking.

## What A Loadout Controls

A visual loadout can store:

- showcase badge order
- profile frame
- theme banner
- animation preference

Public APIs resolve the saved loadout before rendering. If the saved value is missing, stale, or no longer allowed by the server plan, the public UI falls back to the automatic strongest visual set.

## Plan Limits

- Starter: up to 3 showcase badges, default frame, default theme, static presentation.
- Pro: up to 5 showcase badges, earned reputation frames, standard themes, static presentation.
- Premium: up to 8 showcase badges, premium frames, premium themes, animated presentation.

Legacy `network` and `partner` plan keys map to Premium for compatibility.

## Badge Showcase Rules

Owners can only select badges the server has earned. Protected rewards such as crowns, founder badges, seasonal champions, and event champion badges are selectable only after the award exists in `server_badge_awards`.

If a saved badge list contains unearned or invalid badge codes, public rendering ignores those codes and uses the automatic showcase fallback.

## Frame Rules

Frames are resolved through the plan-safe frame list:

- Starter can use the default bronze frame.
- Pro can use reputation frames that match earned reputation badges.
- Premium can use all configured frames, including animated premium styles.

If a saved frame is no longer available, public rendering uses the plan/reputation fallback frame.

## Theme Rules

Themes are resolved through the plan-safe theme list:

- Starter uses the default apocalypse theme.
- Pro can use standard themes.
- Premium can use all configured themes.

If a saved theme is invalid or locked by plan, public rendering falls back to the automatic theme banner.

## Animation Rules

Animations are allowed for Premium loadouts only. Badge and frame components also respect `prefers-reduced-motion`; users who prefer reduced motion receive static or heavily subdued visual treatment.

## Public Display Behaviour

Public server cards show a compact version of the selected showcase, selected profile frame, and plan-safe card styling. Mobile cards hide overflow badge chips after the compact visible set to avoid wrapping clutter.

Public server profile headers show the selected theme banner, selected frame, and selected showcase first. The full earned badge collection remains available below where the profile already renders achievements.

Premium visuals are presentation only. They must not alter kills, deaths, score, rank, leaderboard placement, ADM sync, or competitive scoring.

## Owner Dashboard Behaviour

The Server Settings visual loadout section shows:

- public card preview
- profile header preview
- earned badge selector
- locked badge previews
- frame selector
- theme selector
- animation selector
- plan limits
- save status

Owners cannot grant protected badges, crowns, founder rewards, seasonal wins, premium visuals, or unavailable frames/themes through this UI.

## Fallback Behaviour

Fallbacks are intentionally conservative:

- missing loadout: automatic strongest badges, automatic frame, automatic theme
- invalid badges: automatic strongest badges
- unavailable frame: plan/reputation fallback frame
- unavailable theme: automatic/default theme
- non-Premium animation: static output

The public resolver reads saved loadouts without running schema changes on public list requests. If the loadout table is unavailable, public pages keep rendering with automatic visuals.

## Why Custom Uploads Are Not Enabled Yet

Custom image uploads are not enabled because they need moderation, file scanning, asset size controls, ownership checks, storage lifecycle rules, and abuse prevention. The current system uses curated SVG assets and manifests so every public visual is predictable, accessible, and safe to cache.

## Future Phase 5E: Custom Upload Plan

Phase 5E can add custom uploads after the safety model is designed. It should include:

- admin-reviewed upload policy
- allowed file types and size limits
- image optimization pipeline
- virus/malware scanning
- explicit owner permissions
- per-plan upload limits
- audit logs for upload and removal
- fallback to curated assets when custom assets fail

Custom uploads must remain cosmetic only and must not affect ADM tracking, public stats, competitive ranking, or leaderboard calculations.
