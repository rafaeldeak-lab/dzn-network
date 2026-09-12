# Map Labels and Named Server Wars Opponents

## Scope and Release Boundary

- Based on main b95efef86dcb55e490a6cefa9cef9977a38520d8 after PR #170. Separate from PR #171's mobile tables, record artwork and beta notice.
- Review and production release remain separate. No database migration is needed.
- No production data, customer, identity claim, payment, Stripe, Worker, secret or configuration mutations were performed.

## Changes

- Public map names use Chernarus, Livonia and Sakhal instead of internal mission identifiers where the existing map configuration recognizes them.
- Advanced showcase badges use Standard, Starter or Pro. Historical Premium, Network and Partner values remain stored unchanged and retain the existing effective Pro interpretation.
- Long advanced-board server names wrap instead of disappearing behind ellipses.
- Exploration uses the existing coarse, aggregate activity samples on a schematic grid. It explicitly distinguishes estimated grid coverage from verified playable land. No new map asset, coordinate source, geographic orientation, raw player position or route is claimed or exposed.
- The owner challenge form searches and selects opponents by name rather than asking for an ID or slug. Loading, empty, retry and paged results are supported. Search, rules and server changes clear the selection; switching away and back cannot restore it. The first eligible ruleset is selected for each server.

## Read-Only Discovery Endpoint

`GET /api/servers/[serverId]/wars/opponents`

- Requires a real session and the existing server-owner or DZN-admin authorization.
- Uses the existing challenge-hosting plan gate, ruleset/category helpers and live-public opponent eligibility checks.
- Excludes self, merged, private, unlisted, hidden, deleted, archived and otherwise ineligible opponents.
- Search uses bound SQL with literal wildcard escaping; reads are limited to 100 candidates per page and a bounded offset. Filtering may leave a sparse page; More servers continues through later candidates.
- Returns only opponent ID, display name, category and next offset. No owner, Discord, guild or payment fields are returned.
- Responses are private/no-store. There is no schema ensure, INSERT, UPDATE or DELETE in discovery. Existing challenge submission still independently checks authorization and eligibility.

## Verification

- Full npm test, including the registered Server Wars and new real-SQLite endpoint tests.
- Tests cover unauthenticated and foreign-owner access, method/server/ruleset validation, plan lock, private/ineligible/self/merged exclusions, literal SQL wildcard and injection-like input, 101-row pagination, bounds, minimal response fields and a read-only SQL guard.
- Label tests cover canonical/legacy plans, known map aliases and aggregate-cell bounds.
- TypeScript and Webpack production export passed. Full lint has no errors and five existing warnings; the changed public-network file retains two pre-existing image warnings.
- `node scripts/qa-map-opponent-picker.mjs` exercises the actual exported dashboard/showcase panels with synthetic data and production-built CSS at 320, 390, 900 and 1440 pixels. It checks radio selection, rules/server/search reset, switching back, initial eligible ruleset, pagination, injected 503/retry, map labels, grid pixels and no horizontal overflow. Phone and desktop screenshots were visually inspected.
- This is component browser QA, not a claim of a complete signed-in dashboard journey or production endpoint validation. The injected 503 is intentional. No real challenge is submitted; the browser harness blocks external requests and all writes.
- Generated screenshots/results stay untracked under artifacts/map-opponent-picker. Run the QA with `--serve` for a local synthetic preview on port 3108.
- Manual permission-focused diff review completed. A separate independent security attestation is not claimed.

## Still Separate

- Licensed terrain assets, verified map masks/orientation and metric reconciliation need their own evidence-backed work.
- No scoring, ranking, match results, competitive eligibility, entitlement rules or stored plan keys change here.
- Real personal stats still require the approved game-identity proof flow. Public-profile zero placeholders and the initial asynchronous profile-anchor scroll found after PR #170 are follow-ups, not silently included.
- FED & FERAL recovery, customer subscription/receipt evidence and Comms activation remain on the saved product backlog.
