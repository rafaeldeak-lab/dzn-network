# DZN Store Order And Inventory Foundation

This slice prepares private, inactive Store order accounting on top of migration `0081`.

It adds migration `0082_store_order_inventory_foundation.sql` with:

- immutable order currency, totals, and catalog/policy snapshots;
- one immutable line item per order;
- finite or unlimited stock policies with bounded counters;
- per-account lifetime purchase limits and one-item order limits;
- sandbox/local-only order ledgers with `livemode = 0`;
- account-bound, guaranteed-purchase, no-competitive-advantage constraints;
- foreign keys, indexes, and local constraint tests.

The migration is source code only. It is not approved for production by this release and must be activated separately with a private recovery bookmark, isolated pending-migration proof, ledger/schema/index/constraint/foreign-key verification, and a zero-row baseline.

This slice does not add or enable:

- a public Store or catalog;
- an order-creation API;
- checkout or customer charging;
- Stripe products, Prices, Checkout Sessions, webhooks, or payment events;
- fulfilment, entitlements, receipts, refunds, or cancellations;
- Supporter Card issuance;
- paid XP, spins, ranks, discovery, reviews, events, Server Wars, CTF, owner subscriptions, or competitive eligibility.

The next implementation slice should add an operator-audited fulfilment state machine and receipt model behind new disabled-by-default private flags. It must not activate payments or public Store surfaces.
