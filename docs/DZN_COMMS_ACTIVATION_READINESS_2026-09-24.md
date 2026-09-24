# DZN Comms Activation Readiness

Date: 2026-09-24

Status: source-ready and default-off. This document is not authorization to modify production.

## Included Controls

- Discord-session-bound Global Chat send and reporting routes.
- Same-origin enforcement, bounded bodies, server-owned identity and channel selection.
- Five-second slow mode, per-minute attempt/send/report ceilings and durable idempotency receipts.
- Platform-owner-only moderation queue, required decision reasons and recent audit history.
- Moderation remains available behind its dedicated owner flag when live sending is paused.
- Hide, restore, resolve, dismiss and destructive erase actions.
- Immediate body, author and idempotency-receipt message-link erasure for deleted messages; pseudonymous send-quota slots remain until normal retention without a message or author association.
- Thirty-day expiry on newly accepted messages and tombstone erasure during cleanup.
- Cleanup that closes reports on expired messages, plus expired receipts, timeouts and old rate-limit slots.
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

Live sending also requires a dedicated server-only `DZN_COMMS_LEDGER_SECRET` of at least 32 characters. It must be generated independently from `SESSION_SECRET`, must never be exposed to client code or logs, and must remain stable across routine session-secret rotation.

## Controlled Production Activation

1. Confirm the production account, database name and database ID. Capture a recovery point and a sanitized schema/ledger snapshot.
2. List the D1 migration ledger and prove the exact state of `0065_dzn_comms_read_history.sql`, `0071_dzn_comms_live_moderation.sql`, and `0072_dzn_comms_private_rate_ledgers.sql` before writing anything.
3. If approved and pending, apply only migration `0065`; verify its ledger row, tables, indexes and foreign keys.
4. Before applying migrations after `0069`, verify the linked-server metadata bootstrap has installed `linked_servers.merged_into_server_id`; the existing Server Showcase merge trigger depends on it. If approved and pending, apply `0071` as its own controlled write. Verify its ledger row, tables, indexes, constraints, foreign keys and the seeded `global-chat` channel. Keep every Comms live/UI flag off before the privacy cutover.
5. Before `0072`, prove there are zero unexpired legacy send receipts, zero legacy attempt slots in the current UTC minute, zero send slots in the current UTC minute, and zero send slots accepted within the last five seconds. Keep sending disabled and wait until every receipt replay/conflict window and rate-limit window has expired. Migration `0072` deliberately fails before any table rebuild if an enforceable legacy receipt or quota remains.
6. Apply `0072` as a separate controlled write. Verify its ledger row, indexes, constraints and foreign keys, and prove that receipt, accepted-send and attempt ledgers contain no raw account ID column. Do not enable runtime flags if the migration guard fails.
7. Create the independent server-only `DZN_COMMS_LEDGER_SECRET`, verify only that it is present and at least 32 characters without printing it, then deploy it while every Comms server and UI flag remains off.
8. Enable the server history, live, owner-moderation and retention flags with scope `production`. Keep both public UI flags off.
9. Run authenticated API checks with designated test accounts: history, allowed send, blocked send, replay, conflicting replay, rate limit, report, owner-only queue, hide, restore, resolve and erase.
10. Invoke the retention route with the configured cron secret against controlled expired fixtures. Prove plaintext and author-link erasure plus bounded maintenance counts.
11. Enable both public UI flags and rebuild the site. Verify signed-out, signed-in and platform-owner behavior on phone, tablet and desktop.
12. Register the authenticated retention endpoint with the existing scheduler only after the manual cleanup check passes. Do not change the Nitrado or Discord-bot restart schedule.
13. Observe error rates and reports. If a runtime check fails, turn the Comms flags off. The additive schema may remain while the cause is investigated.

## Secret Rotation

- `SESSION_SECRET` may rotate through the normal session procedure without changing Comms receipt or rate-limit identities; users will need sessions issued under the new login secret.
- Do not routinely rotate `DZN_COMMS_LEDGER_SECRET`. If rotation is required, first turn off the live server and public UI flags, keep sending disabled, and wait until there are zero unexpired send receipts plus zero enforceable attempt/send windows.
- Replace the ledger secret only after that drain is proven. Re-run replay, conflict, attempt-limit and send-limit checks before restoring the server flag, then restore the public UI flag last. Never accept both old and new ledger secrets concurrently.

## Required Evidence

- Exact migration filenames and checksums reviewed from the release commit.
- Before/after migration ledger rows.
- Required tables and indexes present; `PRAGMA foreign_key_check` empty.
- Global channel exists once and is readable/public.
- Rejected content is absent from stored messages.
- Deleted and expired rows contain only the DZN tombstone and no author user ID.
- Deleted-message receipts no longer identify a message or rate slot; pseudonymous quota slots remain only until bounded retention.
- Non-owner moderation attempts return denied responses.
- UI has no horizontal overflow and remains usable at 390, 900 and 1440 pixel widths.
- No production billing, payment, Nitrado, Discord message, customer or secret mutation occurred as part of source release.
