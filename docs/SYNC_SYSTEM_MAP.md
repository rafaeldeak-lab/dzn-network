# DZN Sync System Map

This document explains the current DZN Network automation pipeline: what each sync does, where it gets data from, how Stripe plans affect cadence, and how Discord auto-posting is updated without spam.

## A. Fast Server Status Sync

Purpose:

- Current player count
- Max slots
- Online/offline state
- Basic Nitrado server status
- Public website player/status cache
- Basic Discord status embeds

Source:

- Nitrado service/server metadata
- Saved Nitrado token/service connection

Plan intervals:

| Plan | Server status checked |
| --- | --- |
| Starter | Every 7 minutes |
| Pro | Every 5 minutes |
| Network | Every 3 minutes |
| Partner | Every 1 minute |

Hard floor:

- Server status must never run faster than every 1 minute.

Flow:

```text
Cloudflare Worker Cron, every minute
-> POST /api/sync/metadata/run
-> functions/_lib/server-metadata.ts
-> get due active/trialing servers from server_sync_state
-> fetch Nitrado metadata
-> update linked_servers current_players / max_players / server_status
-> update server_sync_state status fields
-> update server_public_cache
-> queue basic_status_embed / priority_status_embed when allowed
-> POST /api/sync/discord-posts/run
-> dispatcher edits saved Discord messages
```

Important behavior:

- Explicit `0 / 22` from Nitrado is valid and should overwrite stale values.
- Missing player count keeps the previous known value and marks freshness appropriately.
- Metadata sync is independent of ADM log sync. ADM failure should not block player count/status updates.

## B. ADM / Backend Log Sync

Purpose:

- Kills
- Deaths
- K/D
- Longest kill
- Joins/disconnects
- Build tracking
- Admin logs/alerts
- Event stats
- Leaderboards

Source:

- Nitrado ADM/backend log files.

## ADM Discovery vs ADM Processing

DZN splits ADM work into two phases:

- ADM Discovery checks whether newer ADM files exist and whether the newest file is readable.
- ADM Processing parses readable lines, updates stats/events/cache, and queues Discord posts.

Discovery is intentionally lighter than processing. It can run more often without parsing the full ADM file or posting to Discord.

Sync Health includes **Check ADM Files**, which calls `GET /api/servers/[serverId]/adm-file-discovery/debug`. This owner/admin diagnostic shows the Nitrado service id, username/base paths used, raw `game_specific.log_files` count, file-server fallback list attempts, every ADM candidate DZN saw, parsed filename timestamp, modified time, sort score, seek sample result, full download fallback result, selected read method, and why a newer file was skipped. Tokens and tokenized download URLs are not exposed.

When Nitrado's seek/sample route fails but the normal file download route works, DZN falls back to a full file download for the newest candidate and marks that ADM as readable. Discovery always persists the newest available ADM filename by timestamp even if the file is not readable yet; processing still waits until readable content is available.

If Nitrado `game_specific.log_files` is stale or missing a newer ADM file that is visible through the file browser fallback, DZN reports `nitrado_api_log_files_stale_or_missing` and prefers the newer readable fallback candidate.

Emergency Manual ADM Import:

