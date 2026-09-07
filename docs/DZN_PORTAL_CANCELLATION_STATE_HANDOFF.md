# DZN Portal Cancellation State

Date: 7 September 2026. Stacked on the reviewed PR #163 source at
`34e6f93eb202be5273e79fcd19497e21f78cd813`.

## Finding

An actual Stripe TEST customer portal cancellation displayed the service ending at
the current billing-period end. A fresh provider read returned `cancel_at` equal
to that exact period boundary, but `cancel_at_period_end` remained false. The
existing DZN webhook only copied the boolean, so its private billing status still
reported auto-renewal as on. Stripe had accepted the cancellation; this finding
does not mean that Stripe would ignore it and charge again.

The provider fields are documented separately at
https://docs.stripe.com/api/subscriptions/object. This concrete combination was
observed in the sandbox, not inferred solely from documentation.

## Patch

- Recognise either the existing boolean or an explicit cancellation timestamp
  exactly matching the current period end, including item-level Stripe periods.
- Preserve the current paid/trial access until authoritative terminal status.
- Clear the local cancellation flag when the provider removes its schedule.
- Do not mislabel a later cancellation date as cancelling this billing period.
- Reject malformed explicit timestamps before committing any billing writes.
- Reuse existing account/server fields and atomic receipt guards. No migration,
  new table, provider write, entitlement rule or checkout-flag change.

Custom cancellation dates not equal to the current period end are outside this
narrow presentation fix. It does not add a general cancellation-date model.

## Tests

The regression failed on the original code (`0 !== 1`) before the patch. The
updated payment-recovery suite covers active/trialing status, item-level periods,
the private billing read model, preserved paid access, undo, terminal revocation,
unchanged trial-claim time, later-date distinction and malformed timestamps.
Existing other-owner isolation and SQL write-allowlist assertions remain active.

The test fixture adds only its missing `nitrado_service_id` column so the real
private billing read model can execute its existing allowance query. This is an
in-memory fixture change, not a migration.

Validation records are kept outside source in the DZN local billing evidence
directory. Distinguish local regression tests from real provider delivery proof.

## Connected Evidence And Limits

Before this patch, the isolated actual DZN handlers and genuine Stripe test
events demonstrated an exact 48-hour trial, GBP 0 trial invoice, GBP 2 first
payment, failed GBP 2 renewal removing paid access, and recovery of the same
invoice restoring Starter without another trial. Another account remained Free,
and linked-server ownership/lifecycle rows remained unchanged.

The actual customer portal accepted a replacement public test card as default,
displayed paid invoices, and accepted end-of-period cancellation. That final
portal action exposed this patch's finding. The cancellation flag assertion was
recorded as failing, not overwritten with a pass. Cleanup then cancelled only
the synthetic subscription immediately and verified genuine revocation delivery.
The receiver stopped and the dedicated CLI context was logged out.

The corrected commit was then rerun with a fresh disposable Stripe TEST-clock
subscription and actual DZN handlers. DZN recognised the portal's date-only
cancellation shape, retained Starter through the paid period, and moved the
synthetic owner to Free/canceled when the clock reached that period end. The
unrelated synthetic account and linked-server rows stayed unchanged. The local
receiver stopped and its dedicated CLI context was logged out after completion.

This corrected rerun did not repeat the separate failed-renewal/recovery stages;
those remain covered by the preceding connected original-runtime run and the
updated local regression suite. Local retries of original signed events handled
concurrency collisions; this does not prove Stripe's automatic redelivery
schedule, production D1, or live secret bindings.

## Release

Review and retarget after the billing dependency stack. No production migration
is introduced here. The stack's existing migrations, live webhook/secret checks,
customer terms/tax/receipt readiness and live-checkout activation remain separate
release work. FED & FERAL recovery and private reminders are not completed by
these tests. Issue #49, production services and live checkout were not changed.

Rollback must preserve attempts, claims, receipts and customer records. Do not
revert provider cancellation or delete billing history to restore the prior code.
