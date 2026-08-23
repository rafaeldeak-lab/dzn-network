---
name: dzn-repository-investigation
description: Use when starting DZN repository work, diagnosing a defect, assessing scope/risk, or deciding which subsystem instructions, tools, docs, and tests apply before editing.
---

# DZN Repository Investigation

Use this skill before code changes when repository context, root cause, or risk is not already clear.

1. Read the root `AGENTS.md` and any nested `AGENTS.md` in affected paths.
2. Inspect Git state: worktree, branch, base SHA, status, and remote target.
3. Identify the affected subsystem: auth, billing, Stripe, Nitrado, ADM, events, database, Worker, workflow, UI, docs, tests, release, or unknown.
4. Classify risk before editing. High-risk systems need specialist tests and security review. Blocked operations must stop.
5. Read local source and tests around the failing behavior before proposing a fix.
6. For fast-moving APIs, read current official/local documentation. For Next.js work, use `node_modules/next/dist/docs/`.
7. Prefer root-cause fixes over surface patches. Avoid unrelated refactors and formatting churn.
