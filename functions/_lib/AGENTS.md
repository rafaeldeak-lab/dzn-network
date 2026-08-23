# Shared Library Rules

Shared helpers often define auth, billing, Nitrado, ADM, event, and owner-boundary behavior. Treat changes here by the most sensitive subsystem they affect.

- Require regression tests for shared behavior changes.
- Preserve endpoint 401/403 semantics, owner authorization, plan enforcement, webhook verification, token encryption, and same-category enforcement.
- Never expose secrets, raw tokens, encrypted token material, raw production logs, or payment secrets from shared helpers.
- Avoid broad refactors that couple unrelated platform systems.
