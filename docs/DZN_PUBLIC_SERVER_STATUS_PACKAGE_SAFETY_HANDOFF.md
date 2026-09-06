# Public server status and package safety

## Scope and release boundary

Base: main `20491ade9d4124df5c78a979a875da483a8f6d19`, following the separately approved PR 150 timestamp release.
Branch: `codex/dzn-owner-status-pro-summary-fix-20260906`.
This is a separate code fix for review, not a customer account repair or production release. No migration is needed.

The owner onboarding audit found a saved Nitrado association and token, an existing canonical linked server and a completed allowance reservation, but no completed final setup verification or sync history. It also found a permanent Free record rather than a Starter trial. Customer identifiers and private audit evidence are deliberately excluded from this PR.

## Fixed boundaries

- Public profile/card presentation no longer makes unconditional Verified Owner, DZN Verified, Live or Network online claims. A saved token or the default `active_live` lifecycle is not proof of verification or an online server.
- Incomplete setup is labelled explicitly. Missing check evidence shows Status not checked. Existing check timestamps are not dedicated successful online-status evidence, so checked live records show Status unavailable rather than reusing an old online/offline boolean. Historical lifecycle presentation takes precedence.
- The public server mapper distinguishes pending setup from an active lifecycle default. The admin lifecycle description no longer asserts that a configured lifecycle guarantees sync is running.
- Per-server advanced summaries redact build/raid/travel/exploration values for Free/Starter and inactive paid packages. Existing numeric fields stay zero when locked for compatibility; access flags remain authoritative and UI values say Pro required.
- Exploration redaction clears all activity-derived values, top explorer identity, last activity and map overlay cells, preserving only static map configuration.
- `ownerScoped` is not a paid-package override. Both direct public endpoints share the same projection; caller-supplied query flags cannot change it.
- Every per-server request rechecks visibility and current normalized subscription before using a bounded, DB-scoped cache keyed by server metadata/package state. Downgrades and hidden listings cannot reuse a previous Pro response on a subsequent read.
- Both endpoint responses use no-store headers. Missing-schema/data failures preserve the existing unavailable fallback with no summary. Previously downloaded responses cannot be retroactively erased.
- Per-server reads no longer call the legacy ADM schema/backfill ensure helper. They execute SELECT/WITH queries only; normal migration/ingestion maintenance remains elsewhere. The global competitive leaderboard builder is unchanged.

## Package matrix

| Package/status | Basic summary | Pro summary/Top 15/map | Owner tools or billing changed |
| --- | --- | --- | --- |
| Free active/inactive | Unchanged | Locked/redacted | No |
| Starter trialing/active | Unchanged | Locked/redacted | No |
| Pro active | Unchanged | Available | No |
| Premium/Network/Partner active or supported trial status | Existing normalization | Available | No |
| Pro canceled/past_due/expired | Unchanged | Locked/redacted | No |

No ranking, discovery, review, badge, season, event, Server Wars, CTF, XP, calling-card or eligibility formula changes. No ownership transfer, extra server reservation, token replacement, trial start or entitlement grant.

## Tests and review evidence

- Release review correction: metadata failure, ADM player-list fallback, and even successful Nitrado player-count-only refreshes advance check timestamps without updating online state. Without a dedicated successful status timestamp, the presentation must remain unconfirmed. Regression cases cover both retained boolean states, all three source variants and four count-status variants; the rendered Pro case also denies both old online/offline labels. No ingestion or public payload changes are needed for this conservative fix.

- `npm run test:public-access-gating` now includes premium-showcase and advanced-leaderboard checks, ensuring CI runs the regression.
- New actual in-memory SQLite/route tests cover 11 package states, populated build/travel/exploration fixtures, basic kills/deaths/player parity, owner-mode denial, forged query flags, aliases, cached downgrade, hidden cached profiles, DB cache isolation and unavailable reads.
- The read wrapper rejects all non-SELECT/WITH statements during route execution. Snapshots prove imported rows and linked-server settings are unchanged. Fixture seeding is explicit, local and synthetic; outbound fetch is forbidden.
- Full `npm test`, nonincremental TypeScript, lint and static build passed. Lint reports four existing warnings: three unchanged image elements and the unused identifier in the existing owner advanced-stats stub.
- `npm run test:billing-integrity` passed, including ownership/reservation regressions. Full suite includes billing plans, checkout readiness/safety, authentication, lifecycle, ADM, reviews, awards and competitive gates.
- Local Wrangler Pages Functions compilation passed. This compiles only; it does not deploy or apply migrations.
- Rendered export QA passed pending profile desktop (1440), mobile (390), listing mid-width (1024), active Pro desktop and unavailable mobile/reduced-motion states. No page errors, overflow, missing images or WebSockets.
- The existing discovery card emits a promotion impression attempt on the listing view. The harness explicitly blocks and records that one baseline request before delivery; no tracking was added or production endpoint used. Other network/mutation attempts fail QA.
- Manual inspection confirms the pending header and mobile locked summaries fit. No new visual assets or background changes.

Reproduce rendered QA after build:

```powershell
$env:DZN_SERVER_SAFETY_QA_OUTPUT = '<local evidence directory>'
$env:DZN_QA_PLAYWRIGHT_MODULE = '<installed playwright index.mjs>'
npm run test:premium-showcase
node scripts/qa-public-server-package-safety.mjs
```

The test emits only synthetic free/pro payloads. The QA server serves static exports and local mock APIs. It creates no sessions, provider connections or real customer data. `--serve` permits a persistent local preview on `DZN_SERVER_SAFETY_QA_PORT`.

Local evidence for this run: `C:\Users\rafae\Documents\Codex\2026-08-25\referenced-chatgpt-conversation-this-is-an\owner-status-qa` (JSON and PNG files, not committed).

## Remaining owner recovery decisions

1. Review/release this code PR separately. It corrects presentation and information exposure; it does not complete the owner's setup or start background tracking.
2. Decide explicitly whether existing permanent Free owners receive temporary free beta tracking while checkout is paused. Do not impersonate a Stripe trial, backdate one, grant Pro or enable live checkout to work around this decision. Starter remains a two-day trial then GBP 2/month through the approved billing flow.
3. Any basic beta-tracking implementation must preserve canonical ownership, saved token/association and existing reservation; use a separate auditable policy and test both Pages selectors and the actual ADM Worker selection path. Finishing setup alone does not resolve the current Free/inactive scheduling exclusion.
4. The owner must complete the existing final review/test step under their own session. Token validity has not been checked in this task. Do not decrypt/replay their token, mark them verified/live or write their account without specific authorization and verification.
5. After the approved account access policy and setup checks, verify real metadata/ADM sync and Free/Starter restrictions. Never reset existing stats or relink the same service as a new server.

## Rollback and other backlog

Code rollback is a separately approved revert/release only; no data migration or data rollback is needed. Rolling back also restores the old misleading labels and Pro-summary exposure, so a forward fix is preferable. Keep Comms read flags off and migration 0065 unapplied until separately approved. PR 149 remains draft/design-only. Sending, reactions, moderation/timeouts, presence, support launcher and public-DZN-info-only AI support remain queued, not activated. Live checkout stays disabled; issue 49, Stripe, Cloudflare config/secrets and production D1 are untouched by this slice.
