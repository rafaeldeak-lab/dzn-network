# Card-first GBP Checkout contract

## Scope

2026-09-07. Branch `codex/dzn-checkout-payment-method-contract-20260907`, based on PR 162 at `1220964e1bac6664408d6124ef040efefc385728`. One runtime line plus three regression-test files. No new schema, endpoint, flag, subscription reconciliation, entitlement grant or production operation. This is not live-payment activation.

## Finding and change

An actual Stripe TEST Checkout request using the existing financial parameters offered non-card payment methods including Klarna and enabled Adaptive Pricing. This could make the hosted offer differ from the intended card-first GBP launch even when the server-controlled base Price was correct.

New Starter, Pro and explicitly confirmed returning-Starter attempts now set `payment_method_types[0]=card` and `adaptive_pricing[enabled]=false` before persisting the request. Existing price, amount, trial, consent, customer/account, redirect and launch checks remain. Card-based wallets may still appear; this is not a promise to suppress all wallet presentation.

Retries load their original immutable `params_json`, API version and idempotency key. Do not retrofit the new fields into an uncertain or previously shared Session. Existing Sessions retain their old offer until separately inspected and actually expired at Stripe. A blocked DZN link is not proof of provider expiry.

## Validation

- The new card-method assertion failed on the old runtime, then passed after the one-line change.
- First-time Starter and Pro reject client-supplied method/conversion overrides and serialize card plus literal false. Returning Starter requires the existing explicit paid consent and gets no new trial.
- A seeded pre-release uncertain attempt omits both new fields; resumption preserves its exact saved JSON and original attempt-derived key. This proves local request preservation, not a historical Stripe idempotency record.
- Full `npm test`, nonincremental TypeScript, lint, production static build, billing quality profile, AutoDev audit, system audit and local Pages Functions compilation passed. Lint has existing source/generated warnings, no errors. System audit: 185 pass, 14 missing-local-config warnings, no failures.
- Actual local in-memory workerd/D1: eight simultaneous signed synthetic webhook deliveries commit one receipt/revision. An injected late SQL error rolls back all billing state; the identical retry commits cancellation. This is not real Stripe signature/delivery evidence.
- Independent frozen four-file security diff scan completed with 4/4 files covered, zero reportable findings and zero deferred candidates. The scan excludes real provider, production configuration and the full billing stack. No unresolved finding was hidden by adding the handoff document after the code review.
- Durable local evidence: `C:/Users/rafae/Desktop/DZN-Audits/evidence/dzn-checkout-payment-method-contract-20260907`.

## Actual Stripe TEST observations

These were deliberate dashboard/Workbench TEST operations under the user's launch-work approval, separate from this source patch. No live Stripe product, Price, customer or webhook was changed.

- Created new GBP 2/month Starter and GBP 10/month Pro test Prices on the existing test products and selected them as defaults. Preserved all old Prices. Did not change DZN environment bindings. Resolve the test lookup keys `dzn_starter_gbp_monthly_20260907` / `dzn_pro_gbp_monthly_20260907` privately in Stripe; no actual Price/customer/Session IDs or signed payloads belong in this repository.
- Before creating synthetic subscription events, disabled the sole TEST webhook destination because it targeted the production Pages billing handler. Verified the destination was test-mode, disabled, and the only v2 test destination. Keep it disabled until an isolated nonproduction receiver is deliberately configured. LIVE delivery is unchanged.
- Stripe accepted the patched request at the application's `2026-02-25.clover` version. The new TEST Session returned GBP, card-only method types, Adaptive Pricing disabled, always-collect payment method, no promotions and initial total zero. The rendered hosted page showed card entry, two days free, then GBP 2/month. The old unused Session was explicitly expired. Neither hosted Checkout was submitted; no hosted customer consent or complete DZN checkout round trip is claimed.
- One named synthetic test-clock customer with an `example.invalid` address was used for a separate direct subscription API simulation, never a real DZN owner. Stripe's official success/failure test payment methods were used; no real card data was collected.
- Starter trial duration was exactly 172800 seconds. After clock advancement, the subscription became active and the automatically collected first monthly invoice was paid GBP 2, remaining amount zero.
- Switching to Stripe's failure-after-attach card caused the next monthly invoice to remain open for GBP 2 with paid amount zero; the subscription became past_due.
- Restoring the success test method and explicitly paying the SAME failed invoice recovered GBP 2 and the SAME subscription became active. Trial dates did not change. Automatic retry scheduling itself was not exercised.
- Cancellation at period end initially retained active status. Advancing beyond that exact boundary produced canceled status and matching ended_at. The latest invoice remained the previously recovered invoice, not a new renewal invoice. This was API cancellation, not the customer portal flow.
- Workbench's browser shell rejected the attempted CLI `--idempotency` header option as an unknown body parameter. No real provider idempotency/concurrent request proof is claimed from that command.

## Remaining release work

The existing live GBP 2/10 products and signed-in Stripe account are present; do not recreate them or ask the owner to repeat known support details. The confirmed support address is `dznnetworksupport@gmail.com`. Earlier handoffs saying seller/contact information is entirely unknown are superseded by that read-only account recheck. Tax registration/liability is not established by a blank Stripe VAT field; merchant terms, refund/cancellation presentation, tax totals and actual receipt delivery still require verification.

Before charging real customers: prove an isolated actual DZN-to-Stripe checkout and signed-webhook round trip, actual provider idempotency/retry behaviour, hosted completion/consent, portal cancellation/recovery, and receipt delivery. Review/retarget/release the billing dependency stack and separately approve/apply production billing migrations 0066/0067/0068, without incidental Comms 0065. Recover FED & FERAL through the trusted existing setup and verify actual ADM sync. Only then complete the distinct issue 49 live enablement gate with current production readiness proof and owners' own payment consent.

## Rollback

Pause live checkout before any rollback. Revert only this new-attempt code if required, retaining original frozen attempts, claims and receipts. Do not delete uncertain requests, create replacement payments, or modify already-issued Session parameters. Test catalogue defaults can be deliberately restored to their preserved old Prices without rewriting any prior object; do not confuse that optional test rollback with live pricing. Keep the test-to-production webhook disabled. No production migration or flag changes are included in this patch.

References: https://docs.stripe.com/api/checkout/sessions/create , https://docs.stripe.com/billing/testing/test-clocks/api-advanced-usage , https://docs.stripe.com/testing .
