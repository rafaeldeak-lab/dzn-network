---
name: dzn-billing-integrity
description: Use for DZN billing, Stripe, plan normalization, entitlements, allowance reservations, subscriptions, checkout, and billing data integrity.
---

# DZN Billing Integrity

Billing changes are high risk.

- Preserve plan normalization, public plan names, entitlement mapping, and legacy plan aliases.
- Protect atomic allowance reservations, exact server counts, subscription integrity, and failed-payment behavior.
- Preserve Stripe webhook verification and idempotency.
- Stripe tool access is read-only unless live production mutation is explicitly approved.
- Do not log payment secrets or raw webhook secrets.
- Validate with `test:billing-plans`, `test:billing-integrity`, TypeScript, lint, build, and security review.
