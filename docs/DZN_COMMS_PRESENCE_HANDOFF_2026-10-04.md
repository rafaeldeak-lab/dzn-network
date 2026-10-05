# DZN Comms Aggregate Presence Handoff

Date: 2026-10-04

Status: source implemented and default-off; production migration and activation remain separate controlled operations

## Delivered source

- `0089_dzn_comms_presence.sql` adds a short-lived presence table keyed by a one-way HMAC digest.
- `GET /api/comms/presence?scope=global_chat` returns only an approximate aggregate count.
- Authenticated, same-origin `POST` heartbeats refresh one aggregate slot per signed-in DZN account.
- Signed-out visitors can read the aggregate count after activation but cannot create a presence slot.
- The Comms page polls every 30 seconds and stops when the component unmounts.
- The 75-second expiry prevents stale rows from contributing to the displayed count.
- Accepted heartbeats opportunistically erase up to 250 expired rows; a separately gated cron route provides the same bounded cleanup when traffic is quiet.

## Privacy boundary

The table stores only a keyed actor digest, the fixed `global_chat` scope and short-lived timestamps. It does not store or return a Discord ID, DZN account ID, IP address, user agent, route, device, billing detail, gameplay detail, location, player list or member identity.

The digest uses a dedicated `DZN_COMMS_PRESENCE_SECRET` and an isolated HMAC domain. That secret must not be reused for sessions, reactions, moderation, billing or any other ledger.

No analytics, browser storage, beacon, WebSocket or cross-origin presence write is introduced.

## Default-off switches

Server switches:

- `DZN_COMMS_PUBLIC_ONLINE_COUNTER_ENABLED=false`
- `DZN_COMMS_PRESENCE_READ_ENABLED=false`
- `DZN_COMMS_PRESENCE_WRITE_ENABLED=false`
- `DZN_COMMS_PRESENCE_RETENTION_ENABLED=false`
- `DZN_COMMS_PRESENCE_SCOPE=local_test`
- `DZN_COMMS_PRESENCE_SECRET=`

Public UI switch:

- `NEXT_PUBLIC_DZN_COMMS_PUBLIC_ONLINE_COUNTER_ENABLED=false`

## Controlled production activation

1. Record a private recovery bookmark for the production D1 database.
2. Confirm that `0089_dzn_comms_presence.sql` is the only migration authorized for this operation.
3. Apply migration `0089` alone.
4. Verify the migration ledger row, table columns, primary key, scope check, expiry index, foreign-key state and zero-row baseline.
5. Generate a new private secret of at least 32 bytes and configure it only as `DZN_COMMS_PRESENCE_SECRET`.
6. Set `DZN_COMMS_PRESENCE_SCOPE=production`.
7. Enable the server counter and read switches while keeping writes and the public UI disabled.
8. Verify aggregate `GET` behavior, cache prevention, invalid-scope rejection and absence of identities.
9. Enable only the presence-retention switch. Seed controlled active and expired fixtures, invoke the cron-authenticated presence-retention route manually, and prove that it deletes no more than 250 expired Global Chat rows while preserving every active row.
10. Register the authenticated presence-retention route with the existing scheduler and prove a successful scheduled run. Do not enable presence writes until both the manual and scheduled cleanup proofs pass.
11. Enable the server write switch and run authenticated same-origin heartbeat, signed-out rejection, cross-origin rejection, same-account deduplication, second-account counting, heartbeat throttling, opportunistic cleanup and expiry tests.
12. Enable the public UI switch last, deploy, and verify phone, tablet, desktop and reduced-motion behavior.
13. Keep every switch off or roll it back if any ledger, schema, privacy, authorization, cleanup, count or rendering check fails.

## Cleanup boundary

Expired rows are excluded from counts immediately. The source provides two bounded deletion paths: accepted heartbeats remove up to 250 expired rows, and the cron-authenticated retention route removes another batch when scheduled. Both paths constrain deletion to expired `global_chat` rows ordered oldest first. Production writes must remain disabled until the dedicated retention switch, controlled-fixture cleanup test and scheduled-run proof have all passed.

## Not performed

This source release does not apply migration `0089`, create or expose a secret, change production flags, deploy, write production presence, register the cleanup schedule, send Discord messages, alter payments, or change competitive systems.
