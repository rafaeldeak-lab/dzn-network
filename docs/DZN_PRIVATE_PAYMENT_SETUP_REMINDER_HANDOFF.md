# Private Payment Setup Reminder

## Release boundary

Implemented on `codex/dzn-private-payment-reminder-20260907`, based on PR 157 at
`8c28a4a6405bb2f78749aeb6e174d7a63292cf09`. Review this as a separate successor
to the billing series, not as authorization to merge, deploy or enable billing.
No new migration. Existing Pulse 0052, billing/trial/entitlement tables and parent
0066 checkout-attempt schema must exist; parent 0066/0067 production approvals
remain separate. Do not apply pending Comms 0065 incidentally.

Both `DZN_PULSE_ENABLED` and `DZN_BILLING_REMINDERS_ENABLED` must be exactly
`true`. The new flag defaults off and no deployed Cloudflare configuration was
changed. Live checkout remains disabled. Missing prerequisite schema suppresses
the optional billing notice on reads; the refresh route returns a sanitized 503.

## What is implemented

- The existing bell refresh can POST an empty body to
  `/api/dzn-pulse/notifications/refresh-billing` on a visit, focus or its existing
  visible-page polling interval. No new timer, browser storage, campaign, popup,
  broadcast, email, Discord delivery or provider request is added.
- The route requires a real authenticated session and exact same-origin Origin.
  No mock-auth fallback. User/server/title/link fields supplied by a client are
  ignored. Responses are private and no-store. GET is not a write path.
- Only a first-time owner with an existing nondeleted, nonmerged linked Nitrado
  server qualifies. Ordinary players do not. Any owner billing account, trial
  claim, non-Free entitlement, nonclosed checkout attempt, or paid/ambiguous
  legacy subscription for the owner or their linked guild suppresses the notice.
  Recovery of an existing or canceled subscription is deliberately separate.
- One conditional `INSERT OR IGNORE ... SELECT ... WHERE EXISTS` rechecks all
  eligibility in the notification write. The existing unique `(user_id,
  dedupe_key)` index makes concurrent visits idempotent. No billing, trial,
  entitlement, server, scoring, profile, progression or competitive write occurs.
- The notice says "Please set up payment". When checkout is available it
  explains the two-day trial then GBP 2/month and directs to owner pricing. When
  paused it explicitly says payment setup is unavailable and no trial has begun.
  Opening it marks only that owner's notice read, then visits pricing. It never
  starts a trial, creates a checkout or gives final recurring-payment consent.
- Notification list/count reads recheck current owner eligibility and the flag,
  so a stale stored notice disappears when billing changes. Visible title/body,
  metadata and local action URL are regenerated from the current safe contract;
  no stored arbitrary metadata, server/event identifiers or provider data leak.
- Clearing read billing notices expires one private dedupe/delivery receipt
  instead of deleting it. Repeat visits cannot recreate the notice. Existing
  nonbilling clear behavior remains deletion. This single receipt remains under
  account deletion/data-retention policy; no new export/history service or purge
  job is introduced. Future cleanup must preserve this dedupe behavior or replace
  it with an approved suppression record; deleting the receipt alone reissues it.
- A Billing filter and credit-card icon distinguish the notice. Responsive
  filters fit in two rows, or three on the narrowest mobile screens. Drawer
  refreshes no longer restart the focus effect or steal keyboard focus.

## Intentionally unfinished

Subsequent implementation: `DZN_VERIFIED_TRIAL_REMINDER_HANDOFF.md` defines the
new separately disabled exact-deadline/last-day reminder slice and its 0068
migration gate. The following describes the original PR 159 boundary.

The one-day-left reminder is NOT implemented. The current billing projection
does not retain Stripe's exact verified `trial_end`. Do not derive it from the
billing-period end, first visit, checkout creation time, a default two days, or
the customer's pending setup date. A separate bounded change must retain the
verified trial end, handle canceled/expired/stale states and deliver one private
reminder only for an actually running eligible trial.

This does not recover FED & FERAL, test its real token, verify ADM sync, grant
Starter, start its trial or contact its owner. PR 158 contains separate trusted
setup proof preparation. Customer recovery, real Stripe sandbox/renewal/receipt/
consent tests and the final live-payment gate are still required. The owner must
personally enter payment details and agree to recurring billing. Chat/support
discoverability and approved Comms/AI runtime work remain queued.

## Validation and review

- `npm run test:billing-reminders`: 33 real SQLite eligibility/auth/Origin,
  cross-owner denial, private headers, duplicate/read/clear, stale-state,
  missing-schema, paused-flag and isolation groups. Global fetch is blocked;
  zero provider, analytics, email or Discord calls. Recorded write statements
  are restricted to `user_notifications`; protected-table snapshots unchanged.
  This command is included in `test:billing-plans`, the full suite and billing
  quality profile.
- `npx tsx scripts/test-billing-reminders.ts --d1`: actual in-memory local
  workerd/D1. Eight concurrent authenticated refreshes produce one receipt;
  private reads and read/clear/revisit pass; billing tables remain empty and
  the synthetic server stays pending. No Wrangler config or remote D1 is used.
  Initial fixture seeding hit a foreign-key ordering error, fixed by seeding
  users first. Two subsequent launches suffered a Windows native process exit
  without a JS diagnostic; two later consecutive runs passed. This is local
  emulator proof, not production execution or provider certification.
- `npm test`, nonincremental types, billing quality (including lint/build),
  AutoDev audit and local Pages Functions compilation passed. Standard quality
  warnings still require rendered evidence and human security review before
  merge; they are not an auto-release approval.
- `node scripts/qa-billing-reminders.mjs`: actual provider/bell/drawer/API client
  with exported app CSS and synthetic local responses at 1440/900/390/320px.
  Checks keyboard open/close/focus, filter labels and overflow, paused/available
  copy, read/clear/revisit, pricing-only navigation, ineligible and flag-off
  states, reminder-refresh failure isolation, list retry, no page errors,
  no browser storage or external network. Mobile includes reduced motion.
  This is component QA, not real customer-session or Stripe-hosted browser proof.
  Set `DZN_QA_PLAYWRIGHT_PATH` when Playwright is installed outside the project;
  `DZN_REMINDER_QA_OUTPUT` selects the local evidence directory. `--serve` starts
  a loopback-only mock preview, with `PORT` defaulting to 3089.

Scoped manual sensitive-source review covered real-session ownership, exact
Origin, input tampering, bound SQL, write-time rechecks, unique delivery,
cross-owner reads/read-state, fail-closed legacy/ambiguous billing, sanitized
responses, live-flag behavior and unchanged protected systems. No blocking
finding remains from that review; independent human review is still required.

## Rollback / next release checks

Set the new flag off through a separately approved release change. Refresh then
returns 404 and reads hide existing billing notices. No destructive migration,
entitlement rollback, trial reset or ledger deletion is needed. Old clients with
cached config cannot bypass the server flag. Removing this code entirely should
also account for preexisting billing rows; prefer flag rollback so stale rows
cannot be displayed by older unfiltered notification reads.

Before enablement, recheck the full stacked diff, migration prerequisites and
actual checkout availability. Test an eligible owner, ordinary player, already
billed owner, private headers, clear/revisit and missing schema in a controlled
environment. Any production deployment/config change, customer notification,
Nitrado recovery, actual Stripe action, trial/charge, Comms/AI activation or issue
49 action requires its own approval. No such action occurred in this slice.
