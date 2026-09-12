# DZN onboarding service proof and activation safety

Date: 7 September 2026. Local implementation; not a customer recovery or production release.

## Start and scope

- Base: main `f3630eede15e99099cd1d86aca57f38f0df6df07`.
- Branch: `codex/dzn-onboarding-service-proof-20260907`, clean isolated worktree outside OneDrive.
- This is independent of the unmerged billing stack, PRs 152-157. It changes no billing contract, price, trial, entitlement, migration or deployment configuration.
- The setup test previously treated successful retrieval/decryption of a saved token as proof of token validity, service access and DayZ game identity. Metadata failures were swallowed, while all three check flags could remain true.
- The old go-live route trusted saved flags without a current provider check. A local regression reproduced HTTP 200 and activation despite a simulated revoked token. The corrected route returns HTTP 400 and preserves pending status.

## Implementation

- New shared proof reads the latest exact owner/server encrypted connection, decrypts only in the server runtime, and checks the exact Nitrado service endpoint.
- Provider verification is a GET only, refuses redirects, has a ten-second timeout covering body consumption, and bounds the response to 128 KiB. Provider error bodies and credentials are never returned or logged by the new helper.
- Verification requires the canonical success envelope and `data.gameserver.game`. Supported provider codes are `dayz`, `dayzps`, `dayzxb` and `dayzstandalone`. Customer names/hostnames, nested debug fields and `game_human` cannot establish DayZ identity. Unknown shapes/codes fail closed and need compatibility review, not an automatic name fallback.
- The requested endpoint binds the service. An explicit returned `service_id`, if present, must match. The game-instance `id` is not assumed to equal the service ID. A stopped server can still be a valid accessible DayZ service; this does not prove log availability or syncing.
- Token validity, service access and DayZ detection are independent results. A confirmed non-DayZ game may prove token/access but cannot pass DayZ verification. Missing/decryption-invalid credentials, 401/403/404, redirects, outages and malformed results cannot pass verification.
- Failed service proof prevents metadata refresh, ADM discovery and initial backfill in the setup test. Existing successful metadata/ADM behavior and mock-only paths remain in place.
- Check persistence uses an atomic D1 batch with update/conditional insert, avoiding duplicate rows for simultaneous first checks without requiring a migration.
- Proof writes are conditional on the same active owner/server/service and latest encrypted connection snapshot. A changed owner, service, token, replacement connection, deletion or merge invalidates the proof.
- Go-live keeps the saved-check prerequisite, repeats current provider verification, and conditionally activates only the same verified association with still-passing checks. Failed checks do not blindly downgrade an already live server to error. No failed proof can activate a pending server.
- Existing private no-store JSON and session authentication are preserved. Request-supplied owner, service, token or server identifiers cannot select the verified account.

## Validation

- New runtime suite: 76 synthetic-provider, real SQLite, authenticated route, snapshot-race, missing credential, mock compatibility, timeout and write-isolation scenarios passed.
- The negative-provider matrix exercises both setup-test and go-live. It asserts no metadata/ADM calls, no import, no secret-bearing response, no unrelated application-table writes and no activation.
- The fixture uses the actual initial migration plus local compatibility columns, encrypted synthetic tokens and real session creation. D1 batch behavior is represented by a SQLite transaction. It does not use a customer token or real Nitrado/Discord/Stripe service.
- Full `npm test` passed; final additions to the new suite passed again. The suite is now part of `npm test` and the billing and Nitrado quality profiles.
- `npm run test:billing-integrity`, Nitrado quality profile, nonincremental TypeScript, lint, production static build, AutoDev audit, local Pages Functions compile and diff checks passed.
- Quality retains its expected security-review-before-merge warning. Scoped manual sensitive-source review covered session ownership, token snapshot binding, redirects, response size/time bounds, error redaction, conditional activation and write scope. This is not a comprehensive independent security certification.
- No UI was changed; no new rendered/live customer QA is claimed. Hosted CI and PR state belong in the PR/review record after commit.

## Recovery and release boundary

No production database migration is needed for this patch. Review and release this PR separately through the normal approval path. Do not incidentally apply Comms 0065 or billing 0066/0067.

FED & FERAL's earlier read-only audit remains a point-in-time baseline: canonical association/token row existed, but setup checks, imported players, import jobs and sync state did not. This implementation neither rechecked nor changed that customer record. Token persistence, a default lifecycle value and a public listing are not evidence of completed setup.

After a separately approved release, use the canonical owner/server association for a controlled verification and recovery. Record token access, DayZ identity, metadata, ADM discovery/readability, first import, player/stat counts and scheduler eligibility separately. Do not fabricate successful checks, duplicate/transfer the server, grant paid access, start a trial or make a token-health claim from these local tests. Existing metadata/import routines are not redesigned here, and current-user multi-server selection retains its existing behavior.

Billing still needs actual approved provider sandbox/consent/renewal/receipt proof and the separate live-payment gate. Private payment-setup and one-day-left reminders remain queued; no notification was delivered or queued in this slice. The owner must personally enter payment details and agree to recurring billing.

Rollback: pause use of the setup recovery flow while investigating. Preserve existing connections and imported data. A source revert needs normal review and must not be used to reactivate the known permissive verification path. There is no schema rollback or customer-data cleanup in this patch.

No production deployment, D1 write, token replay, Nitrado/Discord operation, Stripe mutation, Cloudflare secret/config change, trial/charge, Comms/AI activation, retained-export action or issue 49 change occurred. A fresh public plan GET still returned checkout disabled for both plans.