- Sync Health includes **Manual ADM Import** for owner/admin users when the Nitrado Web UI can display ADM text but DZN cannot download it automatically.
- `POST /api/servers/[serverId]/adm/bulk-import?preview=1` powers **Preview ADM Files**, parsing uploaded files or pasted text without database writes. Files are sorted by parsed ADM filename timestamp so older logs import before newer logs.
- `POST /api/servers/[serverId]/adm/bulk-import?preview=1` remains the multi-file preview endpoint. Real imports no longer use this endpoint because one Worker invocation can hit Cloudflare/D1 request limits.
- `POST /api/servers/[serverId]/adm/import-job` powers **Import ADM Files Now**. The dashboard creates one import job per file, then processes one small line chunk per request until that file completes.
- Each chunk uses the same ADM parser/write helpers as scheduled processing, but expensive final work is deferred. Stats rebuild, public cache update, Discord queue creation, sync-run recording, and Last ADM Import Report are done once after the file's final chunk.
- If a file/chunk fails during a bulk import, successful file results remain visible and the failed file gets a **Retry this file** action. Retrying a whole or partial batch is safe because event dedupe prevents already imported ADM rows from double-counting stats.
- `POST /api/servers/[serverId]/adm/parse-preview` remains available for **Preview Pasted Text Only**, parsing a single pasted ADM text without database writes. It supports both `HH:MM:SS` and `MM:SS` ADM timestamps and shows the first 10 parsed kill previews.
- `POST /api/servers/[serverId]/adm/manual-import` remains available for **Import Pasted Text Only**, accepting one filename plus pasted ADM text and routing it through the same ADM parser/write path as scheduled processing.
- `POST /api/servers/[serverId]/adm/force-latest` powers **Force Process Latest ADM Now**, rediscovering the newest Nitrado ADM and running the real automatic ADM processing path immediately for the selected server.
- Manual paste imports write supported kills/deaths/joins/disconnects/PlayerList snapshots, rebuild server stats, update `server_public_cache`, queue plan-allowed Discord post jobs, and save the Last ADM Import Report. Public cache and Discord queue failures are surfaced as warnings after DB writes instead of hiding parsed/written counts.
- Manual import and preview endpoints always return structured JSON with `ok`, `error_code`, `message`, and `details` on failures so the dashboard can show HTTP status and response body instead of hanging on a generic error.
- Manual paste imports force a full-file reprocess from line 0 but still use existing event dedupe, so pasting the same ADM twice should report duplicate skips and must not double-count stats.
- The dashboard keeps manual import success separate from automatic ADM download state. Automatic download can still show `latest_adm_unreadable`, while Manual ADM Import Result shows the pasted import counts, import id/time, public cache status, Discord queue count, and parser warnings.
- After import, the dashboard explicitly refetches sync status, recent synced events, public-cache diagnostics, automation health, and server data. If that refresh fails, the import result remains visible with a Retry Dashboard Refresh action.
- Sync Health includes a collapsed Manual ADM Imports history based on recent `manual_paste` / `manual_upload` sync runs.
- This does not remove or bypass the automatic Nitrado discovery/download path; it is a recovery path while Nitrado file access is unavailable.

Discovery intervals:

| Plan | ADM discovery checked |
| --- | --- |
| Starter | Every 15 minutes |
| Pro | Every 10 minutes |
| Network | Every 5 minutes |
| Partner | Every 3 minutes |

Processing intervals:

| Plan | ADM data processed |
| --- | --- |
| Starter | Every 60 minutes |
| Pro | Every 30 minutes |
| Network | Every 15 minutes |
| Partner | Every 10 minutes |

Hard floors:

- ADM discovery must never run faster than every 3 minutes.
- ADM/backend logs must never run faster than every 10 minutes.

Nitrado reality:

- ADM logs are not instant.
- After a restart, ADM logs can appear 5-45 minutes later.
- Backend/log updates can be delayed.
- No new ADM file is not fatal.
- Waiting for a new ADM log is not an error.

Flow:

```text
Cloudflare Worker Cron, every minute
-> POST /api/sync/adm/run
-> functions/_lib/adm-sync.ts
-> discovery phase: get due active/trialing servers by next_adm_discovery_due_at
-> fetch/list/sample-read Nitrado ADM files
-> sort ADM files by parsed filename timestamp, falling back to Nitrado modified time
-> update newest available/readable ADM evidence and adm_discovery_status
-> processing phase: get due active/trialing servers by next_adm_pull_due_at
-> skip heavy parsing until a readable ADM is known and processing is due
-> parse only new lines
-> write scoped raw events, player events, kill events, profiles, stats, and build data
-> advance the ADM cursor only after the database write path succeeds
-> update adm_sync_state and server_sync_state
-> update public cache/snapshots where applicable
-> queue Discord post updates allowed by plan
-> dispatcher edits saved Discord messages
```

