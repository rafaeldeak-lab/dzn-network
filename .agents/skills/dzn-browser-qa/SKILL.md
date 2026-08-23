---
name: dzn-browser-qa
description: Use for DZN user-facing UI changes, dashboard flows, public pages, auth redirects, loading states, responsive layout, or browser-observable regressions.
---

# DZN Browser QA

For user-facing changes:

1. Start the appropriate local runtime and record the URL.
2. Prefer Browser, Chrome, or CDP tooling when available; otherwise use Playwright.
3. Check desktop and mobile viewports for layout, overflow, loading states, empty states, navigation, and interaction.
4. Inspect console and network failures. Distinguish genuine app defects from local-runtime or missing-credential noise.
5. For auth-sensitive UI, verify redirect behavior and protected-route handling without weakening 401/403 expectations.
6. Capture enough evidence to state what was validated.
