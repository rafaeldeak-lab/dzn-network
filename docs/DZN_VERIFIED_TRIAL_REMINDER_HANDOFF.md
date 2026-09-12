# Verified Starter Trial Reminder

## Scope and release gate

Successor to PR 159 at `729da27c9c0072692d22914f6f1b46e9b8af5a28` on the isolated
`codex/dzn-verified-trial-reminder-20260907` branch. This finishes the previously
missing exact-deadline capture and private last-day notification. It does not
release the open billing stack or recover a customer account.

New additive migration: `0068_billing_trial_reminder_state.sql`. Existing branch
migrations end at 0067; main remains `f3630eede15e99099cd1d86aca57f38f0df6df07`.
Recheck numbering and deployed schema before release. The new table needs parent
0067 receipts/versions, existing owner billing and Pulse 0052, and parent 0066
checkout attempts for the shared refresh route. No migration was applied to
production. Do not apply pending Comms 0065 as a side effect.

`DZN_BILLING_TRIAL_REMINDERS_ENABLED=false` by default. When explicitly enabled,
verified payment reconciliation captures the private projection. Delivery/read
additionally require `DZN_PULSE_ENABLED=true` and
`DZN_BILLING_REMINDERS_ENABLED=true`. No deployed configuration, secret or live
checkout flag was changed.

## Trusted date and isolation

- The existing signed webhook verifies event identity, retrieves the current
  subscription, checks customer/owner/Price/mode, and guards its transaction
  against concurrent revision, account and server-ownership changes.
- Only that guarded transaction may write `billing_trial_reminder_state`.
  It stores mode, owner/customer/subscription IDs, exact `trial_end`, committed
  revision, verification timestamp and receipt event ID. No raw payload, card
  information, private evidence or token is retained in this new table.
- A deadline is retained only for confirmed Starter/trialing, explicit matching
  test/live mode, explicit `cancel_at_period_end=false`, no scheduled cancel or
  paused collection, and a positive safe integer Unix timestamp within the
  supported date range. Otherwise the deadline is null, invalidating old copy.
  Missing/invalid deadline never falls back to billing-period end, checkout
  creation time, a website visit or a guessed two days.
- Capture is appended to the same atomic batch as receipt/revision/account
  updates. Failure rolls back the whole batch; signed delivery can retry.
  Duplicate events cannot repeat capture. Superseded subscriptions cannot
  replace the current trial record. Capture does not change other billing write
  statements, grants, scoring, ownership or scheduler rules.
- Reminder reads and writes join the current account and committed billing
  revision. Exact session owner/customer/subscription/mode must match, plan must
  still be Starter/trialing, cancellation must be false, and no other account
  may ambiguously share the customer/subscription. Stale or absent projections
  fail closed, including when payment updates occurred while capture was off.

## Notification behavior

- The authenticated same-origin empty-body refresh endpoint from PR 159 now
  runs the two conditional notification inserts together. It writes only the
  current session user's `user_notifications`; no client-supplied identity,
  date, title or deadline controls either reminder.
- A trial notice is due only when `0 < trial_end - database_now <= 86400`.
  Delivery happens on the owner's visit, focus or existing visible-page polling
  interval. This is not an offline email, scheduled broadcast or push guarantee.
- Title: "Your Starter trial ends within one day". Body displays the UTC
  deadline and points to billing/cancellation options in `/dashboard`.
  It does not invent a charge amount, promise collection, start a checkout,
  reset a trial, consent to renewal or cancel on the owner's behalf.
- Private list/count responses recheck eligibility; expired, canceled, changed
  subscription and stale records are hidden. Copy is regenerated from verified
  state, with only `trial_ends_at` in metadata; provider IDs/raw evidence stay
  out of the notification payload. Read responses remain private/no-store.
- One dedupe receipt per mode/subscription/confirmed deadline. Repeated visits
  cannot create duplicates. A genuinely changed verified deadline hides the old
  notice and can produce a new one when due. Clear-read expires the receipt
  without deleting suppression state. Future retention cleanup must preserve
  this behavior and the new receipt foreign key.
