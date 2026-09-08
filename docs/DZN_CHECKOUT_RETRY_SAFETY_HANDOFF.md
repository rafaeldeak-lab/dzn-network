# Durable subscription checkout recovery

## Scope and release order

- Branch: `codex/dzn-checkout-retry-safety-20260907`.
- Base: PR 153 at `074797e52c0521ccb764e36787c53a391a6a6966`, stacked on PR 152. Main at start: `f3630eede15e99099cd1d86aca57f38f0df6df07`.
- Review/release 152, then retarget/review 153, then retarget/review this patch. No merge, deployment or production migration is authorized by implementation.
- New migration: `0066_billing_checkout_attempts.sql`, exercised in local in-memory SQLite only. Recheck numbering immediately before a separately approved release. Do not apply pending migration 0065 (Comms) as a side effect.
- Live checkout remains disabled. No customer, Stripe object, Cloudflare configuration/secret, Nitrado, Discord or issue 49 operation occurred.

## Failure and repair

The old route reserved a Starter trial, created a Stripe Session without an idempotency key, and released the reservation on a provider error or missing URL. A lost response was not proof that Stripe had failed to create a Session. Repeating Pro requests also lacked a durable identity.

The existing authenticated `POST /api/billing/create-checkout-session` now uses one nonclosed private attempt per Discord owner. The database partial unique index chooses the winner for simultaneous first-time requests. Both Starter and Pro use this layer; caller-supplied owner, Price and idempotency fields are ignored.

Each attempt freezes the server-selected plan/Price, redirects, trial terms, customer identity, Stripe API version and test/live mode. It stores a SHA-256 key fingerprint, never the secret. A random attempt ID supplies `dzn-checkout-<id>` to Stripe's `Idempotency-Key` header. Retries use the exact stored request parameters, even after a configuration or return-path change.

The first possible provider-request timestamp is saved before the POST. An unknown Session can be retried for less than 23 hours from that timestamp. Beyond that, the attempt remains blocked for review; a new key is never generated automatically. This conservative limit stays below Stripe's documented key-pruning threshold. See [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests).

