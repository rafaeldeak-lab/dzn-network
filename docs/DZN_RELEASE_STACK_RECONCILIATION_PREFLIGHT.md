# DZN Release Stack Reconciliation Preflight

## Current Reconciliation: 2026-09-12

This section supersedes the operational recommendations in the archived August
31 snapshot below. That snapshot is historical evidence, not a current release
checklist or authority to undo later releases.

- Comparison baseline: `e612c66e6fabed1f1f607da8d517b05d8328d6aa`, PR #184.
- Initial GitHub inventory: 76 open requests. Four target main (#50, #123, #141,
  #149); the other 72 target old feature branches. The original #50-#122 stack
  remains 73 requests, including five drafts. A green merge indicator on an old
  feature branch is not evidence of readiness for today's production main.
- A file-by-file comparison covers all 76 requests. None has every changed file
  identical to this baseline. File differences alone do not prove a feature is
  absent; newer implementations, renamed files and security corrections exist.
  See `DZN_RELEASE_BACKLOG_2026-09-12.md` for the bounded inventory.
- Later main-based releases, not the old stack, delivered the Player Hub
  (#124-#133), profile settings/viewer (#137-#143), stat-link workflow (#145-#148,
  #170, #173-#175), billing corrections (#152-#169), mobile/map/opponent changes
  (#171-#172), dashboard/showcase fixes (#176-#181), and Games Hub (#182-#184).
  This is source-delivery evidence, not blanket live customer verification.
- The standalone #141 session roadmap and #149 Comms contract are now merged
  independently with current checks and review, at `6bc77f373d95d300a2fee9c8193eb71c35406114`
  and `2b938daeee60fe54d1fca9d0bcb483a0e080338e` respectively. Neither activates
  session timers or chat. This #123 refresh records the remaining work.

### Remaining Feature Order

| Area | Current boundary and next concrete work |
| --- | --- |
| Games Hub | Minesweeper, earned website XP/parts, daily wins, workshop prestige, original insignia, animated outpost and original home button are released. DZN Trivia is next, followed by Word Chain and Hide & Seek, with server-validated outcomes and repeat-safe rewards. |
| Multi-game progression | Add lobby/mission categories and equipment collections as real games land. Keep website XP separate from verified DayZ progression and paid plans; no fabricated unlocks, cash rewards or online counts. |
| Global Chat/support | #144/#150 provide disabled read-history foundation; #149 records sending requirements. Next is an isolated local/test sender with atomic concurrency, CSRF, moderation, retention and staff handling before real-user posting. |
| Legacy reviews/progression/community | Review #54-#90 by feature against current main. Preserve useful unique work, reconcile identity/privacy changes and do not restore superseded player/owner gates. Old XP/calling-card code is not proof of genuine player awards. |
| Store and random rewards | #96-#114 remain separate payment-adjacent work. Do not enable old sandbox paths or paid random rewards during reconciliation. A cooldown is not legal or processor clearance. |
| NukeTown/ADM | Preserve the exact-server complimentary Pro access and existing bot reset schedule. Continue genuine automatic import and sustained-sync verification without invented subscriptions or events. |
| Customer recovery | FED & FERAL setup, genuine identity linking and customer billing proof remain individually verified workflows, not inferred from source merges or public Live labels. |
| Maps and badges | Correct Chernarus/Livonia/Sakhal assets and usage rights; continue other badge surfaces and genuine gameplay XP without confusing them with website-game rewards. |
| Owner oversight | Server-scoped approve/decline/revoke reasons and notifications; purpose-limited platform-owner support timelines with audited access. No credential exposure, implicit Discord messages or cross-server identity changes. |

### Current Release Rules

Use narrow current-main releases for unique remaining features. Never retarget an
entire old stacked tip to main as a shortcut, mass-resolve conflicts by choosing
the old tree, or call every old request superseded without semantic review.
Preserve unfinished branches and the dirty OneDrive checkout.

The user has approved merges; each exact candidate still needs its applicable
checks and review. Main merges trigger the configured Pages deployment, so report
that release honestly. AutoDev policy does not itself grant deployment authority.
Do not infer that all repository migrations must be applied: name and verify only
the exact approved migration for its feature. Schema availability and production
activation are separate from source presence. Keep payments, credentials, Nitrado
reset timing, Discord messaging and unrelated runtime settings unchanged.

## Archived Snapshot: 2026-08-31

Date: 2026-08-31

This preflight records the safe release decision before attempting to put the recent DZN Player, Store, profile, community, and Comms work onto the live site. It is intentionally a non-mutating handoff: no merge, deployment, production migration, Stripe change, Cloudflare secret/config change, Nitrado call, Discord production action, Durable Object/WebSocket runtime, analytics/tracking, AI provider credential, metered model call, or issue/PR #49 change is approved here.

## Start State

- Audit branch: `codex/dzn-release-stack-reconciliation-preflight-20260831`
- Audit worktree: `C:\Users\rafae\Desktop\DZN-Audits\worktrees\dzn-release-stack-reconciliation-preflight-20260831`
- Base: `origin/main`
- Base commit: `7f00d2eb6b68bae112eb02d771036c5b97f8e9ea` (`Guard live checkout behind sandbox readiness (#48)`)
- Open PR snapshot from GitHub on 2026-08-31: #50 through #122, 73 open PRs.
- Draft blockers in the open stack: #63, #64, #65, #100, and #101.
- Latest local QA branch checked before this preflight: `codex/dzn-comms-message-history-rendered-qa-20260831` at `fb05b2b36925e4a355195db7bca4bed4fa01dfc2`.
- Production status: not updated by this preflight. The latest QA head was not confirmed as live on `https://dayz-network.com/`.

## Architecture Found

The repository already contains the release discipline needed for this stack:

- `.autodev/config.json` is `pr_only`.
- Direct main push is disabled.
- Auto-merge is disabled.
- Automatic production deployment is disabled.
- Production mutation is disabled.
- `docs/CODEX_AUTODEV.md` defines the safe path as `branch -> PR -> tests/review -> approved merge -> intentional deployment path -> production verification`.
- `docs/PUBLIC_ACCESS_POLICY.md` keeps public pages, logged-in product pages, and owner/protected APIs separate.
- `docs/BILLING_PLANS.md`, `docs/STRIPE_LIVE_SETUP.md`, and `docs/STRIPE_LIVE_ACTIVATION_CHECKLIST.md` keep live checkout paused until a separate explicit go-live step sets `DZN_LIVE_CHECKOUT_ENABLED=true`.
- The active DZN platform plan reserves issue/PR #49 for final live payment activation. Existing main-branch billing docs also reference Issue #46 for Stripe live activation. Release management must reconcile that tracker numbering before any live checkout activation, and neither issue is changed by this preflight.

## Stack Snapshot

The open PRs form a long feature stack, not one independently releasable PR. The current sequence includes:

| Range | Area | Release note |
| --- | --- | --- |
| #50-#53 | Player/owner foundation, Player Hub, saved servers, pricing visual upgrade | Core product foundation and UI work. |
| #54-#57 | Reviews foundation, moderation dashboard, review notifications | User-generated content and owner/admin moderation surfaces. |
| #58-#62 | Challenges, XP, calling-card progression and award audit | Earned player-side progression; competitive isolation must stay proved. |
| #63-#65 | Profile privacy, public profile viewer, profile discovery links | Draft blockers. These must not be treated as release-ready until explicitly resolved. |
| #66-#90 | Profile attribution, event/community member directories, exports, public profile preview/share QA | Depends on profile/privacy assumptions and presentation-only isolation. |
| #91-#95 | DZN Comms architecture, visual shell, interaction contracts, presence counter | Runtime chat sending, WebSockets/Durable Objects, AI Assist, reactions, moderation mutations, and analytics stay blocked unless separately approved. |
| #96-#114 | Safe monetisation/Store preflights, sandbox ledgers, disabled fulfilment, account purchases, private Supporter Card reveal | Store and payment-adjacent work. Live checkout, production Stripe, Cloudflare secrets/config, production D1, and issue #49 stay blocked. |
| #115 | Player navigation access polish | A small user-facing candidate, but it is currently stacked after Store work and should not be merged from that stacked base without reconciliation. |
| #116-#122 | Comms reaction/message contracts, disabled read-only message history, UI integration, rendered QA | Read-only/local-test Comms proof. Sending, persistence, reactions runtime, reports, AI, WebSockets/Durable Objects, analytics, Store/payment changes, and production deployment stay blocked. |

Continuity note: PR #66 is based on `codex/public-profile-cross-surface-attribution-20260825`, which exists remotely but was not present as an open PR in the 2026-08-31 open PR snapshot. That branch/PR relationship must be checked before any sequential merge plan treats #66 onward as continuous.

## Release Decision

Do not merge or deploy the latest stacked head directly.

Reason: merging PR #122 as a route to live would pull a large stack across player identity, public profiles, community directories, Store/payment scaffolding, Supporter Card status/reveal surfaces, and Comms message-history work. That stack contains draft blockers and payment/runtime-adjacent code that requires deliberate review boundaries. A successful local build or QA proof on the latest stack is not enough to approve a live release.

## Safe Paths

Path A: stack unwind and sequential release.

- Resolve or deliberately close/split draft blockers #63, #64, #65, #100, and #101.
- Recheck the missing open-PR continuity around `codex/public-profile-cross-surface-attribution-20260825`.
- Review and merge in dependency order from #50 upward.
- Run each PR's focused tests plus the release-high-risk gate for auth, billing, Store, Comms, profile/privacy, and migration-adjacent changes.
- Apply production migrations only through a separately approved migration preflight with exactly one pending migration and post-apply verification.
- Deploy production only after the approved merge path lands on the confirmed production branch and an explicit deployment approval is given.

Path B: narrow main-based release candidate.

- Start a new isolated branch from current `origin/main`.
- Cherry-pick or reimplement one small user-facing improvement without dragging the whole stack.
- Recommended first candidate: personal player navigation/access polish, because the user has repeatedly asked for a clearer button/path to the individual player page. On current `origin/main`, no `app/player` route is present, so this must be audited against main before implementation.
- Keep Store/payment fulfilment, Supporter Card reveal, live checkout, Comms runtime, message persistence, reactions runtime, AI Assist, analytics/tracking, production migrations, production deployment, and competitive systems out of that candidate.
- Run rendered local QA before any release approval because this is navigation/UI work.

## Merge Gates

No PR from this stack should be merged unless all of the following are true:

- The PR is not draft.
- The PR base is the intended predecessor or has an explicitly documented rebase/cherry-pick plan.
- The PR does not include an unresolved draft blocker in its ancestry.
- Required GitHub checks are green and current for the exact head commit.
- Focused local tests for the affected subsystem pass.
- `npx tsc --noEmit --incremental false` passes.
- `npm run lint -- --ignore-pattern .wrangler/**` passes or any warnings are confirmed baseline-only.
- `npm run build` passes.
- `npm test` passes or any failures are classified as documented baseline failures unrelated to the slice.
- `git diff --check` passes.
- Billing safety remains green with live checkout disabled.
- Security diff review is complete for auth, billing, Store/payment, Nitrado, Discord, profile/privacy, moderation, chat runtime, workflow, migration, or protected-data changes.
- UI-facing changes have rendered desktop/mobile proof, including fallback/error/reduced-motion states where relevant.

## Deployment Gates

No production deployment should happen unless all of the following are true:

- The production branch for `https://dayz-network.com/` and the Cloudflare Pages production project are confirmed in the active release task.
- A separate explicit deployment approval is present.
- The deployed commit is the exact approved merge commit or approved release commit.
- No production D1 migration is pending unless it has its own approved migration preflight and rollback/verification plan.
- No Stripe live checkout, Stripe product/price/webhook mutation, Cloudflare secret/config mutation, Nitrado live action, Discord production message, AI provider credential, metered model call, Durable Object/WebSocket runtime, retained export storage, or issue #49 change is included unless separately approved for that exact mutation.
- Post-deploy verification covers `/`, `/pricing`, logged-out protected route redirects, relevant public APIs, owner/protected API 401/403 behavior, browser console/network health, and the specific changed routes.
- If the deployment does not match the approved commit or routes fail, rollback is triggered through the approved deployment path rather than direct main force-push or manual production patching.

## Production-Mutation Confirmation

This preflight is docs/test only. It does not:

- enable `DZN_LIVE_CHECKOUT_ENABLED`;
- create Stripe Checkout Sessions;
- create or mutate Stripe Products, Prices, webhook endpoints, customers, subscriptions, orders, entitlements, Supporter Cards, earned spins, or wheel runtime state;
- mutate Cloudflare Pages variables, Cloudflare secrets, Workers, Durable Objects, R2, KV, or production D1;
- call Nitrado or Discord production mutation endpoints;
- add chat sending, reaction runtime, moderation mutation routes, analytics/tracking, DZN Assist AI runtime, vector stores, AI credentials, or metered model calls;
- merge, deploy, or change issue/PR #49.

## Next Recommended Slice

Proceed with a narrow main-based **personal player navigation/access release candidate audit**:

- Inspect current `origin/main` for the existing auth header, route map, and user-account surfaces.
- Decide whether `/player` and `/player/profile` should be added now or whether the first live-facing slice should only add a clear logged-in nav button to an existing safe destination.
- Keep the change isolated from Store/payment fulfilment, Supporter Card reveal, Comms runtime, live checkout, production migrations, production deployment, and competitive systems.
- Add focused tests proving logged-out visitors do not see private player links, logged-in players see the personal player path, owner tools remain billing-gated, and no ranking/scoring/billing behavior is changed.
- Run local rendered QA across desktop/mobile before asking for merge/deploy approval.
