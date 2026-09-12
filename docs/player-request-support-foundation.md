# Player Request Support Foundation

## Scope

This release adds the first support slice, not the full Discord approval workflow.

- `/owner?view=player-requests` reads network-wide requests through the existing platform-owner allowlist. Ordinary server owners and generic DZN administrators cannot use this endpoint.
- Search by request, account, Discord, game or server reference/name; filter by the four stored claim states. Lists and existing audit histories use bounded keyset pagination. Selected requests survive reload and browser navigation.
- Details distinguish the requesting account, Discord identity, exact game account, connected server/current owner, imported-profile presence, current verified link and recorded review note/history.
- The existing server-owner queue also shows the request reference, DZN account reference, requesting Discord ID and action purpose. Its own-server/DZN-admin review permissions remain unchanged.
- Claim creation and its audit insert are atomic. Approval/rejection recheck pending state and current server ownership inside the transaction. Approval also rechecks exact-profile identity and current link conflicts. Link, compatibility attribution and audit writes roll back together on failure.

## Boundaries

No new migration is required; this uses migration 0064's existing tables. No billing, entitlement, competition, ranking, scoring, progression, profile-publication, provider-token or Discord configuration changes are included. This release never automatically approves a customer's identity claim. A name or submitted identifier is not proof.

The support API is GET-only, private/no-store, and selects only necessary columns. Free-text notes/names are bounded, control characters removed, obvious credential patterns redacted and URLs withheld. It does not fetch evidence links, select provider secrets or expose payment/session credentials. React renders strings as text.

The timeline is the existing recorded identity audit history. It does not invent missing historic events, record message delivery, log support reads, or provide a complete immutable archive. Existing foreign-key deletion/retention behavior is unchanged. This phase does not introduce staff-only evidence or attachment access.

## Validation

- `npm test`, including new real SQLite transaction and support-route tests.
- `npm run test:player-game-identity-linking`: statement-by-statement failure rollback; simultaneous decisions; stale status/owner/profile/link changes; existing same-account link reuse; cross-owner denial; claim/audit consistency.
- Support API tests cover anonymous, ordinary owner, generic admin and platform-owner sessions; no-store headers; read-only queries; literal wildcard/search injection handling; bounded list/history pagination; redaction; missing storage.
- `npx tsc --noEmit --incremental false`, ESLint and AutoDev audit.
- Local isolated worktrees reuse dependencies via a junction, so local rendered exports use `npm run prebuild`, `npx next build --webpack`, then `node scripts/patch-pages-routes.mjs`. Turbopack cannot resolve this external junction. The repository build configuration is unchanged; CI/Pages must independently pass the standard build.
- `node scripts/qa-player-request-support.mjs`: synthetic/private API fixtures at 1440, 900, 390 and 320 pixels, search/status, request/history pagination, deep-link/reload/back, long identifiers, UTC rendering from a non-UTC browser, errors/empty/retry and no application writes. Screenshots are local QA evidence, not production proof.
- `node scripts/qa-player-game-identity-claims.mjs`: existing owner-review UI regression coverage at 1440, 900 and 390 pixels with mocked decisions only.

## Next Slices

1. Provenance-aware revocation/reconciliation, required reasons, separately scoped staff notes and support-action auditing. Revoking only the link row is insufficient while the legacy profile Discord attribution can still authorize stats. Do not delete stats or clear unrelated proven associations.
2. Private website notifications and durable delivery outbox, retry/deduplication, missing-evidence requests and safe owner/player messages.
3. Opted-in private Discord alerts linking to authenticated website review, with destination permissions and delivery diagnostics.
4. Signed Discord button/modal decisions using the same authoritative review operation and fresh server-scoped permissions.

Future expanded states, durable outbox/evidence and retention controls need separate schema review and explicit production migration approval. FED & FERAL recovery, customer billing verification, advanced-board availability and Comms/support remain separate queued work.
