# DZN Runtime Dependency Security Upgrade Handoff

Date: 2026-09-07

## Scope

This change updates the application and deployment toolchain before live billing activation:

- `next`: `16.2.6` to `16.3.4`
- `eslint-config-next`: `16.2.6` to `16.3.4`
- `wrangler`: `4.90.1` to `4.116.0`
- `undici`: overridden to patched version `7.29.0`
- compatible transitive packages refreshed through the lockfile

Wrangler is deliberately pinned to `4.116.0`, the newest checked release that still uses stable Miniflare 4. Later Wrangler releases use Miniflare 5 alpha; its compatibility path started the local worker but did not complete the D1 binding lookup used by DZN's billing tests. The `undici` patch override removes the published advisories affecting the stable Miniflare line without weakening the existing D1 test contract.

## Validation

- TypeScript: passed with incremental compilation disabled.
- Full `npm test`: passed.
- Local workerd/D1 billing webhook proof: passed.
- Returning Starter concurrency proof: eight simultaneous requests converged safely.
- Payment setup and one-day trial reminder suites: passed with zero provider calls.
- Production build: passed on Next.js `16.3.4`; all static routes and Pages route patches completed.
- ESLint: zero errors; thirteen advisory warnings remain in pre-existing application code.
- AutoDev audit: passed.
- `npm audit`: zero vulnerabilities.
- `git diff --check`: passed.

## Release Boundary

This branch changes dependency metadata and the generated Next.js type references only. It does not:

- enable live checkout or billing reminders;
- start a trial, charge a customer, or alter an entitlement;
- mutate Stripe products, prices, Checkout settings, webhooks, or customer records;
- change Cloudflare flags, secrets, Pages production, or production D1;
- apply any database migration;
- alter FED & FERAL onboarding or stats;
- activate DZN Comms sending, AI support, or metered AI services.

Merge and deployment remain separate production approval steps.
