# Discord Discovery Recovery

## Scope And Diagnosis

Base: `e3b98f405c870c475637018fae33f6d98b7c2a5e` (PR #186).

The dashboard read saved posting destinations without contacting Discord. That
response deliberately has an unknown bot state. The live recheck control was
conditional on an error, so a clean account without saved destinations could not
establish the bot's installed/channel state from the dashboard. Cached positive
state could also mask a later failed check or survive a guild change.

Read-only live onboarding verification on September 13 confirmed the installed
DZN bot, 26 discovered channels and 26 postable channels. No invitation, reconnect,
message, channel save or go-live action was submitted. The dashboard had no active
posting setups. Installation and permission checks are not delivery proof.

## Correction

- Reachable explicit verification in Overview and Discord Posts, including when
  no channel destinations have been saved.
- Existing authenticated GET endpoint, twelve-second request deadline, no
  background Discord polling or new permission grants.
- Verification cache scoped to the exact linked server and Discord guild, with a
  five-minute lifetime. Cached saved destinations do not establish verification.
- Failed or negative live results override cached successes. Delayed responses
  from a previously selected server cannot update the current server.
- Separate unknown, missing bot, missing configuration, unavailable check and
  installed-with-zero-channels states. Setup percentage counts the visible checks
  rather than claiming a fixed 92 percent.
- Freshness uses browser receipt time. Provider timestamps remain diagnostic only,
  so browser/API clock skew does not reject a successful verification.

These controls are display/discovery recovery, not authorization. Existing
server-side ownership, Discord permission checks and protected writes remain.

## Validation

- Targeted cache, scope, failure, expiry, clock-skew and bounded GET regression
  tests are part of `npm test`.
- Rendered fixtures cover desktop, mid-width and phone widths (1440, 900, 390 and
  320 pixels), reduced motion, first verification, reload, both clock-skew
  directions, provider failures, malformed data, zero channels and server switching
  during an in-flight request. The harness blocks external requests and all
  non-GET API calls and checks overflow, browser errors and writes.
- An independent review found the clock-skew issue; the receipt-clock correction
  and its regression scenarios were added before release.

Final test, review, CI, merge and live verification evidence belongs in the release
PR. Local fixture success must not be described as live Discord message delivery.

## NukeTown And Remaining Operations

The September 12 read-only import evidence already establishes two actual kill
rows and five joins from the scheduled Nitrado path, with exact job/server/service
and source-line provenance. The job completed with warnings; sustained health,
Discord queueing/delivery and timestamp/hash follow-ups are still open.

On September 13 the separate working restart bot reported a completed hourly
cycle. Its next due reset remained noon UK time at the time inspected. No schedule,
timezone or Nitrado setting was altered. An obsolete failing service and critical
host disk pressure were diagnosed separately; no host repair is included here.

No database migration, payment setting, customer charge, secret change, Discord
message, Worker deployment or Nitrado restart is part of this correction. The wider
backlog remains in `DZN_RELEASE_BACKLOG_2026-09-13.md`.
