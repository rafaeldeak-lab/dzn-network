# DZN Comms Activation Readiness

Date: 2026-09-24

Status: source-ready and default-off. This document is not authorization to modify production.

## Included Controls

- Discord-session-bound Global Chat send and reporting routes.
- Same-origin enforcement, bounded bodies, server-owned identity and channel selection.
- Five-second slow mode, per-minute attempt/send/report ceilings and durable idempotency receipts.
- Platform-owner-only moderation queue, required decision reasons and recent audit history.
- Hide, restore, resolve, dismiss and destructive erase actions.
- Immediate body and author-link erasure for deleted messages.
- Thirty-day expiry on newly accepted messages and tombstone erasure during cleanup.
- Cleanup for expired receipts, timeouts and old rate-limit slots.
- No AI provider, billing, entitlement, Nitrado, ranking, XP or reward mutation.

## Flags That Must Remain Off Until Activation

```text
DZN_COMMS_MESSAGE_HISTORY_READ_ENABLED=false
DZN_COMMS_MESSAGE_HISTORY_READ_SCOPE=local_test
NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED=false
DZN_COMMS_LIVE_ENABLED=false
DZN_COMMS_LIVE_SCOPE=local_test
NEXT_PUBLIC_DZN_COMMS_LIVE_UI_ENABLED=false
DZN_COMMS_OWNER_MODERATION_ENABLED=false
DZN_COMMS_OWNER_MODERATION_SCOPE=local_test
DZN_COMMS_RETENTION_ENABLED=false
DZN_COMMS_RETENTION_SCOPE=local_test
```

## Controlled Production Activation

1. Confirm the production account, database name and database ID. Capture a recovery point and a sanitized schema/ledger snapshot.
2. List the D1 migration ledger and prove the exact state of `0065_dzn_comms_read_history.sql` and `0071_dzn_comms_live_moderation.sql` before writing anything.
3. If approved and pending, apply only migration `0065`; verify its ledger row, tables, indexes and foreign keys.
4. If approved and pending, apply only migration `0071`; verify its ledger row, tables, indexes, constraints, seeded `global-chat` channel and foreign keys.
5. Enable the server history, live, owner-moderation and retention flags with scope `production`. Keep both public UI flags off.
6. Run authenticated API checks with designated test accounts: history, allowed send, blocked send, replay, conflicting replay, rate limit, report, owner-only queue, hide, restore, resolve and erase.
7. Invoke the retention route with the configured cron secret against controlled expired fixtures. Prove plaintext and author-link erasure plus bounded maintenance counts.
8. Enable both public UI flags and rebuild the site. Verify signed-out, signed-in and platform-owner behavior on phone, tablet and desktop.
9. Register the authenticated retention endpoint with the existing scheduler only after the manual cleanup check passes. Do not change the Nitrado or Discord-bot restart schedule.
10. Observe error rates and reports. If a runtime check fails, turn the Comms flags off. The additive schema may remain while the cause is investigated.

## Required Evidence

- Exact migration filenames and checksums reviewed from the release commit.
- Before/after migration ledger rows.
- Required tables and indexes present; `PRAGMA foreign_key_check` empty.
- Global channel exists once and is readable/public.
- Rejected content is absent from stored messages.
- Deleted and expired rows contain only the DZN tombstone and no author user ID.
- Non-owner moderation attempts return denied responses.
- UI has no horizontal overflow and remains usable at 390, 900 and 1440 pixel widths.
- No production billing, payment, Nitrado, Discord message, customer or secret mutation occurred as part of source release.
