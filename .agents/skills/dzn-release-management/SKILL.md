---
name: dzn-release-management
description: Use for DZN branch/worktree setup, release reconciliation, migration readiness, PR creation, CI monitoring, previews, and production verification planning.
---

# DZN Release Management

Release work must keep source changes separate from production mutation.

1. Use an isolated branch/worktree and verify the base SHA.
2. Reconcile release state before editing migrations or deployment workflows.
3. Confirm migration readiness without applying production migrations unless explicitly instructed.
4. Open PRs for review; do not push directly to main or enable auto-merge by default.
5. Monitor relevant CI and fix branch-caused failures.
6. For preview or production validation, record exactly what was checked.
7. Do not mutate production Pages, Workers, D1, Stripe, Nitrado, Discord, or secrets without an explicit production gate.
