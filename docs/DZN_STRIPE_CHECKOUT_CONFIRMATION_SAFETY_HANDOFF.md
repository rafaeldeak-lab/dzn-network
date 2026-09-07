# Stripe checkout confirmation safety

## Scope

Base: main `f3630eede15e99099cd1d86aca57f38f0df6df07`, after the separately approved PR 151 release.
Branch: `codex/dzn-stripe-checkout-confirmation-safety-20260907`.

The card-first Starter recovery review identified a fail-open checkout confirmation path: failed subscription retrieval returned null and then checkout metadata plus a default active status could update owner billing and server subscriptions. An expanded, old checkout snapshot could also bypass a fresh provider read. Separately, the existing signature verifier authenticated the signature but never enforced the signed timestamp's age.

## Fix

- DZN checkout completion requires subscription mode and explicit subscription/customer identity.
- Always retrieve the current subscription, even when the event contains an expanded snapshot.
- Retrieval failure, mismatched customer/subscription, missing or invalid status, or an unknown Price returns a non-success response before any database access. Stripe can retry delivery; nothing defaults to active and checkout metadata cannot substitute for the configured Price.
- Preserve recognized Starter, Pro and legacy Price normalization and canonical entitlement/automation integration. Current canceled or unpaid state is not upgraded by an old checkout event.
- Enforce a five-minute signed timestamp tolerance, including rejection of malformed, stale and excessively future timestamps. Stripe re-signs retry deliveries with a fresh delivery timestamp.
- Provider exception text is not logged/returned from the new checkout lookup failure path.

This is a bounded safety fix, not a complete billing redesign, readiness approval or live activation. Other subscription/invoice event handlers are unchanged. The signature age check applies to the shared verifier.

## Validation

- Signed local webhook tests cover 12 negative checkout cases with a database-access trap proving zero schema, trial, account, entitlement or server-subscription operations.
- Tests cover stale/future/malformed correctly signed timestamps before network/database access, plus a delayed expanded active snapshot whose retrieved subscription is canceled.
- Existing Starter trialing, Pro active, subscription update/deletion and legacy plan tests remain passing. Existing fixtures now sign at the current test time and specify real subscription checkout mode.
- Full npm test, nonincremental TypeScript, lint, static build and local Pages Functions compile passed. Four existing lint warnings remain, zero errors.
- All provider responses and payment identifiers used by the new tests are synthetic. No live/test Stripe service was contacted by these tests. The existing browser/login/public APIs and schema are unchanged; no new UI requires screenshots for this backend-only patch.
- Diff and security review: all newly rejected checkout paths stop before database access; the provider request is a GET to the encoded subscription path; no new authentication bypass, price binding, live flag, token exposure, external recipient, scheduler selection or competitive formula change.

## Still required before real charging

1. Review/release this safety patch separately; it does not activate checkout.
2. Prove durable receipt deduplication, competing/out-of-order subscription and invoice handling, customer/account ownership binding, and reconciliation. The unchanged invoice-success handler currently retains the stored account status, so payment-failure recovery needs its own tested reconciliation work.
3. Prove checkout request idempotency and recovery after ambiguous provider timeouts. The current session creator has no Stripe idempotency header and can release a Starter reservation on an uncertain request failure. Do not advertise this as completed production billing safety.
4. Verify actual Starter/Pro Prices, provider mode, webhook delivery, cancellation/customer portal, tax/receipt terms and configured payment-failure policy. Configuration presence alone is not this proof.
5. Verify the existing customer's setup and usable-trial timing before inviting them. Saving a Nitrado token or completing this PR is not setup verification. Do not fake a subscription or start their trial without their own checkout consent.
6. Implement and prove the private next-visit invitation plus the 24-hour reminder. They remain delivery requirements, not queued notifications. A website notification cannot substitute for required provider/customer communications.
7. Final live checkout activation, issue 49, any necessary production migration, configuration/secret changes, account-specific writes and provider mutations remain explicit scoped release gates. A general instruction to continue is not a substitute for the repository's live-activation gate.

Ordinary free Discord/player access remains free. No new effect on ownership, saved preferences, profile visibility, rankings, discovery formulas, reviews, events, badges, seasons, Server Wars, CTF, XP/calling-card awards or competitive eligibility.

## Rollback

No migration, backfill or data repair is part of this patch. A code rollback would restore fail-open behavior and stale-signature acceptance; prefer a reviewed forward fix with checkout kept disabled. Never roll back billing records or replay old signed payloads as a shortcut. Do not add network retry jobs, reminders or release automation under this patch.

Official reference: https://docs.stripe.com/webhooks?lang=node (signature replay protection, fresh retry signatures and event-delivery limitations).
