# NukeTown Complimentary ADM Diagnostics

This source release makes the owner-only ADM discovery and automation diagnostics use the same exact-server automation entitlement as the released schedulers. It does not create or modify a subscription, grant, Cloudflare schedule, Nitrado setting, or production database row.

The diagnostics now:

- report `complimentary_showcase` separately from the real billing plan and billing status;
- use Pro automation cadence only while the exact NukeTown grant and immutable server identity remain valid;
- retain the inactive billing warning without incorrectly recommending that the platform owner buy a paid plan;
- keep the owner-triggered discovery snapshot's guild-scoped cadence on real billing so the exact-server grant cannot accelerate another server in the same guild; and
- fall back to normal billing behavior when migration `0069` is absent, the grant is revoked or expired, or the server identity no longer matches.

Populated local D1 coverage verifies the complimentary diagnostic response, paid-state preservation, truthful canceled billing status, exact access-source label, Pro cadence, and the absence of a false paid-plan recovery instruction. Existing ADM scheduler, discovery, metadata, automation, and showcase suites remain the release gates.

Production migration `0069`, grant activation, Cloudflare authorization, live Nitrado calls, Discord delivery, billing changes, and fresh gameplay proof remain separate controlled operations.
