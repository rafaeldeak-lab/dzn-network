# ADM Sync Plan

This is a planning note for the ADM sync engine.

## Phase 1 Implemented

- D1 schema for sync cursors, raw ADM events, parsed player events, kill events, player profiles, and server counters.
- ADM parser helper for first-pass admin-log lines.
- Sync state helper that records `read_pending` when ADM files are discovered but not readable through the current Nitrado API path.
- Owner-only manual sync endpoint.
- Owner dashboard sync card with safe counters and manual sync action.

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
