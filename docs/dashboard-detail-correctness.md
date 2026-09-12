# Dashboard Detail Correctness

This display-only patch follows the selected-server plan work in PR #176. It does not grant complimentary Pro or change account billing, subscriptions, permissions, automation, awards or competitive outcomes.

- The raw billing period timestamp is authoritative. Expired periods are labelled historical, not shown as upcoming renewals; missing/invalid timestamps stay unknown. Active future periods can show renewal/cancellation, while inactive future periods are labelled neutrally. A stale period is not repaired or replaced with an invented date.
- Advertising GET returns a period count and cooldown, not a monthly bump quota. Display the count only. Organic bumps are separate from the canonical monthly promotion-credit allowance.
- Legacy Premium/Network/Partner credit presentation uses the canonical Pro public contract, including inactive-plan handling.
- Unknown Server Wars access is not Free. Known legacy Pro access is labelled Pro. Missing challenge denial reasons do not invent an upgrade requirement.
- Overview remounts reattach visibility observers without adding polling or changing request-time analytics.
- The advanced-stats route currently has no implemented durable snapshot reader. Do not promise another import will populate it; a background publisher/reader is separate work. Do not restore heavy raw-event reconstruction on dashboard GET.

Verification: `npm test`, `npm run lint`, production webpack build and `node scripts/qa-dashboard-plan-display.mjs`. Browser QA uses a built local site, synthetic fixtures only, blocks external network and all non-GET API calls, checks 13 scenarios at 320/390/900/1440px, captures screenshots and checks overflow/browser errors. It does not test a real payment or new gameplay import.

Release boundary: no migration, production configuration/secret change, Stripe mutation, Nitrado action, Discord message or customer charge is required. Review and release separately; keep exact NukeTown complimentary access, source recovery and real advanced snapshots on the operational backlog.
