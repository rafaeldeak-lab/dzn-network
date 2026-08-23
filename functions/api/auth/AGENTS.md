# Auth API Rules

Protect sessions, Discord OAuth, callback/return flow, cookies, redirect validation, and 401/403 semantics.

- Treat auth, session, Discord OAuth, and cookie changes as high risk.
- Require auth regression tests for API behavior changes.
- Do not silently loosen access control, redirect validation, origin checks, callback validation, or cookie security.
- Preserve unauthenticated endpoint behavior: protected endpoints must keep returning 401/403 as designed.
- Never log session secrets, OAuth secrets, tokens, callback codes, or raw cookies.
