# Dashboard Plan Display

Review corrections: unknown/unrecognized subscription statuses remain pending, never Free. Selected-server health stops being authoritative after a failed refresh; retained health remains useful for historical diagnostics, not a fresh plan decision. Browser regressions exercise success followed by failure plus unknown account status at 1440, 900, 390 and 320 pixels.

Overview now requests health once on direct load and server changes, waiting for visibility when necessary, not only after visiting Sync Health. Regular heavy health polling remains restricted to Sync Health. A direct-load regression proves server-specific Pro presentation with actual Free account billing; the billing buttons still represent that Free account. The real no-subscription `free` status remains a known state, not pending.

The dashboard must distinguish an unavailable billing response from a confirmed Free plan.

- Server badge/theme previews use the selected server's fresh effective plan when available, then the existing account billing or authenticated navigation plan. Legacy Premium/Network/Partner access is displayed as Pro.
- Auth navigation Free is ambiguous because its billing lookup failure uses the same Free response as no account. Do not use it to confirm a Free server plan; wait for successful health/billing instead. Positive known Starter/Pro navigation remains a display-only fallback. The shared auth response is unchanged.
- Ignore another server's health, stale health and browser-only fallback health for this decision.
- Hide plan-dependent previews while every source is unknown instead of silently choosing Starter.
- Billing comparison uses actual billing state only. Unknown billing stays pending and cannot start checkout from its buttons. A confirmed legacy Pro-equivalent subscription marks Pro as current.
- Advertising labels and cooldown estimates remain pending when their supporting data is unavailable.

This is display and checkout-pending protection only. Backend entitlements, subscriptions, grants, automation cadence, Stripe, discovery weights and competitive calculations are unchanged. It does not create a permanent complimentary server grant.

The platform owner's separate requirement is for exactly their personal advertising server to retain complimentary Pro capabilities, bound to its immutable server and owner identities, not its name and not all accounts/servers. A durable server-specific entitlement and projection/reconciliation review is still required; do not use an account-wide paid subscription rewrite or fabricate a Stripe payment.

Tests: `npm run test:dashboard-package-visibility` includes executable missing-data, legacy-plan, current-server and status cases. Build then run `node scripts/qa-dashboard-plan-display.mjs` for synthetic phone/mid-width/desktop checks. This harness sends no production or payment requests.
