# Stripe API Rules

Protect webhook verification, idempotency, plan normalization, subscription state, billing data integrity, and payment-secret handling.

- Treat Stripe and billing changes as high risk.
- Require billing/Stripe regression tests for API behavior changes.
- Stripe tool or MCP access is read-only by default.
- Live creation or mutation of products, prices, customers, subscriptions, refunds, checkout state, or payment state requires explicit production approval.
- Do not log Stripe secret keys, webhook secrets, payment method data, full customer payloads, or signed webhook bodies beyond sanitized diagnostics.
- Do not mutate production Stripe state from normal development, tests, or PR automation.
