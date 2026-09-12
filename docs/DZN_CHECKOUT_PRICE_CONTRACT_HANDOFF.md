# Checkout Price contract guard

## Scope

2026-09-07. Separate branch `codex/dzn-checkout-price-contract-20260907`, based on PR 161 at `81a7c4eb7f67855afe038a0d7b0798534772330a`. No schema, route, provider object, deployment or feature-flag change. This closes a code-level catalogue validation gap; it does not certify live billing readiness.

The read-only Stripe dashboard audit found current live base Prices of GBP 2/10 but outdated test Prices of GBP 4.99/9.99. Before this change, only the returning-Starter offer checked actual Price fields. A stale configured first-time Starter/Pro binding could therefore disagree with DZN's advertised base price.

## Implementation

- Extend the existing returning-Price check to all first-time Starter, Pro and explicitly confirmed returning Starter attempts.
- Read the exact configured Price from Stripe before inserting a new checkout attempt or reserving a trial. Require the matching ID, active status, matching live/test mode, GBP, 200 pence for Starter or 1000 for Pro, recurring monthly interval/count 1, per-unit licensed billing, no quantity transformation and no customer-adjustable amount.
- Cache a successful check only within the current request for that exact plan/Price. No cross-request cached catalogue approval, persistence or analytics.
- For uncertain retries and known open Sessions, validate the original frozen Price, not a replacement environment binding or body value. Preserve parameters, customer, API version, idempotency key, explicit returning consent, trial claims and the 23-hour retry boundary. A second post-read age check still protects against a slow provider read.
- Reject bad pricing with a sanitized private 503; Price-service failures use distinct unavailable wording without inventing an existing payment attempt. Do not reset claims, release uncertain reservations, create replacement payments or grant access.
- Provider-verified expired and completed Session handling stays before Price validation. Their existing exact-owner/terminal-state checks can close an attempt even during a Price-service outage.
- Existing paused-live, auth, customer ambiguity and plan-selection checks stay authoritative. No permission, subscription reconciliation, payment webhook, owner allowance, stat formula or competitive logic was changed.

## Proof

- Real local SQLite routes test 38 incorrect Price configurations across both plans, 12 provider failures, exact fixed-price/trial parameters, concurrent creation, unchanged other records, frozen-price replay after a configured Price change, interrupted requests and known open Sessions.
- Explicit expiry and completed/canceled-account closure during a Price-service outage preserve the original safeguards and never create a replacement payment or entitlement.
- Existing Starter/Pro retry, first-customer recovery, returning-consent, webhook atomicity and private reminder suites passed with accurate Price fixtures. Production configuration/readiness still remains a separate check.
- Local workerd/D1: returning consent plus eight concurrent requests converge; each first-time plan rejects a wrong amount without an attempt/trial row, then eight requests at the correct price converge on one attempt/key with no entitlement grant. FK check is clean. Two consecutive final passes. One initial emulator launch exited without diagnostic; a fixture accidentally reused a Session ID, was corrected to unique per-plan IDs, and rerun successfully. No production storage was involved.
- Final full test suite, billing quality profile (billing/integrity/AutoDev/types/lint/build/diff), AutoDev audit and local Pages Functions compilation passed after the last runtime error-copy and test additions. `test:checkout-price-contract` is included in the main billing suite.
- Rendered exported `/pricing` QA at 1440/900/390/320px passed, including actual anonymous 401, denied auth, disabled/unknown/unavailable state, returning consent, safe return destinations and both plans' sanitized price-denial alerts. No redirect/payment offer after price denial, unexpected external requests or page errors. Evidence: `C:/Users/rafae/Desktop/DZN-Audits/evidence/dzn-checkout-price-contract-20260907`.
- Independent bounded source review found no introduced security/idempotency/regression issue. Its suggested completed-session-plus-Price-outage regression test was added and passed. This is not an exhaustive security certification or real Stripe lifecycle test.

## Release and rollback

Retarget/revalidate after PR 161 and the billing dependency series. Keep checkout/reminder flags off while preparing. No new migration, Stripe catalogue mutation or configuration binding change is included. Do not weaken this guard to accommodate the obsolete test catalogue: prepare correct test-mode Prices and bindings, then prove actual provider checkout/trial/renewal/cancellation/recovery/portal/receipt behavior.

Rollback is code-only with checkout paused; preserve attempts/claims/receipts. A wrongly priced pre-existing Session may already have been shared, so blocking its link here does not expire it at Stripe. Do not replace an uncertain attempt or claim it has been canceled. Operator inspection/verified expiry is still required. This guard checks base Price fields, not legal terms, tax settings, currency-conversion settings, account credits, provider portal configuration or hosted product descriptions; those remain launch checks.

Seller name, support email, VAT status and purchase/refund terms await the product owner's answer. The exact production billing migrations/releases, FED & FERAL recovery, and final issue 49 activation gate remain unfinished. No merge, production deploy/D1 migration/write, customer trial/charge/grant/notification, Stripe/Cloudflare/Nitrado/Discord mutation, Comms/AI activation or issue 49 change occurred.

Provider reference checked: https://docs.stripe.com/api/prices/object and https://docs.stripe.com/api/prices/retrieve. Exact commit, PR and hosted CI outcome are recorded after push.
