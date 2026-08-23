---
name: dzn-nitrado
description: Use for DZN Nitrado integrations, ADM diagnostics, token encryption, service IDs, linked-server association, ownership conflicts, retry, and recovery.
---

# DZN Nitrado

Nitrado changes are high risk when they touch tokens, ownership, service association, or ADM ingestion.

- Keep Nitrado service ID, linked server ID, and guild ID distinct.
- Protect encrypted token storage and `TOKEN_ENCRYPTION_KEY`.
- Preserve exact token-to-linked-server association and same-owner canonical reuse.
- Preserve cross-owner 409 protection.
- Never log plaintext tokens or encrypted token material.
- Validate retry/backoff, recoverable states, and ADM diagnostics when relevant.
