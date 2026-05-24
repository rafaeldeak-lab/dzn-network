# DZN Codex AutoDev

DZN AutoDev is a guarded audit and monitoring system. It is not an unrestricted coding loop and it must not push production code directly by default.

## Modes

- `review_only`: audits, tests, reports, and issue creation only.
- `pr_only`: default. Audits, tests, and safe PR branch proposals only.
- `auto_merge_low_risk`: may auto-merge only low-risk PRs after every gate passes.
- `production_guarded`: adds extended production verification and ADM cycle watching after deployment.

The default config lives in `.autodev/config.json` and keeps direct main pushes and auto-merge disabled.

## Codex Usage

Codex can be used to review PRs or fix issues on AutoDev-created PR branches. Codex should not be allowed to bypass:

- `npm run test`
- `npm run lint`
- `npm run build`
- `npm run worker:adm-sync:dry-run`
- production smoke tests
- protected endpoint 401 checks

Codex should treat high-risk findings as review-required. It must not directly push to production without gates.

## GitHub Actions

AutoDev workflows may run audits, quality gates, production smoke tests, and ADM cycle watches. They may create or update GitHub issues with sanitized evidence.

Do not add OpenAI/Codex secrets unless a specific PR-only Codex review action is configured.

## Production Policy

Cloudflare Pages deploys from `main`. The safe path is:

safe change -> branch/PR -> tests -> merge to main if allowed -> Pages deploy -> production smoke -> ADM watch.

Do not create a separate uncontrolled live push script.