Important behavior:

- Discovery checks files but does not spam Discord.
- Processing creates stats, events, public cache updates, and Discord post queues.
- Processing also records observed ADM cadence from real ADM lines, especially PlayerList snapshots.
- Sync Health includes a collapsed Last ADM Import Report with raw killed-by lines, parsed PvP kills, written kills, duplicate skips, failed writes, cursor before/after, cursor hash validation, public cache status, and Discord queue count.
- Parser/write failures keep the previous cursor so the next run can retry the same ADM lines safely.
- Duplicate protection includes server/service, ADM source evidence, timestamp, players, weapon, and distance, so repeated separate kills between the same players with the same weapon are not collapsed.
- No new ADM log is recorded as a normal state, not a fatal failure.
- Waiting after restart is recorded as a normal state.
- Readable old stats remain active while waiting.
- DZN must not wipe stats because Nitrado has not published a new file yet.
- Parser/write failures do not advance the cursor.
- Old failed sync rows can be cleared after a later successful sync.

ADM Cursor Hash Validation:

- DZN stores the processed line count plus a SHA-1 hash of the exact last processed ADM line (`line_count:sha1(last_line)`), based on the older Pandora/DayZQuest bot safety pattern.
- On the next processing run, if the same ADM filename is still active, DZN verifies that the saved line still exists and that the line hash matches before trusting the cursor.
- If the hash matches, DZN resumes from the next line.
- If the saved cursor predates this feature and has no hash, DZN allows one legacy cursor pass and upgrades the cursor with a hash after the next successful import.
- If the saved line is out of range, DZN treats it as truncation or rollover, safely reprocesses a recent tail window, and preserves existing stats.
- If the hash mismatches, DZN searches for the old hash elsewhere in the current file. If found, it repositions safely after that line. If not found, it reprocesses a safe tail window and relies on event dedupe.
- Cursor validation warnings are non-fatal unless the actual parser/write path fails. DZN never wipes stats because cursor validation had to recover.

Observed cadence fields:

| Field | Meaning |
| --- | --- |
| `first_adm_after_restart_at` | First ADM file timestamp observed after the last detected restart. |
| `first_adm_after_restart_delay_minutes` | Minutes between detected restart and first observed ADM file. |
| `first_useful_adm_line_after_restart_at` | First parsed useful ADM line after restart. |
| `observed_playerlist_interval_minutes` | Interval between the last two observed PlayerList snapshots. |
| `observed_adm_cadence_minutes` | Best current cadence estimate, preferring PlayerList interval when available. |
| `last_playerlist_at` | Last observed `PlayerList log` timestamp. |
| `last_useful_adm_event_at` | Last parsed useful ADM event timestamp. |
| `newest_adm_file_age_minutes` | Current age of the newest available ADM file, computed for the dashboard. |
| `next_expected_adm_update_at` | Estimated next ADM update time based on observed cadence. |

Dashboard wording examples:

- `Observed ADM cadence: around 5 minutes`
- `Last ADM event: 14:28`
- `Last PlayerList: 14:28`
- `Next expected ADM update: around 14:33`

Reset-aware states:

| State | Meaning |
| --- | --- |
| `waiting_after_restart` | DZN believes the server restarted or no new ADM has been published yet. This is normal. |
| `new_adm_detected` | A newer ADM filename/timestamp has been seen. |
| `new_adm_readable` | A newer ADM file is readable and ready to process. |
| `new_data_found` | New ADM lines were processed into stats/events/cache. |
| `no_new_log_available` | Latest readable ADM has no new lines beyond the saved cursor. |
| `latest_adm_unreadable` | Newest ADM exists but Nitrado is not returning readable content yet. |
| `delayed_after_restart` | A restart was detected and no readable ADM appeared after 45 minutes. This is warning-only. |
| `failed` | Real Nitrado auth/API/parser/write failure. |

Reset detection sources:

