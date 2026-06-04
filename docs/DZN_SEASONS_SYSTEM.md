# DZN Seasons System

DZN seasons are time-limited server-vs-server competitions. Servers join a season in their own category, DZN snapshots stored aggregate stats, and season leaderboards rank only entries in that season.

## Category Matching

Season entries are same-category only:

- Deathmatch vs Deathmatch
- PvP vs PvP
- PvE vs PvE
- Survival vs Survival

A server cannot join a season if its stored category does not match the season category.

## Scoring Rules

Phase 7A uses stored aggregate stats from `server_stats` and linked server metadata. It does not read Nitrado, import ADM files, or rewrite leaderboard calculations.

Initial scoring:

- Deathmatch: total kills, K/D, activity
- PvP: total kills, K/D, activity, with longest kill reserved as a safe zero placeholder until available in aggregate season input
- PvE: activity and deaths avoided, with survival time reserved as a safe zero placeholder
- Survival: activity and deaths avoided, with longest lived reserved as a safe zero placeholder

Unavailable metrics are recorded as missing in `metrics_json`; fake stats are never invented.

## Rankings

`refreshSeasonScores` recalculates entry scores from stored aggregates, writes a `dzn_season_score_snapshots` row, and updates entry rank and current snapshot. These ranks are season-specific and do not change public competitive leaderboards.

Phase 7E adds protected refresh automation:

- `POST /api/cron/seasons/refresh` requires the shared DZN cron secret and refreshes active seasons in a small batch.
- `POST /api/admin/seasons/[seasonId]/refresh` requires a DZN admin, support, or dev user and refreshes one season in a small batch.
- `GET /api/admin/seasons` requires a DZN admin, support, or dev user and returns season management summaries grouped by status.

Refresh automation only reads existing stored aggregate stats and writes `dzn_season_score_snapshots` plus `dzn_season_entries` score/rank fields. It does not import ADM files, finalise seasons automatically, or change stored player/stat records.

Phase 7F adds the protected `/dashboard/admin/seasons` panel for DZN admin/support/dev users. The panel lists active, upcoming, and completed seasons with entry counts, last score refresh, stored awards, and guarded actions for score refresh and manual finalisation. Finalisation requires explicit confirmation because it persists seasonal awards and can grant permanent seasonal badges.

Phase 7G adds admin/support/dev create and edit tools:

- `POST /api/admin/seasons` creates a `dzn_seasons` configuration row after validating slug uniqueness, same-category season category, date range, and JSON scoring rules.
- `PUT /api/admin/seasons/[seasonId]` updates allowed season configuration fields, blocks category changes once entries exist, and blocks destructive edits to completed/finalised seasons.

Create/edit tools only write the `dzn_seasons` configuration row. They do not delete entries, awards, or snapshots, and they do not modify ADM files or player/stat records.

## Awards and Badges

`finaliseSeason` completes the season, stores final ranks, writes `dzn_season_awards`, and calls the existing badge award helper for the rank-one seasonal champion badge. Award writes are idempotent through unique season/server/award keys and the existing badge award guard.

Protected finalisation endpoint:

```text
POST /api/admin/seasons/[seasonId]/finalise
```

Only admin/support/dev users can call it. Rank 1 receives the mapped permanent seasonal champion badge when the season name/date maps to a known seasonal badge. Rank 2 and 3 receive persisted season award metadata without granting fake badge codes.

## Stats Read

The season foundation reads:

- `linked_servers` for server identity/category
- `server_stats` for aggregate kills, deaths, joins, disconnects, unique players, and last activity

It does not modify ADM ingestion, Nitrado integration, worker sync logic, player profiles, kill/death/event/session rows, or existing leaderboard rank calculations.
