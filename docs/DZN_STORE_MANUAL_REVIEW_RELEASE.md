# DZN Store Manual-Review Release

This release rebuilds the still-valid platform-owner reconciliation requirement from legacy PR #109 on current `main`. It adds a compact private queue for Store orders already in `manual_review`, searchable test/live filters, customer Discord avatars through a protected same-origin proxy, current event context, and immutable operator annotations.

The available actions are deliberately non-financial: `note`, `hold`, and `escalate` append audit context only. They cannot charge, refund, dispute, cancel, fulfil, issue a receipt, grant an entitlement, reserve stock, change an order state, call Stripe, or alter competitive systems.

Security boundaries include platform-owner authorization, same-origin writes, private no-store responses, bounded inputs and pagination, prepared D1 statements, retry-stable idempotency keys that survive ambiguous server failures, monotonic audit ordering, insertion-ordered same-timestamp event context, append-only database triggers, retained-ledger account anonymization for audit actors, rejection of raw payment references and Discord account IDs in notes, fixed-destination redirect-denying avatar fetches, strict image types, and a one MiB avatar limit.

## Production activation remains separate

Migration `0088_store_manual_review_audit.sql` is source code only in this release. Do not expose the queue until a separate controlled production operation has completed all of these steps:

1. Record a private D1 Time Travel recovery bookmark.
2. Confirm `0088_store_manual_review_audit.sql` is the only migration being applied in the operation.
3. Apply only migration `0088` and verify its exact migration-ledger entry.
4. Verify table `store_commerce_manual_review_actions`, its three indexes, both immutable triggers, the manual-review-state insert trigger, every foreign key, and `PRAGMA foreign_key_check` with zero rows returned.
5. Verify the new table has a zero-row baseline and that invalid actions, evidence categories, status snapshots, duplicate request keys, non-manual-review orders, updates, and deletes are rejected.
6. Verify the existing private Store and owner-admin flags before testing `/owner/store/reconciliation` as signed out, a normal account, and the platform owner.
7. Run one synthetic test-mode annotation and idempotent replay, then preserve secret-safe evidence. Any cleanup is a separate reviewed data operation because audit rows are immutable.

Stop and keep the route unavailable if the target database, pending-migration list, authorization, ledger result, schema, constraints, foreign keys, zero-row baseline, or access controls differ from the checklist.

This operation must not enable the public Store or change checkout, live payments, Stripe configuration, order creation, fulfilment, receipts, Supporter Cards, customer charging, Discord delivery, Nitrado operations, or competitive eligibility.

## Verification completed locally

- Focused Store manual-review route, authorization, privacy, idempotency, schema and immutability tests.
- Store catalog, order/inventory, fulfilment/receipt, commerce runtime and private Supporter Card regression suites.
- Full repository test suite, production build, non-incremental type check, lint and whitespace validation.
- Rendered queue checks at desktop, tablet, phone and 320-pixel widths, including reduced motion and no horizontal overflow.
- Independent security diff review; both low-severity pre-release findings were fixed and re-tested before publication.

No production D1 write, feature-switch change, Stripe action, customer charge, Discord message, Nitrado operation, or restart-schedule change is part of this source release.
