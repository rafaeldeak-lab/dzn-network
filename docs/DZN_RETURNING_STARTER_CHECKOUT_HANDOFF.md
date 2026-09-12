# Returning Starter checkout: local implementation, not live

## Start and scope

- Parent: PR #156, `d0c686b2eea1b5463a43ff27024647586798c3d0`, clean and unmerged when inspected.
- Isolated branch: `codex/dzn-returning-starter-checkout-20260907`.
- This resolves the remaining paid-return product gap after a used Starter trial. It does not activate payments or recover a customer server.
- No new schema migration. Parent billing migrations 0066/0067 still need separate production approval and fresh migration checks. Do not apply Comms 0065 incidentally.

## Contract

An authenticated request still chooses only a server-controlled plan/Price. First-time Starter remains a two-day card-first trial. A used/reserved/ambiguous claim never grants another trial.

A returning Starter offer requires the current account to have a terminal subscription, a known unshared customer, and an already-used claim owned by that same account/customer. Legacy reservations and unresolved identity associations fail closed. The configured Stripe Price is read and verified as active, correct mode, GBP 200 minor units, recurring monthly, interval count one, licensed, per-unit, with no quantity transform. Unavailable/wrong prices produce no offer or Session.

Without matching acknowledgement the private response is HTTP 409 `STARTER_PAID_CONFIRMATION_REQUIRED`, with only the versioned offer, price/terms and opaque confirmation. No attempt is inserted and no provider POST occurs. `accepted_offer` must match the server-derived account/customer/terminal-subscription/claim/Price/key-specific terms fingerprint. It is an acknowledgement identifier, not an authorization bearer token or evidence of the final Stripe payment consent. Normal current-session auth and account checks remain required.

The new offer states: GBP 2 due when the customer confirms payment in Stripe, then GBP 2/month until cancellation; no new free trial. Matching confirmation creates an immutable pending attempt with offer/version/confirmation/custom submit copy, omitting all trial fields. The existing attempt creation timestamp is the local acknowledgement audit timestamp. No separate consent-history, tracking or notification system is added.

The INSERT condition rechecks current terminal account identity, claim ownership/use and absence of a foreign account sharing the customer after the Price read. The unique owner attempt constraint and order-derived idempotency key still choose one attempt across concurrent requests. A changed offer must be acknowledged again. Prepared/unknown retries and known open Sessions keep their stored Price and terms even if configuration changes. They never rewrite the original request or release a used trial. A different plan can inspect/close a known completed/expired Session, but cannot open the pending paid Starter offer.

Actual access continues to depend on verified webhook reconciliation, not confirmation, redirect, Session creation or a user-supplied status. First-time/returning Starter and Pro are tested through the inherited signed-webhook lifecycle. Refund/dispute, renewal, cancellation and failed-payment policies are not redesigned here.

## UI

The existing dashboard Billing & Plan panel now offers Starter as well as Pro instead of hiding Starter from accounts whose effective plan is Free. Starter price text qualifies trial eligibility. Live-paused/unconfigured/current-plan locks remain intact; account authorization is not changed.

`StarterCheckoutButton` displays a native accessible dialog only for the known server offer version. The acknowledgement is unchecked by default; Enter/Space/Escape, focus trapping/restoration, close without submission, loading locks and inline retry errors are covered. Consent is component memory only and discarded on close/reload. It is never stored in browser storage. The customer still personally confirms payment on Stripe.

## Validation and evidence

- New authenticated route regression failed against the parent, then passed with this implementation.
- Returning-offer tests cover no implicit paid fallback, forged/null/wrong-account acknowledgement, eight concurrent requests, immutable retries across changed configuration, lost provider response, used-claim preservation on expiry, wrong Price/mode/currency/interval/amount/quantity rules, stale account change during the provider read, active/overdue subscriptions, first-time trial preservation and disabled live checkout.
- Combined authenticated checkout and signed webhook tests now cover first-time Starter -> cancellation -> confirmed nontrial Starter -> verified replacement, as well as existing Pro cases. Protected linked-server rows stay unchanged.
- `npm run test:returning-starter-d1-local` uses actual local workerd/D1, synthetic provider responses, no Wrangler config and no persistent database. Eight requests converge to one paid attempt/key; claims/account/access remain unchanged.
- Full local suite, billing quality profile (billing/integrity/policy/types/lint/build/diff), AutoDev audit and local Pages Functions compilation passed during implementation. Final validation and hosted CI are recorded in the PR.
- `scripts/qa-returning-starter.mjs` bundles the actual production button/API client against exported app CSS and a local mock-only server. This is rendered component evidence plus a dashboard integration source check, not a signed-in live dashboard or a hosted Stripe checkout certification.
- Rendered proof at 1440, 900, 390 and 320 pixels: clear terms, unchecked default, keyboard dismissal/restored focus, no overflow, disabled sending state, retry, renewed acknowledgement, mock redirect, live-paused fallback, no page errors, no browser storage and no external requests.
- Run rendered QA after `npm run build`, providing the optional `DZN_QA_PLAYWRIGHT_PATH` and `DZN_STARTER_QA_OUTPUT` environment paths. `node scripts/qa-returning-starter.mjs --serve` starts a loopback-only manual mock preview (default port 3088). It cannot create any real payment even when the confirmation is clicked.

## Security and remaining release gates

Manual scoped review: current-session owner binding; immutable offer and price; no client-controlled price/trial; shared-customer and used-claim guards; atomic insertion; idempotent retry; no-store sanitized responses; no checkout entitlement write; no secret or identifier in client offers; no competitive imports/formula changes. Initial validation exposed and fixed an accidental Pro dependency on the trial table, and browser QA exposed and fixed missing focus restoration.

Review parents in order: #152 -> #153 -> #154 -> #155 -> #156 -> this PR, retargeting and rerunning relevant checks after each merge. Do not auto-merge this billing stack.

Still required before live charging: real Stripe sandbox/browser and test-clock proof, receipt/tax/recurring-term confirmation, portal/renewal/cancellation/payment-failure coverage against the actual configured provider, legacy/unknown-attempt operator recovery and retention policy, human security/billing approval, exact migration/release approval, and issue #49 live activation gate. Local synthetic proofs are not a substitute for those checks.

FED & FERAL setup recovery/real ADM sync and private payment/trial reminders remain next. No customer trial was started, reminder queued, payment consent fabricated or paid access granted. No production deployment, D1 write/migration, Stripe mutation, Cloudflare secret/config change, Nitrado/Discord operation, chat/AI activation, retained export or issue #49 change occurred.

## Rollback

Keep live checkout disabled. Revert only this code if needed, preserving all pending attempts, immutable parameters, used-trial claims and payment receipts. Never delete/rewrite payment attempts to bypass a retry lock. A parent version cannot understand the new paid-offer UI contract; keep checkout paused until outstanding paid attempts are reviewed or this version is restored. Do not roll back by reusing a trial, changing a Price on an old key, or granting access manually.

## Provider references checked

- https://docs.stripe.com/api/checkout/sessions/create
- https://docs.stripe.com/billing/subscriptions/trials

The implementation omits trial parameters for this explicit paid-return offer and uses Checkout custom submit text. No Stripe SDK/config version changes or provider setup commands were performed.
