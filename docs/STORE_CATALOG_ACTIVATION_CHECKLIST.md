# DZN Store Catalog Activation Checklist

This checklist covers only the inactive Store catalog foundation in migration `0081_store_catalog_foundation.sql`. It does not approve a public Store, Stripe binding, checkout, payments, orders, fulfilment, receipts, Supporter Cards, or paid benefits.

Production D1 migration application and feature-switch changes are separate high-risk operations. A generic instruction to continue, merge releases, finish the backlog, or activate the Store is not sufficient approval for either operation.

## Required starting state

- The exact source commit containing migration `0081` is deployed and recorded.
- Migration `0081_store_catalog_foundation.sql` is the only pending production migration.
- Migrations `0065`, `0069`, `0071`, `0072`, `0073`, `0076`, and `0078` are not pulled into this operation accidentally.
- The production database name and ID match `dzn_network_db` and the expected Cloudflare account.
- A current D1 Time Travel recovery bookmark is recorded privately before the write.
- `DZN_STORE_ENABLED` is absent or false.
- `DZN_STORE_ADMIN_ENABLED` is absent or false.
- No Store, checkout, payment, order, fulfilment, or public-catalog switch is enabled.

Stop if any condition is unverified, if more than one migration is pending, or if Cloudflare authorization is ambiguous.

## Apply exactly one migration

1. Record the pre-apply migration ledger and pending-migration list.
2. Reconfirm that the only pending filename is `0081_store_catalog_foundation.sql`.
3. Apply the D1 migration through the controlled Cloudflare operator session.
4. Do not continue if the migration command reports another filename, partial failure, retry ambiguity, or authorization change.
5. Record the post-apply migration ledger and confirm one new ledger entry for `0081_store_catalog_foundation.sql`.

Do not edit the migration ledger manually. Do not use a broad migration apply when any unrelated migration is pending.

## Schema verification

Verify all of the following directly against production after the apply:

- Tables: `store_products`, `store_prices`.
- Indexes: `idx_store_products_status_active`, `idx_store_prices_product_status`, `idx_store_prices_stripe_price`.
- Foreign keys reference `users(id)` and `store_prices.product_id` references `store_products(id)`.
- `PRAGMA foreign_key_check` returns zero rows.
- Both Store tables contain zero rows immediately after migration.
- Product `active` is constrained to `0`.
- Price `active` is constrained to `0`.
- `stripe_price_id` is constrained to null.
- Paid outcome fields, including XP, spins, rank, discovery, reviews, events, Server Wars, CTF, owner subscription access, and competitive eligibility, are constrained to `0`.
- Currency is constrained to GBP and prices are positive integer minor units no greater than `1000000`.
- Product and fulfilment compatibility constraints reject invalid combinations.

Any failed check is a hard stop. Keep both feature switches off and preserve the recovery evidence.

## Private owner workspace rollout

Only after every schema check passes:

1. Enable `DZN_STORE_ENABLED` for the server runtime while leaving `DZN_STORE_ADMIN_ENABLED` off.
2. Verify the public website, public APIs, checkout, payments, orders, and fulfilment remain unavailable.
3. Enable `DZN_STORE_ADMIN_ENABLED` for the server runtime.
4. Verify signed-out users redirect to login, non-platform owners receive access denied, and the platform owner can open `/owner/store`.
5. Create one clearly synthetic inactive draft through the owner workspace.
6. Verify the draft remains private, inactive, account-bound, has no Stripe price ID, and grants no progression or competitive outcome.
7. Verify the audit evidence and then remove the synthetic draft only through a separately reviewed data-cleanup operation.

The public Store remains off after this checklist. Checkout, payments, orders, fulfilment, receipts, and Supporter Cards require separate schemas, threat review, tests, release approval, and live verification.

## Evidence record

Keep a secret-safe record of:

- exact source commit and deployment ID;
- operator and UTC timestamps;
- production database name and ID confirmation;
- private recovery bookmark reference;
- pre- and post-apply migration lists;
- schema, index, constraint, row-count, and foreign-key results;
- feature-switch state before and after each step;
- authenticated access results for signed-out, non-owner, and platform-owner accounts;
- synthetic draft ID and cleanup follow-up reference;
- final decision to keep the public Store and every payment path off.

Never include Cloudflare tokens, session cookies, secrets, Stripe credentials, raw private account data, or the recovery bookmark itself in a pull request or public log.
