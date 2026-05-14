# ADM Sync Plan

This is a planning note for the ADM sync engine.

## Phase 1 Implemented

- D1 schema for sync cursors, raw ADM events, parsed player events, kill events, player profiles, and server counters.
- ADM parser helper for real DayZ console ADM line shapes.
- Sync state helper that records `read_pending` when ADM files are discovered but not readable through the current Nitrado API path.
- Owner-only manual sync endpoint.
- Owner dashboard sync card with safe counters and manual sync action.

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

- Scheduled sync.
- Queue/cron execution.
- Full ADM file download/read once the Nitrado API path is confirmed.
- Leaderboard calculations.
- Player profile pages.
- Public stat surfacing after privacy review.

## Safety Notes

- Never expose Nitrado tokens, encrypted tokens, token IV/auth tags, FTP credentials, MySQL credentials, Discord OAuth tokens, session tokens, or secrets.
- Read Nitrado files server-side only.
- Store sync cursors separately from public server data.
- Treat parser errors as recoverable and keep the server listing live.
