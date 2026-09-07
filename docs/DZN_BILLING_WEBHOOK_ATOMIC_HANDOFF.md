# Atomic subscription webhook reconciliation

## Scope and release gate

- Branch: `codex/dzn-webhook-atomic-reconciliation-20260907`.
- Base: PR 154 at `08f128cf045cd1485681dc3f454ce45ef49269e3`; review stack is 152, 153, 154, then this patch. Main remains `f3630eede15e99099cd1d86aca57f38f0df6df07` at the final remote-ref check.
- High-risk billing change, prepared for human review only. No merge, deployment or production migration is part of implementation.
- Additive migration: `0067_billing_webhook_reconciliation.sql`, exercised only in local in-memory SQLite and workerd/D1. Requires the existing billing/automation schemas and PR 154's `0066_billing_checkout_attempts.sql`.
- Recheck migration numbering/schema and explicitly approve only the required billing migrations before release. Do not apply pending `0065_dzn_comms_read_history.sql` as a side effect.
- Live checkout and issue 49 remain unchanged. No real Stripe Session, payment, provider mutation, customer trial, production D1 write, Cloudflare secret/config change, Nitrado action, Discord action or notification occurred.

## Failure and repair

The prior webhook wrote the trial claim, owner billing account, entitlement, linked-server subscription and scheduling state independently. An interrupted write could leave contradictory access. Concurrent provider reads could commit in the wrong order, and repeated deliveries lacked a durable receipt. A billing-status GET also persisted entitlements from its earlier account snapshot, allowing a stale page request to overwrite a just-committed cancellation.

The verified webhook now prepares one bounded conditional D1 batch containing both its private receipt and every applicable downstream billing/scheduling write. Cloudflare documents that [D1 batch statements execute transactionally and roll back on failure](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch). The local workerd smoke proves the actual CHECK constraint and rollback behavior, not only an emulated SQLite adapter.

1. Existing signature verification runs first. Supported subscription events must have a valid event/customer/subscription identity and the same test/live mode as the server's Stripe key. One-off invoices and unsupported events cannot change subscription access.
2. Look up `(stripe_mode, event_id)`. A committed matching payload hash returns success without provider reads or more writes. Conflicting reuse of an event ID fails closed.
3. Read the per-customer revision **before** retrieving the current subscription from Stripe. Historical event snapshots do not supply entitlement state or renewal dates.
4. Verify current customer/subscription/owner identity, recognized active/trialing Price, valid status/periods and unambiguous account association. An early invoice without initial association returns a retryable failure instead of being acknowledged and lost.
5. Prepare the current account snapshot and distinct owned guild list, bounded at 50 guilds. More than 50 fails closed for operator review; no partial server projection occurs.
6. The receipt's SQL CHECK guard rechecks revision, account snapshot, exact guild set and absence of cross-owner guild/subscription conflicts inside the transaction. A competing commit or changed ownership invalidates the entire plan.
7. In the same batch, increment the revision and persist the Starter claim when applicable, canonical account, effective entitlement, and each owned guild's existing subscription/sync-state projection. No schema creation or maintenance is executed by the webhook.
8. An exception returns a sanitized 500 for provider retry unless a matching committed receipt proves that the batch succeeded but its response was lost. No success response is sent before the projection is durable.

