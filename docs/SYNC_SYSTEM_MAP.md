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
-> write scoped stats/events/build data
-> update adm_sync_state and server_sync_state
-> update public cache/snapshots where applicable
-> queue Discord post updates allowed by plan
-> dispatcher edits saved Discord messages
```

Important behavior:

- Discovery checks files but does not spam Discord.
- Processing creates stats, events, public cache updates, and Discord post queues.
- Processing also records observed ADM cadence from real ADM lines, especially PlayerList snapshots.
- No new ADM log is recorded as a normal state, not a fatal failure.
- Waiting after restart is recorded as a normal state.
- Readable old stats remain active while waiting.
- DZN must not wipe stats because Nitrado has not published a new file yet.
- Parser/write failures do not advance the cursor.
- Old failed sync rows can be cleared after a later successful sync.

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

## I. Common Failure States

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
| Stuck status lock | Status sync crashed while lock was set. | Recoverable | Automation releases status locks older than 10 minutes. |
| Stuck ADM lock | ADM sync crashed while lock was set. | Recoverable | Automation releases ADM locks older than 30 minutes. |

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
