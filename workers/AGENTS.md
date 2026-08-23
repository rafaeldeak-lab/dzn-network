# Worker Rules

Protect Cloudflare subrequest budgets, cron roles, Worker separation, retry/backoff, and the primary ADM Worker responsibility.

- Treat production Worker infrastructure, cron cadence, subrequest-budget, and ADM import behavior changes as high risk.
- Require relevant Worker checks or dry-runs for Worker changes.
- Keep the Cloudflare ADM Worker as the primary automatic ADM runner.
- GitHub workflows may provide manual backup or monitoring, but must not replace Worker cron ownership.
- Do not deploy production Workers from normal development tasks.
