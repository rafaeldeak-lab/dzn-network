# DZN Comms Reactions Runtime

## Released source boundary

This release rebuilds the still-valid requirements from legacy PRs #116 and #117 on current `main`. It does not merge either stacked branch.

The source adds a disabled-by-default reaction runtime for messages that the requester is already allowed to read:

- `GET /api/comms/messages/:messageId/reactions` returns allow-listed aggregate counts and only the current requester's own state.
- `POST /api/comms/messages/:messageId/reactions` adds the signed-in requester's own reaction.
- `DELETE /api/comms/messages/:messageId/reactions/:reactionKey` removes only the signed-in requester's own reaction.
- Message history embeds the same aggregate projection when reaction reads are enabled.
- The Comms message rows show bounded aggregate controls only when the existing live UI is active; mutation controls remain disabled unless the server reports reaction writes enabled.

Visitors can read aggregates for visible public messages only. Private-group aggregates and mutations require current active membership. Support-private, hidden, quarantined, deleted and expired messages remain unavailable. Free, Starter and Pro accounts use the same personal reaction rules; reactions do not alter ranking, discovery, XP, badges, events, Server Wars, CTF, billing or entitlement state.

## Integrity and privacy

Migration `0078_dzn_comms_reactions.sql` is additive and creates current reaction state, short-lived idempotency receipts and bounded rate slots. The current-state row is unique per message, actor and reaction key. Counts are always computed server-side.

Mutation and rate ledgers use secret-derived actor keys and do not store Discord IDs, usernames, IP addresses, user agents, billing identifiers or Nitrado identifiers. Same-origin writes, exact request fields, a server allow-list, 30 mutations per actor per minute, retry conflicts and database uniqueness protect the write paths. Message visibility changes deactivate active reactions through a database trigger.

History summaries use two set queries for the entire page rather than per-message queries. Retention remains compatible before migration `0078` exists and removes expired reaction receipts and rate slots after it is installed.

## Activation boundary

Source deployment does not apply migration `0078` and does not enable reactions. Production activation remains a separate controlled operation after the base Comms migrations and live runtime are verified.

Required order:

1. Verify the production migration ledger and base Comms tables.
2. Apply only `0078_dzn_comms_reactions.sql` and verify its ledger row, three tables, indexes, triggers, constraints and foreign keys.
3. Keep `DZN_COMMS_REACTIONS_READ_ENABLED`, `DZN_COMMS_REACTIONS_WRITE_ENABLED` and the public reaction UI disabled.
4. Run authenticated public/private read, add, replay, conflict, removal, rate-limit, moderation-removal and retention tests.
5. Enable server-side reads, then server-side writes, and enable the existing public live UI switch last.

No production D1 write, feature-switch change, secret creation, Discord message, payment action, customer charge, Nitrado action or restart-schedule change is part of this source release.
