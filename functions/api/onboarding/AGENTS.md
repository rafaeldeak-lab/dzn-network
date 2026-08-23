# Onboarding API Rules

Protect allowance reservation integrity, atomic capacity checks, exact Nitrado association, failed-token recovery, draft/canonical server lifecycle, and cross-owner conflicts.

- Treat onboarding changes that touch billing allowances, Nitrado association, ownership, or token persistence as high risk.
- Require tests for reservation counts, plan limits, token validation, failure recovery, and owner conflict behavior.
- Do not create orphaned canonical servers or consume allowances without a durable recovery path.
- Never log plaintext Nitrado tokens or token encryption material.
