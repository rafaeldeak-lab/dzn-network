# DZN Store Fulfilment And Receipt Foundation

This source-only slice adds migration `0083_store_fulfilment_receipt_foundation.sql` on top of migrations `0081` and `0082`.

It prepares:

- immutable sandbox fulfilment requests tied to the exact order, account, and product kind;
- append-only operator actions with contiguous sequence and state-transition checks;
- immutable sandbox receipt snapshots tied to completed fulfilment and exact order totals;
- operator identity, reason, evidence, indexes, and foreign-key auditability;
- hard database constraints keeping automation, live mode, and customer visibility disabled.

The intended future runtime flags are `DZN_STORE_FULFILMENT_ENABLED` and `DZN_STORE_RECEIPTS_ENABLED`. They must default off and must not be configured until migrations `0082` and `0083` each complete their own controlled production operation.

This release does not add checkout, customer charging, Stripe events, automated fulfilment, public or customer receipt routes, Supporter Card issuance, refunds, cancellations, emails, Discord messages, or public Store UI.

Migration `0083` is source code only. It is not approved for production by this release. Migration `0082` must be activated and verified separately before `0083` can even be considered.
