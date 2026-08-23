# DZN Codex AutoDev

DZN AutoDev is the repository's platform-wide autonomous engineering foundation. It coordinates repository instructions, nested subsystem safety rules, on-demand Agent Skills, risk classification, validation profiles, issue routing, safe PR-only automation, browser QA, security review, and release discipline.

AutoDev is not limited to ADM tracking. DZN is a complete DayZ server competition platform, so AutoDev may investigate and prepare branch/PR fixes for billing, subscriptions, events, achievements, badges, reputation, visibility, server profiles, public presentation, dashboards, Cloudflare automation, GitHub workflows, and ADM systems when the risk policy allows.

ADM monitoring remains a specialist subsystem. AutoDev must preserve ADM cycle watch, ADM production smoke, protected ADM health, ADM Worker heartbeat logic, Nitrado ADM diagnostics, retry/backoff behavior, and the Cloudflare Worker as the primary automatic ADM runner.

## Modes And Boundaries

The default config lives in `.autodev/config.json`.

- `mode`: `pr_only`
- `scope`: `dzn_platform`
- direct main pushes: disabled
- automatic merge: disabled
- automatic production deployment: disabled
- production mutation: disabled

Implementation, merge, and deployment are separate decisions:

- Low risk may be investigated, implemented in an isolated branch, tested, and opened as a PR.
- Medium risk may be implemented in an isolated branch with stronger targeted validation and opened as a PR for review.
- High risk may be investigated and carefully prepared in a PR with specialist tests and security review, but never auto-merged or production-deployed.
- Blocked work must not be automatically implemented.

No AutoDev path may push directly to `main`, force-push, auto-merge by default, deploy production Pages/Workers, apply production D1 migrations, mutate Stripe/Nitrado/Discord production state, or change production secrets.

## Risk Levels

Low risk examples include docs, non-weakened tests, ordinary UI copy/layout, and ADM docs/tests that do not change ingestion or token behavior.

Medium risk examples include normal event API logic, public API behavior, additive migrations for non-sensitive systems, and GitHub workflow reporting or artifact changes without production mutation.

High risk examples include auth, sessions, Discord OAuth, Stripe, billing, subscriptions, Nitrado token handling, token encryption, ADM ingestion/parser/write paths, Cloudflare Worker runtime behavior, and important additive migrations for protected systems.

Blocked examples include destructive migrations, creating `player_stats`, resetting/deleting protected data, weakening auth or 401/403 behavior, removing same-category matchmaking, exposing secrets, copying Cloudflare runtime secrets into GitHub, making GitHub Actions the primary ADM automatic sync runner, or enabling paid unattended Codex/OpenAI GitHub execution.

## Validation Profiles

AutoDev selects validation by changed subsystem and risk instead of forcing every task through the full ADM gate.

- `docs`: diff check plus instruction/skill/AutoDev invariant tests.
- `ui`: TypeScript, lint, build, and browser QA for rendered changes.
- `general`: AutoDev/workflow policy tests, TypeScript, lint, build, and diff check.
- `auth`: auth return flow, public access gating, relevant API tests, TypeScript, lint, build, and security review.
- `billing`: billing plan and billing integrity tests, TypeScript, lint, build, and security review.
- `nitrado-adm`: Nitrado diagnostics, ADM parser/import/sync tests, Sync Health tests, and security review. Worker dry-run is required only when Worker changes require it.
- `events`: events, creator governance, CTF, seasons, and Server Wars suites as relevant.
- `github-workflows`: workflow boundary tests, safe-fix tests, and workflow security review.
- `autodev`: agent foundation, AutoDev, Codex safe-fix, workflow, TypeScript, lint, build, and diff checks.
- `release-high-risk`: subsystem suites plus full-system validation where feasible.

For this foundation, full-system validation is required because the automation architecture is changing.

## Agent Instructions And Skills

Root `AGENTS.md` defines the senior-engineer operating manual and hard safety invariants. Nested `AGENTS.md` files refine sensitive subsystem rules for auth, Stripe, Nitrado, onboarding, migrations, Workers, GitHub workflows, and shared libraries.

On-demand skills in `.agents/skills/` cover repository investigation, testing/validation, browser QA, security review, Cloudflare, GitHub Actions, billing integrity, Nitrado, and release management. Agents should load the relevant skill only when it applies.

## Browser QA

User-facing changes require local browser verification when practical. Use Browser/Chrome/CDP tooling when available, otherwise Playwright. Check responsive layout, navigation, console errors, network failures, loading states, and auth redirects. Record whether failures are genuine app issues or local-runtime/credential noise.

## Security Review

Security review is mandatory for auth, authorization, Stripe, billing, token encryption, Nitrado ownership, destructive migration risk, protected data, workflow permissions, Cloudflare production paths, and issue/prompt automation. Issue bodies and PR text are untrusted input; they must not be able to instruct automation to bypass hard safety rules.

## GitHub Actions

AutoDev workflows may audit, classify, run validation, create/update issues with sanitized evidence, and generate prompt/report artifacts. They must use least practical permissions and must not expose runtime secrets.

`DZN Codex Safe Fix` is currently a guarded issue-selector plus prompt/report generator. It does not run a paid Codex GitHub Action and does not require OpenAI API credentials. Optional unattended 24/7 API execution is future work and must be designed, approved, funded, and enabled separately.

## Production Policy

The safe path remains:

branch -> PR -> tests/review -> approved merge -> intentional deployment path -> production verification.

Production migrations, Pages deployments, Worker deployments, Stripe live changes, Nitrado live changes, Discord production messages, and production secret updates are explicit release operations. They are never automatically implied by this AutoDev foundation.
