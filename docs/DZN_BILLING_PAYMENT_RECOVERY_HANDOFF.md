# Billing payment recovery and renewal

## Scope and release order

- Branch: `codex/dzn-billing-payment-recovery-20260907`.
- Base: PR 152 at `48fdd7f82a345fa72f8a72d10ddf78b732e4cbcb`, not yet merged when implementation started.
- Main at start: `f3630eede15e99099cd1d86aca57f38f0df6df07`.
- This is a separate, high-risk billing PR stacked on PR 152. Review/release 152 first, then retarget/review this PR against main. Neither PR authorizes live checkout.
- No new migration, configuration, environment flag, checkout creation, customer recovery action or notification is included.

## Root cause and implementation

The old invoice-success handler reused the stored status and period. A payment recovery could leave an account `past_due`, and a renewal without a subsequent subscription event could retain the previous period. Failed invoices forced `past_due` even if delivered after recovery. Subscription lifecycle and expanded invoice snapshots could overwrite newer state.

Invoice and subscription lifecycle events now retrieve the current subscription through the existing Stripe GET helper, then reconcile the canonical owner account, entitlement, Starter trial claim and linked-server subscription records. The checkout handler retains PR 152's safety checks and is not otherwise redesigned here.

- Recognize `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed` and the existing subscription created/updated/deleted events. No provider webhook registration is changed.
- Read legacy invoice subscription IDs, expanded IDs and current `parent.type=subscription_details` IDs. Reject conflicting identities. A one-off invoice never changes subscription access merely by matching a customer.
- Require the provider response to match the event's customer and subscription, with a recognized status. Lookup failures return an error for fresh delivery retry; provider exception text is redacted.
- Refresh billing start/end dates, cancellation-at-period-end and the actual Price ID from the current provider state. Do not infer active access from an invoice label, an old event snapshot or old DZN status.
- Reject unknown Prices for active/trialing access. For a verified inactive exact existing subscription, retain only its stored normalized commercial plan while canonical entitlements become free. Removing a Price binding therefore cannot prevent cancellation/overdue revocation. Metadata is not a Price fallback.
- Preserve recognized Starter, Pro and legacy Premium/Network/Partner normalization. Active/trialing retain the existing access policy; past_due, unpaid, paused, incomplete, incomplete_expired and canceled do not grant paid access.
- Resolve all candidate account identities (bounded to two to detect ambiguity), not a customer/subscription OR query returning an arbitrary first row. Conflicting owners/customers fail closed. A replaced subscription is ignored rather than overwriting the current subscription.
- Invoice events require an already-linked exact subscription. Initial lifecycle events may use the freshly retrieved provider-owned Discord metadata, including when the subscription event arrives before checkout completion. They cannot use the old event's owner metadata.
- Terminal statuses may omit their billing period; canonical helpers preserve existing dates. Nonterminal periods must exist and be ordered. This is not a new trial-duration policy.

The implementation follows Stripe's documented [subscription webhook lifecycle](https://docs.stripe.com/billing/subscriptions/webhooks), [non-guaranteed event ordering and retries](https://docs.stripe.com/webhooks), and [current subscription retrieval](https://docs.stripe.com/api/subscriptions/retrieve).

## Local proof

`npm run test:billing-payment-recovery` invokes the signed route against an in-memory SQLite D1 adapter with two populated owners and linked servers. All provider responses are synthetic; outbound calls are trapped and restricted to the mocked subscription GET. The new suite is also part of `test:billing-plans`, the billing quality profile and the full test chain.

Coverage:

1. Failed payment then successful payment restores the current owner, Starter claim, entitlement and linked-server access.
2. Renewal refreshes both account and linked-server periods without relying on a subscription-update event.
3. Legacy, current and expanded invoice forms, repeated delivery and sequential delayed invoice/subscription snapshots reconcile current state.
4. Scheduled cancellation, cancellation undo, trial end and all recognized inactive statuses preserve the canonical access rules; delayed success cannot resurrect a canceled subscription.
5. Removed Price bindings still permit exact-subscription revocation without enabling paid access.
6. Invalid signature, provider failure, failed account lookup, mismatched identity, ambiguous account rows, unknown active Price and malformed period/status fail without billing DML.
7. A fresh retry repairs a provider-read failure and an intentionally injected partial downstream write failure.
8. Old subscriptions cannot replace a newer current association; an invoice cannot create a new owner association.
9. Known legacy Price normalization and item-level period fallbacks work; initial lifecycle handling trusts fresh provider metadata only.
10. Other-owner accounts, entitlements and server subscriptions remain unchanged. Linked-server ownership, listing visibility and lifecycle are unchanged. Billing DML stays within the existing canonical billing/scheduling tables; no competitive or profile tables are written.