Once a Session ID is saved, subsequent requests use [Session retrieval](https://docs.stripe.com/api/checkout/sessions/retrieve), not another creation POST. Every result must match the attempt's mode, owner, client reference, plan metadata, attempt ID and known customer/Session identity. An open checkout URL must be HTTPS on exactly `checkout.stripe.com`, without URL credentials or an alternate port, and have an unexpired numeric expiry. Provider errors and internal fields never enter API errors.

An existing nonterminal subscription, including an overdue subscription, is directed to Manage billing instead of permitting a second subscription. Ambiguous customer ownership, a changed key/customer identity or a conflicting plan fails closed. Key rotation is intentionally not an automatic recovery path.

## State and trial rules

| State | Meaning | Next action |
| --- | --- | --- |
| prepared | Immutable attempt saved; no provider request confirmed | Reserve this exact Starter claim if needed, then record request start |
| request_started | Provider outcome may be unknown | Retry identical parameters/key within the bounded window |
| session_ready | Verified Session identity saved | Retrieve that Session and return its valid open URL |
| closed | Provider-confirmed expired, or completed with the same stored terminal subscription | Preserve history; a later deliberate request may choose a new eligible checkout |

- An uncertain result, HTTP error, malformed provider response or failed Session-save write never releases the Starter reservation.
- The Starter claim ID equals the attempt ID. Unique owner and known-customer claim indexes preserve the one-trial rule.
- A provider-confirmed expired Session closes the attempt and releases only its exact unused `checkout_created` claim. Both writes use a D1 batch transaction. A used/linked trial claim is never released. See [D1 batch rollback semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
- Attaching a Session ID cannot downgrade a trial claim already advanced by a fast webhook.
- A complete Session never grants access in this route. It directs the owner to billing confirmation. Existing verified webhooks remain responsible for subscription state and entitlement updates.
- After a completed checkout's exact subscription is recorded as canceled or incomplete_expired, the attempt can close; a new checkout requires another deliberate request. A previously used Starter trial remains unavailable.
- The two-day trial is not started by this ledger, by the setup fix, or by a reminder. The personal card-consent flow remains required; the server-created Starter Session retains two trial days, always-required payment collection, no promotions and cancellation if the payment method is missing.

## Privacy and write scope

The new table is an operational billing ledger, not analytics or share history. It stores private owner/customer IDs, immutable checkout parameters, mode/key fingerprint/API version, lifecycle timestamps and Session IDs. It contains no card data or raw provider payloads. No ledger read/export/admin route, client tracking, notification or new log is added. Checkout recovery responses are private/no-store and return only a checkout URL or a sanitized error/code.

New runtime DML is limited to `billing_checkout_attempts` and the existing `owner_starter_trial_claims`. Existing billing schema helpers are unchanged. Missing the new ledger migration fails before provider contact and trial reservation; the route does not auto-create the ledger.

There are no writes to owner accounts/entitlements, server ownership, setup lifecycle, stats, rankings, discovery, reviews, events, XP, calling cards, seasons, Server Wars, CTF, profiles, retained exports or competitive eligibility. No paid access is inferred from a redirect or Session URL.

Closed attempts are retained, not automatically deleted. Pending or unknown attempts must never be purged merely to unblock checkout. No retention job, administrative reset or operator reconciliation endpoint is introduced. Retention/privacy policy and a safe operator-resolution procedure must be reviewed before live activation.

## Proof and review

`npm run test:checkout-retry-safety` runs the real authenticated route against in-memory SQLite and a trapped synthetic Stripe provider. It proves:

- Eight simultaneous initial Starter/Pro requests converge on one attempt and one synthetic Session per owner.
- Lost provider response and failed database save retry identical request parameters/key/API version, without another Session or released trial.
- Known Session resume uses GET only; another account cannot obtain its URL; forged body fields cannot change identity or price.
- Ambiguous shared customer ownership blocks both owners before provider contact; existing overdue subscriptions cannot create a second checkout.
- Plan changes, expired retry windows, key rotation and provider/identity/mode/URL failures preserve fail-closed state.
- Only confirmed expiry releases the exact unused trial; an injected cleanup failure rolls back both writes. Used trials and fast webhook state cannot regress.
- Complete Sessions grant no access or duplicate checkout; only the exact recorded terminal subscription allows closing the old attempt for a later deliberate Pro request.
- Missing migration and disabled live checkout contact no provider and reserve no trial.
- Attempt immutability, unique numbering, private errors and a narrow billing DML allowlist are enforced.

The existing billing suite uses actual SQLite checkout fixtures for success and known-customer trial reuse, rather than a permissive SQL stub. Its card/trial/Price/promotion assertions remain. The Comms migration assertion now requires its approved file to exist and every migration number to be unique; it no longer incorrectly requires Comms to be newest forever. No Comms runtime changes are included.

Final local validation passed: full `npm test`, all 13 checkout retry safety groups, billing-profile `autodev:quality` (billing/recovery/integrity tests, nonincremental TypeScript, lint, production static build and diff-check), `autodev:audit`, local Pages Functions compilation with Wrangler 4.90.1, and staged diff-check. The read-only local billing-config check correctly reports checkout unconfigured/disabled, not production readiness. Hosted CI is recorded separately in the PR. This is backend-only work: no new browser UI or live checkout was exercised. Synthetic provider tests are not real Stripe sandbox certification; the quality report's browser/security reminders are not a production release sign-off.

Manual sensitive-source review covers authentication, immutable request identity, uniqueness races, private error handling, trial reservation/expiry, database failure recovery, provider response checks and protected-system write isolation. The review does not certify unrelated billing code or concurrent webhook processing.

## Remaining blockers and rollback

1. Simultaneous webhook messages still need durable event deduplication, serialized/conditional account reconciliation and interrupted downstream-write recovery. PR 153 fixes current-state renewal/recovery but does not make its multiple writes atomic or exactly once. Competing checkout-completion association also needs proof. This patch is not that fix.
2. Legacy pre-ledger reservations and unknown attempts beyond the 23-hour window require separately approved reconciliation. Do not release them automatically or blindly create a second checkout. Provider errors cached against a key may also require operator review.
3. Real sandbox lifecycle testing, Price/amount/currency/trial disclosure, payment retries/renewals/cancellations, portal behavior, receipts/tax and reminder timing remain activation gates. No real Stripe Session was created in this task.
4. Then recover FED & FERAL's canonical existing setup and prove real stats sync without changing ownership or fabricating paid access. Then implement the private next-visit payment invitation and one-day-left reminder. Neither has been sent or queued here.
5. Final live activation is a separate approved release; the owner personally enters card details and accepts the two-day Starter trial followed by GBP 2/month. Chat/AI remains behind this priority.

Rollback must first stop checkout creation through the approved release controls. Preserve all attempt and trial records. Do not restore old checkout code while accepting requests, because that would ignore the ledger and recreate uncertain payments. Prefer a forward fix; retaining the additive table is safe when code is disabled. Never drop/delete pending attempts, reset trial claims or restore old billing data as a rollback shortcut. Any provider expiration/reconciliation, migration apply, production config change or release is a separate approval gate.
