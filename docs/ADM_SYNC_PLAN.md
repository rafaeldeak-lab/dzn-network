# ADM Sync Plan

This is a planning note for the ADM sync engine.

## Phase 1 Implemented

- D1 schema for sync cursors, raw ADM events, parsed player events, kill events, player profiles, and server counters.
- ADM parser helper for real DayZ console ADM line shapes.
- Sync state helper that records `read_pending` when ADM files are discovered but not readable through the current Nitrado API path.
- Owner-only manual sync endpoint.
- Owner dashboard sync card with safe counters and manual sync action.

## Phase 2 Implemented

- Parsed ADM lines are persisted into owner-only raw event, player event, and credited kill tables.
- Manual sync uses `adm_sync_state` as the cursor and skips lines already processed for the same ADM file.
- New ADM files reset the line cursor so processing starts from the beginning of the new file.
- Event row IDs are deterministic per linked server, ADM file, and line number so repeated manual sync runs do not duplicate rows or counters.
- Player profiles are upserted by `player_id` when present, then by player name as a fallback.
- Server counters now update from real parsed events: credited PvP kills, deaths, joins, disconnects, unique players, and last event time.
- The owner dashboard reads `/api/sync/status` and `/api/sync/recent-events` for live sync counters and recent synced activity.
- Mock Nitrado mode runs representative ADM lines through the same parser and sync path as real data.

## Phase 3 Implemented

- `workers/adm-sync-worker.ts` runs the shared ADM sync helper from a standalone Cloudflare Worker.
- The Worker cron trigger is configured in `wrangler.adm-sync.toml` as `*/5 * * * *`, so scheduled sync is intended to run every five minutes.
- Scheduled runs process up to 10 eligible live linked servers per invocation.
- Each scheduled server sync processes up to 1,000 new ADM lines per run.
- Servers synced less than two minutes ago are skipped to avoid duplicate work and unnecessary Nitrado API calls.
- Each server sync is isolated so one failed server does not stop the rest of the scheduled run.
- Manual and scheduled sync executions are recorded in `sync_runs` for owner dashboard visibility.
- The dashboard shows last scheduled sync, last manual sync, last trigger type, and the last five safe sync run records.

Future scale plan:

- Use Cloudflare Queues to enqueue one sync job per linked server when the network grows.
- Batch queue messages by server and process them with backoff/retry controls.
- Keep Workers Cron as the scheduler that discovers eligible servers and pushes queue messages.
- Keep parser and D1 write logic in the shared sync helper so manual, scheduled, and queued execution remain consistent.

## Real Nitrado Log Access Investigation

Owner-only diagnostics are available through `GET /api/nitrado/log-access-diagnostics` and the dashboard `Run Log Access Diagnostics` button.

Tested Nitrado routes:

- `GET /services/{serviceId}/gameservers`
- `GET /services/{serviceId}/gameservers/admin_logs`
- `GET /services/{serviceId}/gameservers/admin_logs?limit=100`
- `GET /services/{serviceId}/gameservers/admin_logs?count=100`
- `GET /services/{serviceId}/gameservers/logs`
- `GET /services/{serviceId}/gameservers/logs/admin`
- `GET /services/{serviceId}/gameservers/file_server/list?dir=/`
- `GET /services/{serviceId}/gameservers/file_server/list?dir=dayzps/config`
- `GET /services/{serviceId}/gameservers/file_server/list?dir=/dayzps/config`
- `GET /services/{serviceId}/gameservers/file_server/download?file={encodedPath}`
- `GET /services/{serviceId}/gameservers/file_server/seek?file={encodedPath}&offset=0&length=4096`
- `GET /services/{serviceId}/gameservers/file_server/stat?files[]={encodedPath}`

The diagnostics return only safe response shape data: status, content type, JSON keys, array lengths, log-text detection, ADM filename detection, and token-field presence. They never return Nitrado tokens, download token URLs/values, FTP/MySQL credentials, raw ADM lines, or secrets.

Manual sync now asks the shared `getReadableAdmLinesForLinkedServer()` helper for readable ADM lines first. The helper decrypts the linked server's stored Nitrado token server-side, uses the linked service ID, and runs the same route probes as diagnostics. If `admin_logs` returns content, it becomes the preferred sync source. If file download or seek returns content, that path becomes the source. If no route returns content, sync remains `read_pending` with the message that ADM files are visible but file contents are unavailable through the tested Nitrado API routes.

Owner-only cleanup is available through `POST /api/sync/clear-test-data`. It removes old mock sync rows for `MockSurvivor`, `MockBandit`, and `MockRunner` from sync/event/profile/stat tables for the current linked server only. It does not delete linked server config, Discord data, Nitrado connections, or encrypted tokens.

## Supported ADM Event Types

- `admin_log_started`
- `player_connecting`
- `player_connected`
- `player_disconnected`
- `player_killed`
- `player_hit`
- `player_hit_explosion`
- `player_hit_unknown_attacker`
- `player_killed_environment`
- `player_unconscious`
- `player_regained_consciousness`
- `player_suicide`
- `player_died_stats`
- `player_performed_action`
- `playerlist_snapshot`
- `playerlist_delimiter`
- `playerlist_entry`
- `player_choosing_respawn`
- `player_placed_object`
- `plain_player_state`
- `unknown`

## Counting Rules

- Credited PvP kills are created only from ADM lines containing `killed by Player`.
- `hit by Player` lines are damage telemetry only. They do not increment kills or deaths, even when HP is `0`.
- Grenade, flashbang, and other non-player `killed by` lines are environment deaths. They increment victim deaths but do not credit a killer.
- Suicide lines increment deaths and suicides for the player.
- `died. Stats>` lines are stored, but death counting is skipped when a matching suicide, player kill, or environment death has already been recorded for that player in the same short line window.
- PlayerList snapshots update player presence/last-seen state only. They do not create joins, deaths, or kills.

## Parser Behavior

- PlayerList context is maintained in batch parsing so plain `Player "..."` lines inside a PlayerList block become `playerlist_entry`.
- Plain player state lines outside a PlayerList block are classified as `plain_player_state`.
- Absurd, infinite, NaN, or out-of-range coordinates are discarded as `null` while preserving the raw line.
- Unknown or malformed lines return `unknown` and never throw.
- Player IDs and raw ADM lines remain owner-only until a privacy review is completed.

## Future Parser TODO

- Add grenade attribution correlation only when a safe, defensible attacker correlation window exists.
- Add richer damage analytics after storage and privacy rules are final.
- Add public player profile projection that hides private player identifiers.

## Next Worker Scope

- Queue-backed sync fanout once server count grows beyond simple cron limits.
- Leaderboard calculations.
- Player profile pages.
- Public stat surfacing after privacy review.
- Damage analytics.
- Grenade attribution correlation.

## Safety Notes

- Never expose Nitrado tokens, encrypted tokens, token IV/auth tags, FTP credentials, MySQL credentials, Discord OAuth tokens, session tokens, or secrets.
- Read Nitrado files server-side only.
- Store sync cursors separately from public server data.
- Treat parser errors as recoverable and keep the server listing live.
