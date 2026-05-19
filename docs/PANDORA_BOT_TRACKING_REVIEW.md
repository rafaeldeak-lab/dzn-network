# Pandora Bot / DayZQuest ADM Tracking Review

Reviewed old project path:

`C:\Users\rafae\OneDrive\Desktop\Pandora Bot`

This review compares the old working Pandora Bot / DayZQuest Bot ADM tracking path against the current DZN Network ADM system. The old code was inspected read-only. No old secrets, Discord posting loops, token handling, or hardcoded IDs were copied into DZN.

## Relevant Old Bot Files

- `pandora_bot/nitrado.py`
  - Nitrado API client.
  - Reads `/services/{service_id}/gameservers`.
  - Uses `game_specific.log_files` to find `.ADM` files.
  - Downloads the active ADM via `gameservers/file_server/download`.

- `pandora_bot/discord_bot.py`
  - Main background polling loop and ADM import logic.
  - Contains plan-scaled polling, rollover detection, line cursor handling, raw log archiving, parser dispatch, quest/stat updates, and Discord embed updates.

- `pandora_bot/log_parser.py`
  - Main line parser used by the Discord bot.
  - Parses PvP kills, joins/leaves, PlayerList position rows, emotes, placed objects, hit lines, unconscious lines, and position updates.

- `pandora_bot/db.py`
  - SQLite persistence for guilds and Nitrado services.
  - Stores `last_adm_file` and `last_line_hash`.

- `pandora_bot/web_server.py`
  - Dashboard/API layer.
  - Includes a web-only live snapshot path that fetches the latest ADM directly and parses a tail window for dashboard display.
  - Has fallback parsing for PlayerList count, joins, leaves, position rows, and placed objects.

- `questpacks/PandoraBot_Full_ConsoleQuestPack_100.json`
  - Stores parser regex patterns for PvP kills, victim extraction, hit lines, and quest objective metadata.

- `pandora.js`
  - Dashboard frontend cache/poll behavior.
  - Rebuilds player online state from parsed logs and PlayerList snapshots.

## Old Bot Nitrado Connection

The old bot stored one Nitrado token per Discord guild in SQLite and one or more service IDs in `nitrado_services`.

The Nitrado client:

1. Called `GET https://api.nitrado.net/services/{service_id}/gameservers`.
2. Read `data.gameserver.game_specific.log_files`.
3. Filtered filenames ending in `.ADM`.
4. Built a file-server path with `data.gameserver.username` when needed.
5. Called `gameservers/file_server/download?file=...` to get a temporary token URL.
6. Downloaded the ADM text from that token URL.

DZN already follows the same broad Nitrado model, but DZN also has linked-server scoping, encrypted token handling, discovery vs processing, subscription gating, import reports, public cache refresh, and automation health.

## How The Old Bot Found The Latest ADM File

`pandora_bot/nitrado.py` used `_score_filename()`:

- Prefer filenames with embedded timestamps matching `YYYY-MM-DD_HH-MM-SS`.
- Sort `.ADM` files by parsed timestamp-ish score.
- Fallback to lowercase basename/path ordering if no timestamp exists.

It did not appear to use Nitrado modified time as a fallback.

DZN currently does better here:

- Parses ADM filename timestamp.
- Falls back to Nitrado modified time when filename parsing fails.
- Tracks newest available ADM separately from newest readable ADM.
- Records newest ADM timestamps in sync state.

## How Often The Old Bot Checked Nitrado

The old bot had a Discord task loop:

`@tasks.loop(seconds=30) async def nitrado_poll_loop(...)`

The loop visited each guild and then applied plan-scaled throttling:

- `NITRADO_POLL_SECONDS` defaulted to `15`.
- Premium used the configured value.
- Pro used about 60% speed.
- Starter used about 20% speed.
- A hard lower bound of 5 seconds existed in `_scaled_interval_seconds`.

This means the old bot could check far more often than DZN's paid ADM processing intervals. That may have made it feel more responsive, especially right after a restart or when new log chunks appeared.

DZN now intentionally separates:

- ADM Discovery: checks whether a new ADM file exists.
- ADM Processing: parses and writes readable ADM data.

DZN package intervals are safer for production and billing, but the old bot's frequent lightweight polling is a useful design precedent.

## Discovery vs Parsing In The Old Bot

The old bot did not have a formal two-phase discovery/processing state machine.

However, it effectively did both in one poll:

1. Fetch latest `.ADM` filename.
2. Download the latest ADM.
3. Compare cursor/file state.
4. Parse only the selected new tail lines.

The web-only dashboard path also fetched the latest ADM and parsed a bounded tail window for display.

DZN now has a cleaner separation:

- Discovery can run more often than processing.
- Discovery updates newest available/readable evidence.
- Processing updates stats/events/cache/posts only when due and safe.

## Restart / New ADM File Handling

The old bot treated a changed filename as an ADM rollover:

- If `prev_file != next_file`, it marked rollover.
- It attempted to fetch and archive the previous full ADM file.
- It archived active raw session buffers.
- It announced/attached a parsed backup in an admin channel.
- It used the new file as the active session.

