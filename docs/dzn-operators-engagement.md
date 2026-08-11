# DZN Operators Phase 2 Engagement

## Purpose

DZN Operators Phase 2 adds a daily return loop for the Phase 1 cosmetic identity platform. Players can check in, complete daily, weekly, seasonal and server community challenges, earn Operator XP, climb fixed DZN ranks, claim visible rewards, and browse player/server Operator pages.

The system is presentation and identity only. It does not alter competition outcomes.

## Feature Flags

- `NEXT_PUBLIC_DZN_OPERATORS_ENABLED` must be exactly `true` for Operators routes.
- `NEXT_PUBLIC_DZN_OPERATORS_DEMO_MODE` must be exactly `true` for browser preview persistence and demo controls.
- `NEXT_PUBLIC_DZN_OPERATORS_ENGAGEMENT_ENABLED` must be exactly `true` for engagement routes and engagement navigation.

All flags default to false when absent. This phase does not create or update any environment variable, secret, workflow, or production setting.

## Challenge Categories

Phase 2 defines four challenge categories:

- Daily challenges.
- Weekly challenges.
- Seasonal challenges.
- Server community challenges.

Website metrics can be simulated in demo mode. ADM, event-platform, and server-aggregate metrics are adapter-ready definitions only and use seeded preview progress. Browser data is never presented as verified ADM telemetry.

## Metrics

The challenge catalog uses stable metric keys aligned to existing DZN systems:

- `operator_daily_check_in`
- `operators_page_visit`
- `character_studio_visit`
- `operator_profile_view`
- `operator_leaderboard_view`
- `confirmed_kills`
- `confirmed_deaths`
- `longest_kill_m`
- `distance_travelled_m`
- `on_foot_distance_m`
- `explored_cells`
- `server_session_minutes`
- `event_entries`
- `event_completions`
- `event_wins`
- `pvp_encounters`
- `server_community_kills`
- `server_community_distance_m`
- `server_community_event_entries`

## XP And Ranks

Operator XP is deterministic and cannot become negative. Completed challenges award XP once. Duplicate event IDs are ignored. Premium users do not receive XP multipliers, easier targets, extra rerolls, streak protection, or boosted leaderboard scoring.

The original DZN rank ladder is:

1. Recruit
2. Scout
3. Tracker
4. Pathfinder
5. Vanguard
6. Warden
7. Sentinel
8. Commander
9. Elite Commander
10. Network Champion
11. Network Legend
12. DZN Icon

Every rank has a stable ID, increasing XP threshold, accessible icon treatment, and a fixed known cosmetic or identity reward.

## Streak Rules

The daily streak is based on UTC calendar days.

- Daily reset is 00:00 UTC.
- Weekly reset is Monday 00:00 UTC.
- Seasonal reset uses the configured season boundary.
- Same-day check-in is idempotent.
- One missed UTC day resets the visible streak safely.
- Day 7 has the strongest fixed cosmetic reward and no gameplay advantage.
- There is no paid streak freeze or paid streak protection.

A future server-authoritative Europe/London option can be reviewed separately, but Phase 2 intentionally avoids adding a timezone library.

## Rewards

Rewards are fixed, visible before completion, and cosmetic or identity-only:

- DZN Reward Pack
- DZN Field Pack
- DZN Operator Reward
- DZN Spotlight
- DZN Rank Reward

There is no random drop table, no probability field, no reward odds, no loot box, no spin wheel, no gambling, no paid XP, no paid challenge skip, and no monetary prize.

## Leaderboards

Phase 2 includes preview leaderboards for:

- Weekly
- Monthly
- Seasonal
- All time

Leaderboards use deterministic stable sorting. Ties are resolved by display name and stable ID. The DZN Spotlight copy is presentation only and has no competitive advantage.

## Player Operator Pages

The player page is static-export safe and uses query parameters:

`/operators/player?id=rafael`

It exposes public Operator identity, rank, XP, streak, achievements, public aggregate combat/travel/exploration summaries, and linked public server context.

It must not expose:

- Raw coordinates.
- Private Discord IDs.
- Internal database IDs.
- Session metadata.
- Authentication metadata.

Unknown player IDs return a safe unavailable state.

## Server Community Pages

The server dashboard is static-export safe and uses query parameters:

`/operators/server?slug=pandora-dayz`

It is read-only in Phase 2 and shows public aggregate server community progress, community challenges, active Operator counts, top community Operators, and fixed community rewards.

It does not include:

- Server-owner challenge creation.
- Server-owner reward editing.
- Arbitrary XP grants.
- Manual leaderboard manipulation.
- Production write APIs.
- Owner authentication mutation.
- D1 writes.

Future server-authoritative owner controls require a separate authorization review.

## Demo Persistence

Demo engagement persistence uses:

`dzn:operators:engagement:demo:v1`

Only when demo mode is enabled. The state includes:

- `version`
- `note="preview_only_non_authoritative"`
- player selection
- XP
- challenge progress
- completed challenge IDs
- claimed reward IDs
- daily streak
- recent activity
- selected leaderboard period
- server community preview state
- processed demo event IDs

Malformed data resets safely. Unknown challenge IDs and reward IDs are ignored. Recent activity is bounded. Browser storage never represents a real purchase, real subscription, real ADM verification, or authoritative leaderboard standing.

## Future D1 Tables

No migration is included in Phase 2 and no D1 table is created. Future reviewed phases may propose:

- `operator_progression`
- `operator_challenge_progress`
- `operator_reward_claims`
- `operator_daily_streaks`
- `operator_engagement_events`
- `operator_leaderboard_snapshots`
- `operator_community_challenges`
- `operator_community_progress`
- `operator_achievements`

## Future API Concepts

No API write is implemented in this phase. Future concepts only:

- `GET /api/operators/engagement/me`
- `GET /api/operators/challenges`
- `POST /api/operators/challenges/:challengeId/claim`
- `POST /api/operators/check-in`
- `GET /api/operators/leaderboards`
- `GET /api/operators/players/:playerRef`
- `GET /api/operators/servers/:serverRef`
- `GET /api/operators/servers/:serverRef/community-challenges`

Verified challenge progress must later be calculated server-side. ADM and event metrics require trusted source-event attribution. Claim operations require authentication and idempotency.

## Fairness Guarantee

Free and premium users have identical challenge eligibility, challenge targets, XP earning rate, XP rewards, leaderboard scoring, rank thresholds, streak rules, reset schedules, competition access, voting rights, tournament access, event access, ranking rules, and matchmaking rules.

Premium may only affect cosmetic presentation already permitted by Phase 1.
