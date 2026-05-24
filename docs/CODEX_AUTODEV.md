# DZN Codex AutoDev

DZN AutoDev is a guarded ADM tracking audit and monitoring system. It exists to keep ADM discovery, Nitrado ADM file reads, unreadable retry/backoff, ADM imports, Sync Health, and ADM production verification reliable.

AutoDev is ADM-only. It does not manage billing, user accounts, Discord OAuth, subscriptions, Stripe, unrelated server settings, unrelated Events/Tournaments, or public marketing features.

## Modes

- `review_only`: audits, tests, reports, and issue creation only.
- `pr_only`: default. Audits, tests, and safe PR branch proposals only.
- `auto_merge_low_risk`: may auto-merge only low-risk PRs after every gate passes.
- `production_guarded`: adds extended production verification and ADM cycle watching after deployment.

The default config lives in `.autodev/config.json` and keeps direct main pushes and auto-merge disabled.

`scope` must remain `adm_tracking_only`.

## Codex Usage

Codex can be used to review PRs or fix ADM-labelled issues on AutoDev-created PR branches. Codex should not be allowed to bypass:

- `npm run test`
- `npm run lint`
- `npm run build`
- `npm run worker:adm-sync:dry-run`
- production smoke tests
- protected endpoint 401 checks

Codex should treat high-risk findings as review-required. It must not directly push to production without gates.

Codex Safe Fix may only act on issues with:

- `autodev`
- `adm-tracking`
- `autodev-safe-fix`
- `low-risk`

Codex must refuse issues or files involving billing, Stripe, Discord OAuth, sessions, subscriptions, account management, unrelated Events/Tournaments, destructive migrations, `player_stats`, `player_profiles` reset/delete, or secrets handling unless explicitly marked for human review.

Allowed Codex fix areas are ADM discovery, ADM Worker cron status display, Nitrado ADM file-read diagnostics, unreadable retry/backoff, ADM import jobs, ADM Sync Health display, ADM production smoke, ADM cycle watch, and ADM-only tests/docs.

## GitHub Actions

AutoDev workflows may run ADM audits, quality gates, ADM production smoke tests, and ADM cycle watches. They may create or update GitHub issues with sanitized evidence.

GitHub secrets required for ADM AutoDev:

- `DZN_CRON_SECRET`
- `SYNC_CRON_SECRET`
- `OPENAI_API_KEY` only if a Codex Safe Fix integration is explicitly enabled

Do not add OpenAI/Codex secrets unless a specific PR-only Codex review action is configured.

## Production Policy

Cloudflare Pages deploys from `main`. The safe path is:

safe change -> branch/PR -> tests -> merge to main if allowed -> Pages deploy -> production smoke -> ADM watch.

Do not create a separate uncontrolled live push script.
