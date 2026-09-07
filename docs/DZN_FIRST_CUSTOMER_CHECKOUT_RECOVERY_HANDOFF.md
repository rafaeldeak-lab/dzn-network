# First-customer checkout recovery review

## Scope and finding

Branch: `codex/dzn-checkout-first-customer-recovery-20260907`, based on PR 155 at `b5c7fb11e84093da1fd82431c583ba05d8fdf5e5`. The review stack remains 152, 153, 154, 155, then this narrow follow-up. No migration is added. Production application of parent billing migrations 0066/0067 remains separately gated; do not apply pending Comms 0065 incidentally.

Combined review found a P2 recovery defect in PR 154: a new buyer's immutable checkout attempt correctly starts without a Stripe customer, but a verified completed checkout later associates a customer with the owner. After cancellation, comparing that assigned customer with the attempt's frozen null customer always returned CHECKOUT_REVIEW_REQUIRED. The owner could never close that completed attempt through the normal path to make a later deliberate checkout.

The prior test stored a canceled subscription without a customer, so it did not reproduce the real transition. Updating that test to include the completed Session's customer failed on the old implementation and passes with this fix. Stripe documents that [subscription Checkout creates a customer when one was not supplied](https://docs.stripe.com/api/checkout/sessions/object#checkout_session_object-customer); the defect is our handling of that normal assignment, not a change in Stripe identity semantics.

## Narrow repair

- Continue blocking active, trialing, overdue and other nonterminal subscriptions before checkout creation. This patch does not create a second subscription to bypass payment recovery.
- A frozen null customer can be reconciled only by retrieving the exact already-saved Session. It must be complete, with the same current account customer and subscription, plus the existing mode, owner, client-reference, attempt-ID and plan proof.
- Missing/foreign customers, wrong subscriptions, open/expired Sessions, wrong owner/mode and unknown Session IDs remain blocked. A changed known customer or key is not automatically accepted.
- Closing a completed attempt uses a conditional UPDATE that rechecks the current owner/customer/subscription, terminal status and absence of a foreign owner sharing the customer. A changed account during the provider read cannot close the attempt using stale evidence.
- The old request parameters, customer field, API version, key fingerprint, Session and first-request timestamp remain immutable. Do not rewrite the old request to include the newly assigned customer or reuse its Stripe idempotency key for different parameters.
- Closing returns the existing CHECKOUT_COMPLETED response and does not create checkout in that request. A later deliberate eligible request creates a new attempt/key with the current verified customer. Paid access still comes only from the verified webhook.
- Used Starter trial records remain unchanged and cannot be reused. This patch preserves the existing restriction on another Starter trial; it does not silently bill a returning Starter customer immediately. A clearly disclosed no-repeat-trial Starter re-subscription offer remains a separate pre-live UX/contract requirement. Tests use the existing eligible Pro re-subscription path rather than assuming that missing product flow is implemented.

## Tests and review

The corrected original checkout test proves the failure before the fix. Six additional groups in `scripts/test-checkout-first-customer-recovery.ts` run the real authenticated checkout route and signed webhook handler against a shared in-memory SQLite fixture with trapped synthetic Stripe responses:

1. First-time Starter: checkout, assigned customer, signed trial confirmation, signed cancellation, GET-only completed-attempt close, used trial rejection, a later deliberate Pro checkout using the assigned customer and a fresh key, then verified replacement.
2. The same lifecycle for a first-time Pro buyer.
3. Wrong/missing customer, wrong subscription, open/expired Session, foreign owner, mode mismatch and unauthenticated requests cannot close attempts or create another Session.
4. A provider response lost before Session persistence, followed by verified customer assignment and cancellation, stays blocked for operator review without another provider request.
5. An account subscription replacement during the provider read invalidates closing.
6. A foreign account acquiring the same customer during the provider read invalidates closing.

Assertions preserve immutable request fields, trial evidence, linked-server ownership, private no-store responses and live-checkout-off. The tests are included in the existing checkout/billing/full suites, not a separate unrun check. No real payment-provider request, card entry, charge or production entitlement was used.

Manual security review covers signature provenance through the parent handler, authenticated current-user ownership, known-versus-assigned customer handling, unchanged fingerprint/mode guards, exact Session proof, conditional close races, immutable Stripe request identity, no repeat trial, private errors and narrow write scope. Runtime changes are confined to the checkout helper; no webhook, auth/OAuth, schema, UI, configuration or competitive implementation is modified.

Final local validation passed on 2026-09-07: full `npm test`, all 13 existing checkout safety groups plus the six new combined-lifecycle groups, billing quality profile (billing/integrity tests, AutoDev policy, nonincremental TypeScript, lint, static build and diff-check), AutoDev audit, and local Pages Functions compilation. The two inherited local workerd/D1 webhook concurrency/rollback checks also passed; they validate the parent transaction rather than this new closing branch. The read-only local configuration check correctly reports unconfigured/disabled checkout. Exact hosted CI is recorded separately in the PR. No UI or real Stripe sandbox payment was exercised; human security/release review remains required.

The initial local build rejected a shared node_modules junction outside its root. The task-created junction was preserved inside the excluded dependency folder, and ordinary lockfile dependencies were installed into the isolated worktree before final validation. No dependency version or production build configuration was changed. An initial optional local D1 smoke exited without output in that shared setup; it passed after using isolated dependencies. The final billing quality profile passed twice, with the last clean run at 09:10 UTC. The original shared-dependency checkout and source were not altered.

## Remaining gates and rollback

This fixes a reproduced integration gap, not all live-payment readiness. Review/retarget the billing series in order, complete real Stripe sandbox lifecycle/portal/receipt/consent checks, settle returning Starter re-subscription disclosure and operational retention/recovery procedures, then separately approve billing migration/release. Keep checkout disabled and issue 49 untouched until final live approval.

FED & FERAL still needs canonical setup verification and proof of real stats sync, followed by the private payment-setup invitation and one-day-left reminder. No customer trial, reminder, invitation or paid grant was started by this implementation. A saved connection or a public Live label must not be treated as completed setup or a healthy token; provider verification/import is a separately controlled customer operation.

Rollback is source-only before deployment. After any separately approved release, pause new checkout under the approved release controls and preserve all attempts, claims and payment receipts. Reverting this fix would reintroduce the first-customer recovery block; prefer a forward fix. Never reset trial claims, delete immutable attempts, change payment identity or create another Session to bypass an uncertain outcome. No production deploy, D1 write/migration, Stripe/Cloudflare/Nitrado/Discord mutation, AI spend, Comms activation or issue 49 change occurred here.
