# Player Link Notification Delivery

## Released source boundary

This slice adds durable Discord delivery receipts and retries for player game-stat link approvals, rejections and server-scoped revocations. Existing DZN Pulse website notifications remain part of the same authenticated decision flow. The owner decision history can expose the safe delivery state, attempt count and result code without exposing bot tokens, Discord message bodies or channel identifiers.

Migration `0073_player_link_notification_delivery.sql` is additive. It creates one decision-scoped delivery table with a unique audit reference, due-work and owner-history indexes, bounded statuses, attempt counts and short processing leases. It does not change identity links, gameplay records, rankings, billing, subscriptions, Nitrado data or Discord configuration.

The source remains compatible before migration `0073` is applied. The decision route checks for the ledger table before adding a queue row. When the table is absent, the existing one-shot background notification path remains in place. Decisions made while Discord notification delivery is disabled are not backfilled or sent later.

## Runtime behavior

- A committed approval, rejection or revocation queues at most one Discord delivery by immutable audit ID.
- One worker claims a due row using a unique two-minute lease before contacting Discord.
- Temporary request, rate-limit and Discord 5xx failures retry after 1, 5, 30, 120 and 360 minutes.
- Invalid recipients, missing bot configuration and non-retryable Discord responses fail closed without exposing secrets.
- Players who have not enabled Discord notifications are recorded as skipped; their private DZN Pulse notification remains available.
- The protected `POST /api/sync/player-link-notifications/run` endpoint can process up to 20 due rows using the existing DZN cron-secret contract.
- Expired processing leases return to the retry queue, preventing a crashed worker from stranding delivery permanently.

## Controlled production activation

1. Confirm migrations `0064` and `0052` are already recorded and their tables are healthy.
2. Confirm `0073_player_link_notification_delivery.sql` is the only migration authorized for this operation.
3. Apply `0073` separately, then verify its ledger entry, table, five foreign keys, four indexes and `PRAGMA foreign_key_check`.
4. Keep `DZN_DISCORD_NOTIFICATIONS_ENABLED` unchanged while running schema and signed-in website-notification checks.
5. Confirm a test account explicitly enables Discord notifications; do not opt customers in automatically.
6. Enable Discord delivery only under the existing guarded Cloudflare operation and verify one fresh owner decision.
7. Confirm the website popup, DZN Pulse record, queue row, attempt count and Discord receipt all refer to the same decision audit ID.
8. Verify one simulated retry without sending duplicate messages, then verify a permanent failure is visible in owner history.
9. Register the protected run endpoint with the existing scheduler only after the manual delivery test succeeds. Do not alter the Nitrado or Discord-bot restart schedule.

No production migration, feature-flag change, Discord message, secret operation, payment action, customer charge, Nitrado operation or restart occurred as part of this source slice.
