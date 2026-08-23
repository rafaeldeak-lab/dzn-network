---
name: dzn-security-review
description: Use for DZN changes involving auth, authorization, secrets, Stripe, Nitrado tokens, migrations, protected data, workflows, Workers, or production paths.
---

# DZN Security Review

Review sensitive diffs for auth/session/Discord OAuth weakening, authorization regressions, secret exposure, Stripe webhook and billing integrity, Nitrado token ownership, destructive migrations, workflow permissions, and Cloudflare production paths.

Blocked findings stop automation. High-risk findings require human review even when a PR is prepared.