- Metadata status can mark a restart-like state when Nitrado reports restarting/starting/stopped/offline.
- ADM filename timestamps can mark a reset when a newer ADM file appears after the previous latest file.
- Manual sync uses the same waiting/unreadable handling, so an owner pressing Run Manual Sync after restart sees a waiting state, not a hard failure.

Tracked ADM evidence:

- `last_seen_adm_filename`
- `last_seen_adm_timestamp`
- `newest_available_adm_filename`
- `newest_available_adm_timestamp`
- `newest_readable_adm_filename`
- `newest_readable_adm_timestamp`
- `last_processed_adm_filename`
- `last_processed_adm_offset`
- `last_processed_adm_line`
- `last_server_restart_at`
- `last_restart_detected_source`
- `last_restart_detected_at`
- `last_adm_discovery_check_at`
- `next_adm_discovery_due_at`
- `last_successful_adm_discovery_at`
- `last_failed_adm_discovery_at`
- `last_adm_discovery_error`
- `adm_discovery_status`

Required Nitrado log settings:

- Admin Log: Enabled
- Server Log: Enabled
- Reduce Log Output: Disabled
- Log Playerlist: Enabled

DZN attempts to verify these automatically using the connected Nitrado token and service. DZN reads the saved checklist state through `GET /api/servers/[serverId]/nitrado-log-settings`. The dashboard only runs a live Nitrado verification when the owner clicks **Check Nitrado Log Settings**, which calls `GET /api/servers/[serverId]/nitrado-log-settings?check=1`. Before a live check runs, unknown values are shown as `Not checked yet` instead of `Needs Change`.

When Nitrado exposes the settings, DZN saves the verification source as `nitrado_api`, stores Admin Log / Server Log values, and auto-confirms the two required checklist items when Reduce Log Output is disabled and Log Playerlist is enabled.

If Nitrado does not expose the exact settings or the token cannot read them, the dashboard falls back to manual confirmation. This is a warning checklist, not a hard setup lock. If they are not confirmed, DZN should show: "ADM tracking may miss useful lines until these Nitrado settings are confirmed."

## C. Discord Auto-Post Dispatcher

Purpose:

- Keep configured Discord embeds/messages updated.
- Edit existing messages when `discord_message_id` exists.
- Send a new message only when there is no saved message or the old message was deleted.
- Avoid spam with payload hashes.

Flow:

```text
Cloudflare Worker Cron, every minute
-> POST /api/sync/discord-posts/run
-> process queued automation_jobs where job_type = discord-post-update
-> scan due saved server_posting_destinations
-> check subscription active/trialing
-> check hasAutoPost(plan_key, post_type)
-> render production payload
-> compare last_payload_hash unless forced
-> bot edit/send first
-> webhook fallback second
-> upsert server_posting_state
```

Posting order:

1. Bot token + stored channel ID.
2. Webhook URL fallback.
3. Skip safely and surface warning/diagnostics.

Spam prevention:

- Scheduled dispatcher can skip `skipped_unchanged`.
- Basic status embeds include `Last checked` / `Updated at`, so Partner status updates can change at the 1-minute cadence when metadata is refreshed.

## D. Run Now

Purpose:

- Manually prove the real dispatcher path works for one server.
- This is not the same as Test.

Flow:

```text
Dashboard -> Run Auto Post Dispatcher Now
-> POST /api/servers/[serverId]/auto-posts/run-now
-> Owner/Admin and active subscription checks
-> dispatchDiscordPostsForGuild(..., force: true)
-> process all enabled saved destinations for this guild
-> render production payloads
-> bypass not-due checks
-> bypass unchanged-hash skip
-> edit existing discord_message_id or send new
-> return per-destination result panel
```

Expected result:

- Test payloads such as `DZN Test - Basic Status` should be replaced by production embeds like `DZN Server Status - Server Name`.
- Result panel should show processed, edited, sent, skipped, failed, message IDs, old/new hashes, and reasons.

## E. Test Post

Purpose:

- Prove DZN can post/edit in a selected channel.
- Save the Discord message ID for future production dispatch.

Flow:

