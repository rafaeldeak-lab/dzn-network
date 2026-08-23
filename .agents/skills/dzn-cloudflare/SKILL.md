---
name: dzn-cloudflare
description: Use for DZN Cloudflare Pages, Workers, D1, Wrangler, production or preview deployment, Time Travel, Worker cron, and subrequest-budget changes.
---

# DZN Cloudflare

Cloudflare work defaults to read-only investigation and preview-safe validation.

- Distinguish Pages from Workers and production from preview.
- Do not deploy production Pages or Workers without an explicit release instruction.
- Do not apply production D1 migrations or use Time Travel recovery during routine development.
- Use Wrangler dry-runs where relevant.
- Preserve Cloudflare Worker cron ownership for ADM automation.
- Watch Worker subrequest limits, retry/backoff behavior, and scheduled-trigger cadence.
- Keep production gates explicit and auditable.