[Stripe retries deliveries, does not guarantee event ordering, and may deliver duplicates](https://docs.stripe.com/webhooks). The optimistic revision check makes overlapping reads conditional; it does not introduce a global lock, lease, Durable Object or queue. A rejected distinct event retries with a fresh provider read. Different customers reconcile independently. Ordinary primary D1 binding reads are assumed; this patch does not enable replicas or the Sessions API.

Deduplication is per event ID and parsed-payload hash, not a claim that all semantically similar Stripe events run once. Different event IDs can legitimately refresh the existing subscription and scheduler timestamps. JSON object-order/content changes under an already-committed event ID are treated as conflicts requiring investigation. No raw webhook body is retained.

## Subscription replacement and read-side safety

- A late event for a different, superseded subscription records a `superseded` receipt without replacing the current subscription or changing access.
- Replacing a stored canceled/incomplete_expired subscription with a new active/trialing one requires a verified checkout completion and its exact current private checkout attempt. The SQL guard checks owner, normalized plan, mode, frozen Price, nonclosed state and any known customer/Session identity. An unsolicited completion cannot bypass this proof.
- This preserves PR 154's deliberate post-cancellation checkout path without automatically creating another subscription. Legacy replacement checkouts without the durable attempt proof require separately approved reconciliation.
- `getOwnerBillingStatus` computes its response in memory; it no longer writes an entitlement from a potentially stale account read. A missing entitlement read returns free access without inserting a row. Existing explicit entitlement writers remain intact.
- Status/Price normalization and legacy Premium/Network/Partner compatibility remain covered. Expired/nonpaying states do not gain paid permissions; current verified renewal/recovery updates all canonical billing projections together.

## Private data and bounded writes

`billing_webhook_versions` stores mode, private customer ID and revision. `billing_webhook_receipts` stores mode, event ID/type, SHA-256 parsed-payload hash, private customer/subscription/owner IDs, applied/superseded outcome, commit time and a transaction guard. Neither table contains card details, raw provider payloads, email addresses, API keys or webhook secrets. There is no public, owner export or admin replay route for these records.

The webhook's DML allowlist is these two new tables plus `owner_starter_trial_claims`, `owner_billing_accounts`, `owner_plan_entitlements`, `server_subscriptions` and `server_sync_state`. Builders preserve existing projection SQL but let this handler execute it atomically. Other callers retain their existing schema/helper behavior. Missing approved schemas fail closed rather than being silently auto-created.

No linked-server ownership or setup lifecycle is changed. No ADM import, stats, score, ranking, discovery formula, review, badge, season, event, Server Wars, CTF, XP/calling-card award, public profile setting, retained export or competitive eligibility is changed. Billing-driven existing scheduler due dates are in scope; performing a stats sync is not.

Receipts/revisions are retained without an automatic purge job. Failed events are not a durable inbox: Stripe retry is the recovery mechanism. Exhausted retries, conflicting IDs, ambiguous legacy ownership and legacy subscription replacement need an approved operator investigation/replay procedure before launch. Do not delete receipts, reset revisions, clear trial claims or edit ownership to force a replay. Retention/privacy policy for operational billing ledgers remains a live-activation review item.

## Proof matrix

`npm run test:billing-webhook-atomic` executes the actual signed handler against transactional SQLite with synthetic provider GETs only:

- Eight simultaneous identical events: one receipt/revision; later duplicates make no provider call or additional write; conflicting reuse fails.
- An older in-flight active response cannot overwrite a newer cancellation. Retrying the old event re-reads the current canceled state.
- Failure at each of seven batch stages rolls back receipt, revision, trial, account, entitlement, subscription and scheduler writes; the same event later succeeds.
- A lost response after commit is recognized from the receipt without repeating work.
- Invoice-before-association is retryable and succeeds after verified initial association.
- Account association and linked-server membership races invalidate the batch; shared guilds cannot overwrite a foreign owner's subscription.
- Independent customers reconcile concurrently; old checkout completion cannot replace current access.
- Replacing a terminal subscription requires the exact current attempt/Session/Price proof.
- Bad signatures, missing IDs, mode mismatch and absent migration produce no provider contact or writes.
- A stale billing-status read cannot restore paid entitlements after cancellation; a missing entitlement read cannot overwrite a racing grant.
- DML stays inside the allowlist, migration numbering is unique and live checkout remains false.

`npm run test:billing-webhook-d1-local` uses the lockfile's Wrangler/Miniflare runtime with `d1Persist: false`, no Wrangler config and synthetic credentials. It rebuilds the fixture schema in an in-memory workerd D1 database, proves eight concurrent identical deliveries commit once, then injects a late failing SQL statement and proves all writes roll back before a successful cancellation retry. It disposes the emulator at exit. It is an explicit additional local proof, not a production connection or a new service.

The existing billing/recovery suite now uses the same real SQLite fixture for webhook cases instead of a permissive stub. Signature/trial/card/Price/cancellation/renewal/error assertions remain; distinct events have distinct IDs. Read-only ledger checks are allowed before a provider failure, while zero business writes are still required.

Final local validation passed on 2026-09-07: full `npm test`; all 13 atomic webhook test groups; `AUTODEV_VALIDATION_PROFILE=billing npm run autodev:quality` (billing/recovery/checkout/integrity tests, AutoDev policy, nonincremental TypeScript, lint, static production build and diff-check); `npm run autodev:audit`; the two local workerd/D1 checks; and Pages Functions compilation with Wrangler 4.90.1. The read-only local billing-config check passed while correctly reporting checkout unconfigured/disabled, not production readiness. Hosted CI is recorded separately in the PR. Backend-only scope adds no browser UI. The quality report's browser/security reminders are not a production sign-off. Synthetic provider tests and a static build do not certify a real Stripe sandbox lifecycle or production readiness.

Manual sensitive-diff review covers signature-before-data access, test/live separation, current provider identity, customer/account ambiguity, compare-and-set races, private errors/hash storage, trial uniqueness, replacement proof, transaction rollback, stale read-side writes and protected-system write isolation. No auth/OAuth/session, secret, workflow or production binding change is included. Human billing/security review remains required before merge.

## Remaining work and rollback

1. Review this stacked billing series in order and retarget each successor only after its parent lands. Complete real sandbox checkout/renewal/retry/cancellation/failed-payment/portal tests, exact GBP 2/month and two-day disclosures, receipts/tax, retention and operator recovery review before real charging.
2. Recover FED & FERAL's existing canonical setup and prove actual ADM stats sync, without transferring ownership or inventing paid access. That customer recovery has not been performed by this patch.
3. Add the private next-visit payment invitation and one-day-left reminder using authoritative trial dates. Neither is sent or queued here; no trial was started.
4. Complete the separate live-payment release gate. The owner personally enters their card details and accepts recurring billing. Chat/AI stays behind these priorities.

For rollback, first stop new checkout creation and pause webhook processing through a separately approved release control that returns a retryable response, never an unconditional success that discards payments. Preserve receipts, revisions, checkout attempts and all canonical billing records. Prefer a forward fix. Do not restore the old non-atomic handler while continuing to accept events, drop the ledger, replay blindly, or restore stale billing data as a shortcut. Provider reconciliation, migrations, production configuration, deployment and issue 49 remain separate approval gates.