```text
Dashboard -> Test
-> POST /api/servers/[serverId]/posting-destinations
-> action = test
-> sendDiscordTestPost
-> bot first, webhook fallback second
-> recordDiscordPostingDeliveryState
-> server_posting_state key = guild_id + post_type + discord_channel_id
```

Important:

- Test uses a test payload.
- Run Now and scheduled dispatch use production payloads.
- Test and dispatcher must share the same `server_posting_state` key:
  `guild_id`, `post_type`, `discord_channel_id`.

## F. Cloudflare Worker Cron

Primary automation trigger:

- `workers/adm-sync-worker.ts`
- `wrangler.adm-sync.toml`
- Schedule: `* * * * *`

Worker calls:

```text
POST ${DZN_APP_URL}/api/sync/metadata/run
POST ${DZN_APP_URL}/api/sync/adm/run
POST ${DZN_APP_URL}/api/sync/discord-posts/run
```

Security:

- Header: `x-dzn-cron-secret`
- Env var: `DZN_CRON_SECRET`
- `DZN_CRON_SECRET` must be set in both Cloudflare Pages and this Worker. If it is missing from the Worker, scheduled ticks exit before calling the Pages endpoints and no `cloudflare` rows appear in `automation_cron_runs`.

Cron heartbeat:

- Each protected sync endpoint records an `automation_cron_runs` row after auth succeeds.
- Rows include `source`, `job_type`, `started_at`, `finished_at`, `duration_ms`, `processed_count`, `skipped_count`, `failed_count`, `status`, and `error_message`.
- Sync Health shows the latest Cloudflare check-in, GitHub backup check-in, metadata run, ADM run, and Discord dispatcher run.
- `npm run check:cron-production` checks production rows and fails when no Cloudflare row exists in the last 5 minutes.

Important:

- The Worker can run every minute.
- Backend due-state decides which servers are actually due.
- Partner status can run every 1 minute.
- ADM remains limited to 10 minutes minimum.
- The worker should not force every server to sync every minute.

## G. GitHub Actions Backup

Backup trigger:

- `.github/workflows/dzn-adm-sync.yml`
- Schedule: every 5 minutes

Purpose:

- Backup/repair only.
- Cloudflare Worker Cron is primary.

Calls:

```text
POST /api/sync/metadata/run
POST /api/sync/adm/run
POST /api/sync/discord-posts/run
```

Security:

- Header: `x-dzn-cron-secret`
- Secret: GitHub `DZN_CRON_SECRET`

GitHub backup should create `github-backup` source rows in `automation_cron_runs`. If no rows appear for more than 15 minutes, the dashboard warns but Cloudflare remains the primary automation path.

## H. Stripe / Billing Plan Effects

Stripe subscription state controls:

- Feature access
- Status sync interval
- ADM sync interval
- Manual refresh cooldown
- Allowed Discord auto-post types
- Public/partner listing priority

Active/trialing:

- Automation is enabled according to plan.

Past due/canceled/unpaid/incomplete:

- Premium entitlements reduce to locked/free behavior.
- Premium posting should pause.
- Cached/historical data is preserved.

Auto-post limits:

| Plan | Auto-posts |
| --- | --- |
| Starter | Basic Server Status |
| Pro | Basic Server Status, Leaderboards, Daily Summary |
| Network | Pro posts plus Event Leaderboard, Network Ranking, Server-vs-Server Progress |
| Partner | Everything, including feeds, admin posts, partner featured, priority status |

## I. Public Profile Cache

Public server profiles load data through `GET /api/public/servers?slug=...`.

Public profile status fields read from `server_public_cache` first, then fall back to `linked_servers`:

- current player count
- max player count
- online/offline status
- server status
- status last checked timestamp

ADM/stat fields read from the event/stat tables:

- PvP kills and deaths from `kill_events`
- joins, disconnects, and unique players from `server_stats`
- top players from the public leaderboard helpers scoped to the linked server

Metadata/status sync updates `linked_servers`, `server_sync_state`, and `server_public_cache.last_status_update_at`.

