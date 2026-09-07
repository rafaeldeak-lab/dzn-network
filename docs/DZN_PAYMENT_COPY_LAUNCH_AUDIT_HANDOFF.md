# Payment copy and launch audit

## Scope and starting state

2026-09-07. Isolated branch `codex/dzn-payment-copy-launch-audit-20260907`, based on PR 160 at `7ab3f09e4dd33fbca750608eed55a47bd6b99710`. This is a tested code candidate, not a live payment launch. The user approved working toward live billing; customer recurring-payment consent and the existing exact release checks are still required.

## Changes

- Restore `/pricing` as a real server-rendered comparison/FAQ page with indexable title, description and canonical URL. It previously redirected to the homepage and lost the owner-return context.
- Remove the duplicate homepage pricing catalogue/modal and unsupported discounts/all-features claims. Keep a short homepage teaser and the old pricing anchor, with explicit links to `/pricing`.
- Centralize free-player, eligible Starter trial, returning paid Starter, Pro, cancellation, recovery and personal-consent disclosures in `lib/billing/payment-copy.ts`.
- Starter: payment method required; eligible accounts get two days from completed Stripe checkout, then GBP 2/month until cancelled. DZN verifies the subscription before granting owner access. Returning accounts need separate no-trial payment confirmation.
- Pro: GBP 10 due on payment confirmation, no trial, GBP 10/month until cancelled. Recognition or owner tools never purchase competitive results.
- Explain Manage Billing, cancellation before the trial deadline, and failed-payment recovery without inventing a refund policy or promising that a success redirect grants access.
- Replace the beta banner and empty-server promotion claiming free new owner listings. Player access remains free; legacy stored Free Listing classifications are preserved.
- Header and `/api/auth/me` presentation link to `/pricing`; neutral Owner Plans wording does not promise every user a trial. No authentication, session, ownership or entitlement decisions changed.
- Dedicated checkout controls fail closed unless both configured and checkout_enabled are explicitly true, preserve only `/setup` or `/dashboard` return paths, reuse the returning-Starter consent dialog, and submit only on a deliberate action. Pro uses the existing protected route and an in-flight guard.
- Do not present unfinished Comms/AI as working billing support. The pricing contact links to the existing public DZN Discord invite; warn against posting payment details publicly.
- Correct the owner dashboard's blanket free-plan sync promise: actual automatic sync needs completed setup, supported logs and eligible owner access. No pipeline or stat formula is changed.

## Validation and security

- Full `npm test` passed. Narrow old source assertions were updated for the real dedicated page rather than removed as a substitute for behavior tests.
- Billing quality profile passed: payment plans/recovery/checkout retries/webhook atomicity/reminders, billing integrity, AutoDev policy, nonincremental types, lint, production build and diff-check.
- Lint has zero errors and five pre-existing warnings (Pulse hook, existing image elements, unused advanced-stats argument). No dependency upgrades or lockfile changes.
- AutoDev audit passed. Local Pages Functions compilation passed; no deploy or remote D1 operation.
- `npm run qa:payment-copy` renders actual exported HTML/JS/CSS with synthetic same-origin API responses. 1440/900/390/320px passed, including reduced motion on mobile, no horizontal overflow, semantic green/red comparison, FAQ keyboard access, paused/missing readiness, unavailable/retry, login-safe return path, returning-payment consent/escape/focus, and explicit checkout payloads. No unexpected external requests or page errors. This is not a real provider payment test.
- Evidence directory: `C:/Users/rafae/Desktop/DZN-Audits/evidence/dzn-payment-copy-launch-audit-20260907`. It contains sanitized screenshots, rendered head and `results.json`; no credentials or customer evidence. `--serve` runs a loopback-only exported preview with payment writes disabled.
- Sensitive diff review: only current-session reads, fixed same-origin API methods and public metadata added; no identity inputs, client grants, price override, storage, tracking, raw evidence, secret, SQL migration, webhook logic or competitive writes introduced. Backend authorization, configured price selection, receipt verification and duplicate protections remain authoritative.
- Independent review caught the anonymous-auth fixture returning 200 instead of the real 401. Corrected the fixture and the client: API errors preserve an additive HTTP status, and only the auth request's 401 becomes a sign-in state. 403/500/503 remain unavailable. No endpoint protection or existing error code/offer behavior was changed. Final full tests, billing quality and rebuilt rendered QA all passed after this correction; the earlier anonymous QA pass alone was insufficient. Independent re-review found no remaining introduced issue in the bounded correction.

## Fresh launch findings, not launch proof

Read-only Stripe dashboard inspection on 2026-09-07 found live Starter GBP 2/month and Pro GBP 10/month. The test catalogue still has Starter GBP 4.99/month, Pro GBP 9.99/month and an older active Premium product. No product or price was changed. Product-level Trials Preview settings are not proof for or against the existing Checkout `trial_period_days` flow.

The following remain unfinished:

1. Review/release the dependency series 152-157, 159, 160 and this candidate in order, retargeting and revalidating. PR 158's setup recovery proof is separate. All were still unmerged at the start of this work.
2. Exact production billing migrations 0066, 0067 and 0068 and their prerequisite/FK checks. Do not incidentally apply Comms 0065. There is no new migration in this copy change.
3. Correct test-mode Price bindings and real Stripe sandbox proof: eligible trial, consumed-trial returning purchase, simultaneous/interrupted checkout, webhook duplicates, renewal, cancellation, failed-payment recovery, customer portal, receipts and hosted payment disclosures.
4. Server-side configured Price verification should cover first-time Starter and Pro as well as returning Starter; the existing returning-only guard is not an all-plan catalogue proof. A wrong environment/price binding must not silently charge an outdated amount.
5. Confirm legal seller name, billing support email, VAT status, purchase/refund terms, invoice/receipt and hosted Checkout settings. Asked the owner; do not invent missing commercial facts. The source-copy scan does not certify every Stripe-hosted screen, cached search result, old message or unpublished future Store contract.
6. Recover FED & FERAL's canonical existing connection and verify real ADM stats after its eligible setup/access steps. Saved token presence or a public label is not proof of current token health or successful sync.
7. The final issue 49 live switch remains a distinct release operation after proof, not something to bundle with source changes, migrations or catalogue edits. Each customer must personally enter payment details and agree to recurring billing.

## Rollback and mutation boundary

Keep live checkout and reminder flags off during preparation. Revert this presentation commit if needed without undoing the parent safety fixes. Preserve billing records; do not clear attempts/claims/receipts to make a customer eligible again. Turning checkout off prevents new attempts but does not cancel existing Stripe subscriptions or stop legitimate renewal webhooks.

No merge, production deploy/migration/D1 write, customer trial/charge/grant/notification, Stripe catalogue mutation, Cloudflare config/secret mutation, Nitrado/Discord runtime action, Comms/AI activation, retained export or issue 49 change occurred in this slice. Hosted CI and final commit/PR references are recorded separately after push.
