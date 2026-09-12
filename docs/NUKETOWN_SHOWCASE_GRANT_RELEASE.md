# NukeTown Showcase Grant: Backend Review Boundary

This branch is the first bounded implementation, not the complete NukeTown Pro rollout. Do not activate the production grant until the remaining server capability consumers and release gates below are complete.

## Delivered In This Branch

- Additive migration `0069_server_showcase_grants.sql` creates a capability ledger separate from billing. It inserts no grants and changes no subscription, account, gameplay or scheduler row.
- Only the exact existing NukeTown linked-server / owner / Discord / website-guild / Nitrado-service tuple is supported. Database constraints and the read/write predicates enforce the tuple independently. The website guild must not be confused with the bot operations guild.
- Resolution requires the current live, active-live, non-merged association. Suspended, transferred, deleted or merged associations cannot receive the exception. Identity changes permanently revoke the original grant; moving an association back cannot revive it.
- Grant and revocation audit events are committed by database triggers with the underlying change. Audit failure aborts the change. Grant bindings and audit history are immutable. Expiry is supported; replacement of an expired or revoked grant requires a separate reviewed action.
- Protected owner listing settings and gallery reads/writes resolve the exact-server grant. Responses expose `serverAccess.source = complimentary_showcase` separately from unchanged billing fields.
- Protected saves recheck the current association and capability source at write time. Gallery replacement is one atomic batch, preserving existing images when authorization changes or an insert fails.
- Platform-owner-only support endpoint `GET /api/owner/server-showcase-access` returns the exact scope, effective grant, latest 20 grant records and paginated audit history. `?before=<nextAuditCursor>` continues the 50-event history pages.
- Its explicit POST grant/revoke operations require a real platform-owner session, same-origin request, bounded JSON, exact-server confirmation, and a request UUID or grant ID. Revocation requires an enumerated support reason. No action is automatically run by installation, reads, webhooks or reconciliation.

## Deliberately Unchanged

Stripe/account status, renewal dates, customer IDs, paid subscriptions, account server-slot allowance, category rules/cooldowns, competitive eligibility, scoring, standings and event results are unchanged. A Pro catalogue lookup is an internal capability decision, never a fabricated active subscription. Existing Pro and legacy Premium/Network/Partner billing remains supported.

No Nitrado commands, bot changes, ADM replay, new gameplay, production Discord delivery, customer charge, paid wheel, secret or configuration mutation is part of this branch. The bot's hourly Europe/London resets remain separate and must be preserved.

## Not Yet Connected

The grant does not yet govern scheduler eligibility/cadence, guild-scoped sync state, metadata/ADM consumer selection, public listing/gallery visibility, advanced showcase availability, promotions/bump allowance, visual loadouts, event-host tools or Discord publishing. The existing settings and public-page clients also need a coherent visible complimentary-access label. Therefore saving media through this backend is not proof that the public page will display it with the grant.

The platform owner console has the protected grant history API, not a new rendered grant-management panel. This is not the complete cross-DZN player-link/request support experience.

Complete these consumers with exact-server resolution before activation. Do not replace guild billing with Pro to bypass the missing integrations, and do not enable this partial grant as if all Pro features are complete.

## Validation

`npm run test:server-showcase-grants` runs populated SQLite tests using all migrations plus the existing runtime metadata bootstrap, actual handler/session checks, and a local in-memory workerd/D1 test. It is included in `npm test` through the settings regression command.

Coverage includes exact identity and same-owner/same-guild isolation, missing schema, missing/expired/revoked/future grants, association changes, legacy paid access, unchanged account entitlements, concurrent requests, immutable history, audit rollback, 401/403, same-origin/exact confirmation, pagination, real gallery validation/writes and revocation races. No external provider calls or Wrangler production configuration are loaded.

Run the full test suite, non-incremental type check, lint, build and system audit. On a Windows worktree using the existing dependency junction, use `npx next build --webpack` followed by `node scripts/patch-pages-routes.mjs`; Turbopack rejects dependency symlinks outside its root. Hosted CI uses a normal dependency install.

## Production Release Gates

1. Finish the remaining consumers, review the final immutable code, and pass populated isolation and protected-write tests for every affected feature.
2. Render the owner/public views at phone, mid-width and desktop widths. Test revoked/mismatched grants, legacy paid users and fresh/free users, not just a Pro badge.
3. Verify exactly one intended pending migration and the existing runtime metadata columns, including `merged_into_server_id` and `lifecycle_status`. Do not apply an unreviewed migration backlog or recreate production tables.
4. Obtain specific approval for migration, application release and the exact NukeTown grant action. The migration itself grants nobody access. Do not use broad feature approval as a database release instruction.
5. Re-read the exact production association and before/after billing, entitlement and schedule fingerprints. Activate only that server, then verify every consumer and support audit readback without creating a paid subscription or charging anyone.
6. Revoke the exact grant ID with a recorded reason if access must be withdrawn. Retain audit/history and user media. Do not drop the ledger or undo protected customer data.

A rollback to pre-grant code removes this new capability source; it does not require deleting a grant or rewriting billing. Revocation does not cancel an existing genuine paid subscription or remove access supplied by that subscription.