ADM processing updates event/stat tables, `server_stats`, `server_public_cache.last_adm_update_at`, and allowed Discord post queues.

The public profile `last_sync_at` uses the freshest real data timestamp from metadata, player-count checks, ADM sync, stats, and sync runs. A delayed ADM run should not make a fresh status check look two days old, and a maintenance-only cache write should not hide a stale sync.

Owner/Admin recovery:

- `GET /api/servers/[serverId]/public-cache/debug`
- `POST /api/servers/[serverId]/public-cache/rebuild`

The debug endpoint compares public cache with linked server metadata, sync state, stats, subscription state, and cron check-ins. The rebuild endpoint safely refreshes `server_public_cache` from current data without wiping stats or events.

## J. Common Failure States

| State | Meaning | Serious? | What to do |
| --- | --- | --- | --- |
| `channel_fetch_unavailable` | Discord channel refresh temporarily failed, often upstream/503. Saved setups can still run. | Usually temporary | Recheck Channels later. Existing saved BOT MODE setups should remain active. |
| `missing_bot_token` | `DISCORD_BOT_TOKEN` is not configured in production. | Yes | Add the secret to Cloudflare Pages. |
| `bot_not_in_guild` | DZN bot is not installed in the selected Discord guild. | Yes for auto-posting | Use Add / Reconnect DZN Bot. |
| `discord_api_403` | Discord rejected channel/guild fetch. | Usually permissions/config | Confirm bot is in the guild and has access. |
| Missing channel permission | Bot can see guild but cannot post in selected channel. | Channel-specific | Give the DZN Bot role View Channel, Send Messages, Embed Links, Read Message History. |
| No new ADM log | Nitrado has not published a newer ADM file. | No | Wait for Nitrado. DZN will keep checking by plan interval. |
| Waiting after restart | Server restarted and ADM log is not available yet. | No unless prolonged | Wait 5-45 minutes after restart. |
| Latest ADM unreadable | Newest ADM exists, but Nitrado has not made file content readable yet. | Usually no | DZN retries next scheduled ADM check and keeps old stats. |
| Delayed after restart | No readable new ADM appeared after 45 minutes from detected restart. | Warning | Wait for Nitrado or run Log Access Diagnostics if it persists. |
| ADM temporarily unavailable | Nitrado route/token/log access failed. | Maybe | Run Log Access Diagnostics. |
| Cron secret failed | Sync endpoint got no/wrong `x-dzn-cron-secret`. | Yes | Make sure Pages, Worker, and GitHub all use matching `DZN_CRON_SECRET`. |
| `skipped_unchanged` | Dispatcher rendered the same payload hash in scheduled mode. | No | Normal spam prevention. Run Now forces an edit for debugging. |
| `skipped_not_due` | Destination was not due yet by plan interval. | No | Wait for interval or use Run Now. |
| `skipped_plan_locked` | Current plan does not allow that post type. | Expected after downgrade | Upgrade plan or remove locked post type. |
| `no_message_state_found_for_destination` | Dispatcher had a destination but no saved message state. | Not fatal | Dispatcher sends a new message and saves its ID. |
| Stuck status lock | Status sync crashed while lock was set. | Recoverable | Automation releases status locks older than 10 minutes using `status_sync_started_at`, so unrelated metadata updates do not hide an old lock. |
| Stuck ADM lock | ADM sync crashed while lock was set. | Recoverable | Automation releases ADM locks older than 30 minutes using `adm_sync_started_at` / `last_adm_pull_at`, so fresh status checks do not make a stale ADM lock look fresh. |

## Current Health Checks

Use:

```bash
npm run audit:system
npm run check:automation-live
npm run test:full-system
```

What these check:

- Source wiring for plans, cron, routes, Discord posting, and dashboard tabs.
- Production public endpoints.
- Cron endpoint auth with and without `x-dzn-cron-secret`.
- Automation health route access protection.

If `check:automation-live` skips secret-authenticated checks, set `DZN_CRON_SECRET` in the local shell before running it.
