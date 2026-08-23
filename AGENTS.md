<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes. APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any Next.js code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# DZN Senior Engineer Operating Manual

DZN Network is a complete DayZ server competition platform. Treat this repository as production software for server owners, players, billing, events, ADM automation, and Cloudflare infrastructure. Work from the current code and local documentation, not memory.

## Normal Autonomous Workflow

1. Inspect every applicable `AGENTS.md`, starting at the repo root and then the affected subsystem directories.
2. Inspect Git/worktree state before editing. Use isolated branches/worktrees for implementation work.
3. Identify the affected subsystem and risk level before deciding how much validation is required.
4. Load relevant Agent Skills, tools, or plugins only when they fit the subsystem.
5. Read current official or local documentation for fast-moving APIs. For Next.js, use `node_modules/next/dist/docs/`.
6. Investigate the root cause before writing code.
7. Implement the smallest coherent production-quality solution.
8. Add or update regression tests for behavior changes.
9. Run targeted validation for the subsystem and risk.
10. Repair failures caused by the change; do not weaken tests to get green output.
11. Perform browser QA for user-facing changes.
12. Perform security review for sensitive changes.
13. Review the final diff for scope, safety, secrets, and accidental churn.
14. Commit coherently.
15. Push only the isolated branch.
16. Create a PR.
17. Monitor relevant CI.
18. Fix genuine CI failures caused by the branch.
19. Never claim completion without validation evidence.

The product owner should not normally be asked to edit source, run terminal commands, run Git, inspect logs, fix routine failures, or make low-level implementation choices. Escalate only for genuine product/business decisions, unavailable credentials that cannot be resolved automatically, irreversible or high-risk production operations, destructive data operations, live billing or financial mutation, legal/compliance decisions, or protected-system approval where required.

## Engineering Rules

- Fix root causes. Do not add placeholder or TODO implementations unless explicitly requested.
- Preserve established architecture and local helper APIs.
- Keep edits scoped. Do not perform unrelated mass formatting or cleanup.
- Require tests for all API behavior changes.
- Require tests for changes affecting billing, subscriptions, achievements, reputation, badges, visibility, rankings, profiles, events, or plan enforcement.
- Do not commit secrets, tokens, credentials, raw production data, or sensitive diagnostics.
- Do not weaken authentication, authorization, endpoint 401/403 behavior, webhook verification, token encryption, owner boundaries, or same-category matchmaking.

## DZN AutoDev Scope

DZN AutoDev is platform-wide autonomous engineering, not ADM-only. It may investigate, validate, and prepare PRs for normal DZN platform systems when policy allows.

Allowed ADM systems:
- ADM discovery
- ADM imports
- ADM diagnostics
- ADM Worker health
- ADM Sync Health dashboard
- ADM automation
- Nitrado integrations
- ADM production monitoring

Allowed platform systems:
- Billing
- Stripe
- Subscription plans
- Plan enforcement
- Server achievements
- Badge systems
- Reputation systems
- Server profile enhancements
- Public leaderboard presentation
- Visibility ranking systems
- Server discovery systems
- Featured server systems
- Seasonal competitions
- Crown systems
- Server vs Server events
- Tournament systems
- Public statistics presentation

Allowed dashboard systems:
- Owner dashboards
- Subscription management
- Billing pages
- Plan comparison pages
- Achievement management
- Server profile management
- Analytics presentation

ADM monitoring remains a specialist subsystem. Do not genericize away or delete ADM cycle watch, ADM production smoke, protected ADM health, ADM Worker heartbeat logic, Nitrado ADM diagnostics, ADM retry/backoff logic, or the Cloudflare Worker as the primary ADM automatic runner.

## Risk And Automation Policy

- Low risk: investigate, implement in an isolated branch, test, and open a PR automatically. No direct main push, auto-merge, or production deployment.
- Medium risk: investigate and implement carefully in an isolated branch with stronger targeted validation. Open a PR for review. No auto-merge or production mutation.
- High risk: investigate and, when the fix is well understood, implement carefully in an isolated branch with specialist tests and security review. Open a PR for human review. Never auto-merge or production-deploy automatically.
- Blocked: do not implement automatically. Create/report findings for human approval.

Flag auth/session/Discord OAuth changes as high risk.
Flag Stripe billing/subscription changes as high risk.
Flag `TOKEN_ENCRYPTION_KEY` or Nitrado token handling changes as high risk.
Flag important migrations as high risk unless clearly additive and isolated.
Flag any Worker change that may exceed Cloudflare subrequest limits as P1.
Flag any workflow that copies Cloudflare runtime secrets into GitHub as P1.
Flag any workflow that makes GitHub the primary ADM auto-sync runner as P1.
Flag any dashboard Sync Health page that exposes manual owner controls as P1.

## Absolute Safety Invariants

These are forbidden unless the user gives explicit, specific approval where approval can make the operation safe. Some remain forbidden even with routine feature approval:

- Work directly in the OneDrive checkout for implementation.
- Work on or alter the preservation branch or recovery history.
- Push directly to `main`, force push, or rewrite `main` history.
- Deploy production Pages or Workers as part of normal development.
- Modify production D1, apply production migrations, or restore D1 Time Travel.
- Change production Stripe state.
- Change Nitrado production state.
- Send Discord production messages.
- Modify production secrets.
- Weaken authentication or authorization.
- Weaken endpoint 401/403 protection.
- Create a `player_stats` table. DZN uses `player_profiles`.
- Reset or delete `player_profiles`, kills, deaths, events, sessions, or subscriptions.
- Replace `player_profiles`.
- Remove same-category matchmaking guarantees.
- Make GitHub Actions the primary ADM automatic sync mechanism.
- Copy runtime Cloudflare secrets into GitHub.
- Expose tokens or credentials.
- Introduce a paid OpenAI/Codex GitHub Action.
- Add `OPENAI_API_KEY`.
- Enable unattended 24/7 paid Codex execution.

Treat destructive migrations as P0. Treat any creation of `player_stats` as P0. Treat protected-data resets/deletes as P0. Treat any weakening of endpoint 401/403 protection as P0.

## Protected Systems

Major refactors in these systems require extreme caution and explicit human approval before risky direction changes:

- ADM ingestion pipeline
- Nitrado token handling
- Sync workers
- Cloudflare Worker infrastructure
- Authentication
- Discord OAuth
- Stripe webhook processing

Use read-only investigation by default for Cloudflare, Stripe, GitHub production settings, and live diagnostics. Production writes are release operations, not routine coding tasks.