Existing automation schema helpers still perform their existing idempotent schema checks and legacy cron maintenance. Tests explicitly require those cron-maintenance updates to affect zero fixture rows. This patch does not introduce or remove that maintenance, claim atomic D1 behavior, or invoke actual ADM/Nitrado/Discord work.

Final local validation: full `npm test`, billing-profile `autodev:quality` (including billing recovery/integrity, nonincremental TypeScript, lint and static build), `autodev:audit`, billing config safety check, local Pages Functions compilation and `git diff --check` passed. Lint retains four pre-existing warnings and zero errors. The local config checker correctly reports unconfigured/disabled checkout; that is not evidence of production configuration readiness. The quality report's browser/security reminders are resolved by the backend scope and manual review described here, not by an automated security certification. Hosted CI status is recorded in the PR/release handoff.

Browser screenshots are not new evidence for this backend-only change: no UI code changed, and no live payment flow was exercised.

## Security and remaining launch gates

Manual review covers the changed webhook, shared subscription type, canonical plan/entitlement writes, server-subscription propagation, signature boundary and the regression harness. No new provider POST, credential handling, public payment payload, notification, trial start or competitive write is added. Bound SQL parameters protect the new owner lookup. The five-minute signature rule from PR 152 remains in place. Live checkout stays disabled.

This is **not** complete payment-platform readiness:

- Fresh retrieval fixes sequential delayed-event handling, not a race between simultaneous provider reads and non-atomic D1 writes. Durable event deduplication, per-account serialization/conditional revisions and reconciliation remain separate launch proof requirements.
- Repeated delivery preserves the entitlement/account identity and state, but the existing automation helper can refresh scheduling timestamps. Do not call this exactly-once processing.
- The unchanged checkout-completion association path needs its own competing-subscription/account reconciliation proof. This PR's exact-current-subscription guards describe invoice/lifecycle reconciliation, not every historic checkout case.
- Checkout request idempotency and ambiguous Session-creation timeout recovery remain unimplemented. Do not release a Starter reservation on an uncertain provider outcome as if no Session could exist.
- Confirm real provider mode, Price/currency/amount, trial consent, configured webhook events, portal/cancellation, payment retry policy and tax/receipt/customer communication requirements through a separately approved sandbox/release process. Local mocks are not Stripe sandbox certification.
- Unknown/ambiguous identity/configuration failures deliberately require reconciliation rather than silently granting access. An invoice arriving before association is ignored; the checkout/lifecycle path is responsible for association. Do not claim a durable orphan-receipt recovery queue exists.
- Existing schema-helper side effects and shared-guild subscription assumptions are unchanged; no customer data repair is implied.

## Customer and next steps

Maintain the agreed priority: tested billing recovery/continuation first, FED & FERAL setup recovery second, private next-visit payment setup invitation and one-day-left reminder third, separate live-payment gate fourth. Finish the remaining retry/concurrency launch blockers within that first priority. Comms/AI does not displace this order.

FED & FERAL still needs its canonical setup completed and real stats sync verified. Do not create another server association, alter ownership, fake an active entitlement or start a trial to bypass a setup gate. The owner must personally enter card details and agree to the two-day Starter trial followed by GBP 2/month. No invitation or reminder has been queued by this patch.

No production deployment, migration, production D1 write, Stripe object change, secret/config change, Nitrado/Discord operation, charge, trial start, live chat/AI activation or issue 49 change was made during implementation.

## Rollback

This is code-only and requires no database rollback. Keep live checkout disabled while investigating. Prefer a reviewed forward fix: reverting to PR 152 would restore the invoice recovery/renewal bugs. Never restore billing rows, replay stale signed payloads or grant manual access as a rollback shortcut. Any real event replay or customer reconciliation is a separately scoped operation.
