# ADM Sync Plan

This is a planning note only. Do not implement parser logic here.

## Next Worker Scope

- Fetch latest ADM file for each live linked server.
- Track last processed line and byte offset per linked server.
- Parse player joins.
- Parse disconnects.
- Parse kills and deaths.
- Save raw and normalized events to D1.
- Update player profiles from parsed identifiers.
- Update leaderboards and server aggregates.

## Safety Notes

- Never expose Nitrado tokens, encrypted tokens, token IV/auth tags, FTP credentials, MySQL credentials, Discord OAuth tokens, session tokens, or secrets.
- Read Nitrado files server-side only.
- Store sync cursors separately from public server data.
- Treat parser errors as recoverable and keep the server listing live.
