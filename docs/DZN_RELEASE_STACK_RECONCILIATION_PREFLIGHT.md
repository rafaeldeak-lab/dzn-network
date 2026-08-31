# DZN Release Stack Reconciliation Preflight

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