- Existing payment-setup copy and flags are unchanged. Trial reminders use the
  same Billing filter, credit-card icon and responsive/keyboard-safe drawer.
  No new popup, browser storage, tracking, provider request, AI or chat is added.

## Validation

- `npm run test:billing-trial-reminders`: 41 SQLite test groups. Includes signed
  provider-vs-event date proof; invalid dates; schema uniqueness/range checks;
  signatures; duplicate/concurrent receipts and visits; owner privacy; protected
  snapshots; read/clear; all flags; last-day boundaries; cancellation/pause/Pro;
  missing schema; interrupted/committed-lost responses; revised deadlines;
  account ambiguity; cancellation immediately before insertion; superseded
  subscriptions; unchanged base billing write scope; test/live isolation.
- Included in `test:billing-reminders`, `test:billing-plans`, the full suite and
  billing quality profile. No real provider requests: the provider GET is
  synthetic and all other external fetch paths are denied by the test.
- `node --import tsx scripts/test-billing-trial-reminders.ts --d1`: actual
  in-memory local workerd/D1, without Wrangler config or remote bindings.
  Eight signed deliveries yield one receipt/projection; eight visits yield one
  private notification. A late trigger failure rolls back all billing and trial
  state. Retry commits cancellation and hides the notice. FK check is clean.
  One repeat launch exited without a diagnostic between successful runs; this
  local runtime issue is recorded, not presented as production proof.
- Full suite, billing quality/types/lint/build, audit and local Pages Functions
  compilation passed. Standard quality warnings still require human review and
  browser evidence; they do not authorize automatic release.
- `node scripts/qa-billing-reminders.mjs --trial`: actual notification provider,
  drawer and API client using exported app CSS and synthetic responses at
  1440/900/390/320px. Covers UTC copy, Billing filter, red count, keyboard/focus,
  no overflow, read/clear/revisit, dashboard-only navigation, ineligible/disabled
  states, isolated refresh failure and list error/retry. No page errors, browser
  storage or external network. The original payment-setup mode is also retained.
  Set `DZN_QA_PLAYWRIGHT_PATH` for external Playwright and
  `DZN_REMINDER_QA_OUTPUT` for evidence. `--trial --serve` serves loopback-only
  sample data on `PORT`; it is not a signed-in customer or Stripe-hosted test.
- Manual sensitive-source review covers signature/mode/owner authority, bound
  SQL, atomicity, sidecar revision freshness, private output, dedupe retention,
  new migration constraints, flag rollback and unchanged protected systems.
  Independent billing/security approval remains required before merge/release.

## Rollback and remaining work

Never enable the new flag before the separately approved 0068 migration and
prerequisites exist. Enabling it without schema causes webhook reconciliation to
fail atomically and request retry, rather than acknowledge partial payment state.
Rollback is flag-off, not dropping tables, deleting receipts, changing payment
state or resetting trials. Flag-off leaves normal payment processing intact and
hides old trial notices. After disabled-period updates or superseded events,
require a fresh verified current-subscription event to restore reminder
freshness. Duplicate already-committed events are not a backfill mechanism.
No replay/operator endpoint or automatic historical backfill was added.

Before real charging: review/retarget the billing stack in order, perform real
Stripe sandbox/renewal/cancellation/failed-payment/receipt/consent testing,
approve exact production migrations and release independently, recover FED &
FERAL's canonical setup and verify actual ADM sync. The owner must personally
enter card details and agree to the two-day trial then GBP 2/month. No customer
was changed, reminded, granted access or charged by this implementation.
Chat/support/AI work remains queued. No production D1, Pages deployment,
Stripe/Cloudflare/Nitrado/Discord mutation, live checkout, retained export or
issue 49 action occurred.

References checked: [Stripe subscription object](https://docs.stripe.com/api/subscriptions/object)
for `trial_end`, cancellation and paused collection; [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/)
for atomic rollback. Local emulator tests verify the implementation's behavior.
