# Nitrado API Rules

Protect `TOKEN_ENCRYPTION_KEY`, encrypted token storage, exact token-to-linked-server association, service ownership, same-owner canonical reuse, and cross-owner 409 protection.

- Treat Nitrado token, ownership, service association, and encryption changes as high risk.
- Never confuse Nitrado service ID, linked server ID, and guild ID.
- Never log plaintext tokens, encrypted token material, token IVs/auth tags, or upstream bearer headers.
- Preserve exact owner boundaries and cross-owner conflict behavior.
- Require Nitrado/ADM regression tests for API behavior changes.
