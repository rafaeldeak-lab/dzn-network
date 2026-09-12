# DZN Comms Timestamp Hydration Fix

Date: 2026-09-06
Branch: `codex/dzn-comms-timestamp-hydration-fix-20260906`
Base: `main` at `42dc9fa0d1af42db9941b36d8cd4ffb5c3d6c3ea` (released PR #144)
Status: implemented and locally validated; separate PR/release approval required

## Cause and fix

Live PR #144's static HTML contains UTC message times. The browser previously
formatted the same values in its own timezone, causing React hydration error 418
outside UTC. SQLite's offset-free CURRENT_TIMESTAMP values also need UTC parsing.

The presentation-only `CommsMessageTime` component:

- Reads only the existing public-safe `created_at` value, with no new data source.
- Handles ISO timestamps with explicit offsets and offset-free SQL/ISO timestamps.
  Offset-free values follow the existing SQLite UTC convention, never browser time.
- Renders a fixed `HH:mm UTC` label plus canonical ISO `dateTime` and title.
- Omits missing or unparseable timestamps instead of inventing a current date.
- Requires no effects, browser storage, network calls, settings writes or hydration
  warning suppression. It does not change stored timestamps or API contracts.

The rest of the Comms shell is unchanged. The label gains only its timezone suffix.
PR #149 remains a separate draft design contract and is not merged by this fix.

## Validation

- Full `npm test`: pass, including the expanded Comms tests and existing access,
  auth, billing/readiness, owner, profile, privacy, progression-boundary, review,
  event, Server Wars/scoring and CTF coverage.
- `npx tsc --noEmit --incremental false`: pass.
- `npm run lint`: no errors; four pre-existing warnings outside this change.
- Focused lint for changed component/test/QA files: pass.
- `npm run build`: pass, 55 static pages exported, with both Comms flags and live
  checkout off. No environment files or Cloudflare configuration were changed.
- `git diff --check`: pass.
- Server-rendered fixtures: five timezones, ISO/SQLite formats, explicit offsets,
  midnight/year rollover, DST boundary dates, invalid/null input, and the actual
  full shell integration. Output is byte-identical between timezones.
- Real Chromium hydration against the exported `/community` HTML: UTC and London
  desktop, New York mid-width, Kathmandu mobile, Kiritimati reduced-motion mobile.
  All five show identical server/browser times, zero hydration errors, no overflow,
  no broken images, disabled composer, no Comms reads, no non-GET actions, no remote
  traffic or analytics, and no WebSockets. Logo video/still fallback verified.

Local browser evidence is in `comms-timestamp-qa` under the originating Codex task
directory: five screenshots and `results.json`. These are synthetic local preview
artifacts, not stored chat history, private user information or production QA.

## Repeat rendered QA

Build with `NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED=false`,
`DZN_COMMS_MESSAGE_HISTORY_READ_ENABLED=false`, `DZN_LIVE_CHECKOUT_ENABLED=false`
and `NEXT_TELEMETRY_DISABLED=1`.

Run `node scripts/qa-dzn-comms-timestamps.mjs`. It uses an installed Playwright
package or the absolute module path in `DZN_QA_PLAYWRIGHT_MODULE`, without adding a
project dependency. `DZN_COMMS_TIME_QA_OUTPUT` optionally chooses the evidence folder.
The default is a temporary folder. The harness serves only local exported files
and anonymous API stubs; it never starts Functions or connects to production.
Browser contexts reject remote/non-read requests. HTTP server and browser close
after checks. `--serve` keeps this static preview open for manual inspection;
`DZN_COMMS_TIME_QA_PORT` selects its local port. It is not a real account/backend.

## Security and release boundary

Only the Comms timestamp presentation, its tests, local QA and this handoff changed.
No API/helper/auth, migration, environment, workflow, package/lockfile, database,
billing/ownership, public-profile visibility, ranking/discovery/review, badges,
seasons/events, Server Wars/CTF, XP/calling-card award or eligibility implementation
was changed. Source review confirms the new component is pure and React-escaped.
No provider or external-service access is added.

The current user request authorizes this isolated fix/PR, not another production
release. Keep both Comms flags off. Migration `0065_dzn_comms_read_history.sql`
remains unapplied and separately approval-gated. No sending, reactions, moderation,
AI, live checkout, Stripe/Cloudflare/Discord/Nitrado mutation, retained exports,
production D1 writes or issue #49 changes are authorized by this handoff.

Next: review and explicitly approve this fix's release, verify live hydration across
timezones, then return to PR #149 and the bounded local/test message-sending safety
preflight. Do not treat a timestamp fix as permission to activate chat.
