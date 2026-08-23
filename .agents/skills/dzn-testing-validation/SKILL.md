---
name: dzn-testing-validation
description: Use when selecting, running, or interpreting DZN validation for a change, especially when subsystem risk determines targeted tests versus release-level checks.
---

# DZN Testing And Validation

Choose validation by changed subsystem and risk.

- Docs: diff check plus instruction/skill/AutoDev tests when policies changed.
- UI: relevant UI tests, TypeScript, lint, build, and browser QA.
- Auth: `test:auth-return-flow`, `test:public-access-gating`, relevant API tests, TypeScript, lint, build, and security review.
- Billing/Stripe: `test:billing-plans`, `test:billing-integrity`, TypeScript, lint, build, and security review.
- Nitrado/ADM: Nitrado diagnostics plus relevant ADM parser/import/sync tests. Run Worker dry-run only for Worker-related changes.
- Events: `test:events`, creator governance, CTF, seasons, or Server Wars suites based on the diff.
- GitHub workflows: `test:github-workflows` plus workflow/security review.
- AutoDev: `test:agent-foundation`, `test:autodev`, `test:autodev-codex`, and workflow tests.
- Release/high-risk: subsystem suites plus full-system validation where feasible.

Repair failures caused by the change. Do not weaken tests, skip assertions, or run huge unrelated suites for tiny low-risk edits unless release confidence requires it.