It also detected restart-like situations when:

- The cursor line count was beyond the current file length.
- The stored cursor hash did not match the stored line number.
- The stored hash could not be found in the same file.

In those cases it processed only the tail of the file rather than replaying the whole file.

DZN already has a richer restart-aware state machine:

- `waiting_after_restart`
- `new_adm_detected`
- `new_adm_readable`
- `latest_adm_unreadable`
- `delayed_after_restart`
- `no_new_log_available`

The old bot's most useful addition is not its polling loop, but its cursor validation using both line count and line hash.

## Cursor / Offset / Processed Lines

Old bot cursor storage:

- `nitrado_services.last_adm_file`
- `nitrado_services.last_line_hash`

`last_line_hash` was encoded as:

`<line_count>:<sha1_of_last_line>`

Cursor behavior:

- First sync anchored at EOF to avoid replaying historical logs.
- Same file with matching line count/hash resumed from that line.
- Legacy hash-only cursor searched backward for the matching hash.
- Cursor ahead of file length meant truncate/rotate/reset.
- Hash mismatch at stored line meant truncate/rotate/edit/reset.
- New file processed a capped tail window.
- Cursor was updated to the last line in the file after processing.

DZN currently stores:

- last processed ADM filename
- last processed line/offset
- newest available/readable ADM evidence
- Last ADM Import Report
- import write report and cursor before/after

DZN is now safer around DB write failure because the new regression test proves the cursor does not advance if DB writes fail. The old bot did not have the same transactional proof; it updated cursor after processing and publishing attempts, but it was mostly in-memory/log dashboard oriented.

Potential DZN improvement from Pandora:

- Add optional `last_processed_adm_line_hash`.
- Validate `last_processed_line` against the stored hash before trusting the cursor.
- If mismatch, enter a reset/truncated-file warning state and process a safe tail or re-evaluate the newest readable file.

## Partial File Handling

Old bot behavior:

- If latest ADM downloaded and contained lines, it processed from cursor/tail.
- It did not explicitly distinguish "latest available" from "latest readable".
- It did not have a 5-45 minute waiting-after-restart state.
- It did not clearly defer cursor advancement on partial uploads if the partial file was readable.

DZN behavior:

- Tracks newest available ADM and newest readable ADM separately.
- Marks `latest_adm_unreadable` if the newest exists but cannot be safely read.
- Marks `waiting_after_restart` and `delayed_after_restart` instead of failing after reset.
- Does not wipe stats when Nitrado is delayed.
- The new import regression asserts cursor is not advanced on failed writes.

## Duplicate Kill Prevention

Old bot duplicate prevention was mostly dashboard-buffer focused:

- `_append_recent_log` deduped only the most recent row using service ID, type, player, details, and time.
- Position rows had extra dedupe rules to avoid PlayerList/position spam.
- It did not persist individual kill events in a normalized DB table.

This was unlikely to collapse repeated kills minutes apart because the timestamp and details differed.

DZN now does better:

- Stores raw events, player events, kill events, stats, and public cache.
- The import regression proves repeated same player/weapon kills from the fixture are not collapsed.
- DZN dedupe includes enough source context through file/line/event data.

## PvP Kill Parsing

Old bot kill regex came from the quest pack:

`killed by Player \"(?<killer>[^\"]+)\".*?\swith\s+(?<weapon>[^\s].*?)\sfrom\s+(?<distance>[0-9.]+)\smeters`

Victim regex:

`Player \"(?<victim>[^\"]+)\"\s+\(DEAD\).*?killed by Player`

This pattern parses the uploaded fixture's 10 PvP kill lines.

DZN's parser also parses all 10 fixture PvP kill lines and additionally captures IDs, positions, `occurredAt`, dead-state hit lines, suicides, death stats, PlayerList snapshots, and cursor/import debug counts.

## Suicide Parsing

Old `log_parser.py` did not parse `committed suicide` as a structured event.

`discord_bot.py` and `web_server.py` have dashboard category/display cases for `SUICIDE`, but the inspected parser path does not produce that event type.

DZN does parse suicides:

- Uploaded fixture: 2 suicides.

## Joins / Disconnects

Old bot parsed:

- `Player "name" ... connected`
- `Player "name" ... disconnected`
- `left`

The web fallback also parsed:

- `has been disconnected`

DZN parses the same core connected/disconnected ADM patterns and stores them as player events/stats.

Small safe DZN review item:

- Confirm DZN handles `has been disconnected` everywhere expected. The current tests cover standard disconnected wording; if production uses more variants, add fixtures.

## PlayerList Parsing

Old parser behavior:

- `log_parser.py` parsed PlayerList individual player rows with `pos=<x,z,y>` as `POSITION` events.
- `web_server.py` fallback parsed `##### PlayerList log: N players` into a `PLAYERLIST` row.
- `pandora.js` used PlayerList snapshots to estimate current online state and avoid stale online state.

DZN behavior:

