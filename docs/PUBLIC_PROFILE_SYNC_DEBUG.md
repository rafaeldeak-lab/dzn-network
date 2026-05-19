# Public Profile Sync Debug

This file traces the current public profile path for:

`/servers/profile?slug=pandora-dayz`

## Route And Data Flow

The public profile page is a client-rendered shell:

- `app/servers/profile/page.tsx` renders `PublicNetwork`.
- `components/network/public-network.tsx` reads the `slug` query parameter and fetches:
  - `GET /api/public/servers?slug=pandora-dayz`
  - fetch options include `cache: "no-store"` and `credentials: "include"`.
- `functions/api/public/servers.ts` builds the public profile payload.

The slug endpoint reads from these tables:

- `linked_servers`
- `discord_guilds`
- `server_log_config`
- `onboarding_checks`
- `adm_sync_state`
- `server_stats`
- `server_advertising_state`
- `server_public_cache`
- `kill_events`
- `player_events`
- `sync_runs`

## Public Profile Fields

Player/status fields come from `server_public_cache` first and fall back to `linked_servers`:

- `current_players`: `server_public_cache.current_player_count`, fallback `linked_servers.current_players`
- `max_players`: `server_public_cache.max_player_count`, fallback `linked_servers.max_players`
- `server_status`: `server_public_cache.server_status`, fallback `linked_servers.server_status`
- `is_online`: `server_public_cache.server_online`, fallback `linked_servers.is_online`
- `metadata_last_checked_at`: `server_public_cache.last_status_update_at`, fallback `linked_servers.metadata_last_checked_at`

Kill/death/stat fields are read from event/stat tables:

- PvP kills: `COUNT(*) FROM kill_events`
- Deaths: `COUNT(*) FROM kill_events WHERE victim_name IS NOT NULL`
- Joins/disconnects/unique players: `server_stats`
- Top players: `getPublicServerLeaderboardById`, which reads `kill_events`/`player_profiles` scoped by linked server id.

The public profile `last_sync_at` now uses the freshest timestamp from:

- latest successful `sync_runs`
- `adm_sync_state.last_sync_at`
- `linked_servers.metadata_last_checked_at`
- `linked_servers.player_count_last_checked_at`
- `server_stats.updated_at`
- `server_public_cache.last_status_update_at` through the public metadata field

This prevents fresh metadata/player checks from being hidden by an older ADM timestamp.

## Cache Headers

`/api/public/servers` uses `publicAccessCacheHeaders(viewerLoggedIn)`:

- logged-in viewers: `private, no-store, no-cache, must-revalidate` and `Vary: Cookie`
- logged-out viewers: `public, max-age=15, s-maxage=30, stale-while-revalidate=60` and `Vary: Cookie`

The client fetch also uses `cache: "no-store"`, so a profile should not stay stale for days because of browser caching.

## Production Finding For Pandora

Remote D1 inspection for `pandora-dayz` showed:

- `plan_key`: `partner`
- `subscription_status`: `active`
- `current_players`: `2`
- `max_players`: `22`
- `metadata_last_checked_at`: `2026-05-19T14:18:12.368Z`
- `server_public_cache.last_status_update_at`: `2026-05-19T14:18:12.368Z`
- `server_public_cache.updated_at`: `2026-05-19T19:50:14.700Z`
- `adm_sync_state.last_sync_at`: `2026-05-18T10:23:50.692Z`
- `adm_sync_state.last_sync_status`: `adm_file_unreadable`
- `server_sync_state.currently_syncing_adm`: `1`

`automation_cron_runs` only showed manual ADM records and no `cloudflare` or `github-backup` check-ins. That means the production automation trigger was not recording runs against the live app. If cron is running but not writing records, the Worker/secret/app URL path needs to be checked. If cron is not running, deploy or enable the Worker cron and GitHub backup.

## Why The Public Page Could Show `Last sync 2d ago`

Before this fix, public profile `last_sync_at` came only from:

- latest successful `sync_runs`
- `adm_sync_state.last_sync_at`

So if ADM was delayed/unreadable or stuck but metadata had refreshed, the public profile could still display an old ADM date as the page-level “Last sync”. The page looked stale even when `server_public_cache` had more recent status data.

There is also a real automation signal: Pandora had no recent Cloudflare/GitHub cron check-ins in `automation_cron_runs`, so status/ADM automation was not being proven by the production database.

## New Diagnostics

Owner/admin endpoint:

`GET /api/servers/[serverId]/public-cache/debug`

Returns:

- linked server identifiers and public slug
- plan/subscription status
- `linked_servers`, `server_sync_state`, `server_public_cache`, `server_stats`, `server_subscriptions`, `adm_sync_state`
- latest kill/player event summaries
- metadata/ADM/public cache timestamp comparison
- public cache staleness minutes
- plan due-state for status, ADM discovery, and ADM processing
- cron check-ins for metadata, ADM, Discord posts, Cloudflare, and GitHub backup
- problem flags such as:
  - `public_cache_missing`
  - `public_cache_stale`
  - `metadata_newer_than_public_cache`
  - `adm_newer_than_public_cache`
  - `status_lock_stuck`
  - `adm_lock_stuck`
  - `no_automation_cron_checkins`

Manual recovery endpoint:

`POST /api/servers/[serverId]/public-cache/rebuild`

Rebuilds `server_public_cache` from current linked server, stats, and ADM state. It does not wipe stats or events.

## Dashboard

Sync Health now has a `Public Profile Cache` panel with:

- cache freshness
- metadata/ADM timestamps
- problem flags
- `Rebuild Public Cache Now`
- collapsed diagnostics for cron and plan due-state

Automation Health now includes per-server due diagnostics so a paid server can show whether it is due, not due, locked, missing Nitrado, or blocked by subscription state.