- Parses PlayerList snapshot count as `playerlist_snapshot`.
- Parses delimiter.
- Parses each playerlist row as `playerlist_entry`.
- Tracks observed PlayerList cadence, last PlayerList timestamp, and next expected ADM update.

DZN already does more than the old bot here.

## Stats / Leaderboards

Old bot primarily applied parsed events to a quest engine:

- Quest assignments.
- Per-player quest progress.
- Admin embed refreshes.
- Recent in-memory dashboard logs.

It did not use the same normalized kill-event/stat/cache model DZN now uses.

DZN now writes:

- raw events
- player events
- kill events
- player profile/stat aggregates
- server stats
- server public cache
- Discord post queues

DZN's current model is better for network leaderboards and public website pages.

## Discord Posting

Old bot:

- Edited one admin embed per player.
- Posted quest milestone/completion messages.
- Optionally posted ADM rollover backups/attachments.
- Posted directly from the Discord bot process.

DZN:

- Uses saved posting destinations.
- Uses bot token + channel ID first, webhook fallback second.
- Saves Discord message IDs.
- Edits existing messages to avoid spam.
- Uses queue/dispatcher and plan-gated post types.

DZN's posting model is more production-safe for multiple servers and paid plans.

## Why The Old Bot May Have Felt More Reliable

The old bot may have appeared to catch ADM changes better because:

1. It polled frequently in a long-running bot process.
2. It checked and parsed in the same loop, so there was no visible discovery/processing gap.
3. It kept recent logs in memory and immediately served them to the dashboard.
4. Its cursor used both line count and hash to detect file truncation/rollover.
5. It processed the tail of a new/changed file instead of waiting for a separate processing interval.

Those are real behavioral differences.

The main DZN risk areas to watch are:

- ADM discovery finds a file but processing is not due yet.
- A file is readable while partially uploaded and a cursor is trusted too early.
- Cursor line number is trusted without validating the line content hash.
- Dashboard or public cache might lag the normalized DB state.

The new DZN import regression and Last ADM Import Report directly address the DB/write/cursor/cache diagnostic part.

## What DZN Already Does Better

DZN has stronger production architecture:

- Stripe plan enforcement.
- Separate metadata status sync vs ADM discovery vs ADM processing.
- Hard floors for ADM safety.
- Reset-aware ADM states.
- Newest available/readable ADM tracking.
- Observed ADM cadence tracking.
- Nitrado log settings verification.
- Cursor does not advance on DB write failure, proven by regression test.
- Normalized DB tables for events/stats/cache.
- Public cache refresh after ADM import.
- Plan-gated Discord queue/dispatcher.
- Bot/webhook posting fallback.
- Automation health and cron secret protection.

## What Should Be Reused

Recommended for future DZN hardening:

1. Cursor hash validation.
   - Store `last_processed_adm_line_hash`.
   - Encode/validate cursor as line number plus hash.
   - If the line at the saved cursor no longer matches, mark file changed/truncated and use reset-aware recovery.

2. Rollover archival diagnostics.
   - Keep a compact archived raw session summary when file changes.
   - DZN does not need Discord attachment backups by default, but a dashboard-only raw-session archive would help debugging.

3. Dashboard fallback display rule.
   - If strict active-file/session filters show no rows immediately after rollover, show newest visible file/session rows with a warning rather than a blank table.

4. PlayerList online-state heuristics.
   - DZN already tracks PlayerList cadence, but Pandora's "latest PlayerList snapshot wins" logic is a useful model for future "online from ADM" views.

## What Should Not Be Reused

Do not reuse:

- Old Discord posting loops.
- Old direct embed/thread update code.
- Old token storage model.
- Old hardcoded channel/role IDs.
- Old plan-speed math as a bypass around DZN package limits.
- Old first-sync EOF anchoring for DZN imports where historical backfill is expected.
- Old lack of structured suicide/death parsing.
- Old in-memory-only recent log model as the source of truth.

## Side-by-Side Fixture Result

Command:

`npm run compare:pandora-tracking`

Fixture:

`scripts/fixtures/DayZServer_PS4_x64_2026-05-19_16-01-55.ADM`

Expected DZN result:

- 10 PvP kills
- 2 suicides
- 1 uncredited death
- Killer totals:
  - mustard_coffer74: 5
  - Uractuallybadzzz: 4
  - xAKA-MINI_KickAs: 1

Comparison result:

- Pandora-compatible kill regex parses the same 10 PvP kills.
- DZN parses the same 10 PvP kills.
- DZN additionally parses suicides and uncredited deaths.
- DZN parses the PlayerList snapshot and entries.
- DEAD hit lines are not counted as kills by either comparison path.

## Conclusion

The old Pandora Bot confirms that DZN's current kill regex/parser direction is correct. The old bot's best reusable idea is cursor validation with both line number and line hash, not the old polling loop or Discord posting code.

DZN should keep its current package-based automation architecture. If missed kills still appear in production after the current import report deployment, the next focused hardening should be adding a stored ADM line hash to validate the cursor against partial/truncated files.
