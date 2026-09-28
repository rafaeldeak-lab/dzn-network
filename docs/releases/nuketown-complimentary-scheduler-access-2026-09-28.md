# NukeTown Complimentary Scheduler Access

## Scope

This release lets the existing exact NukeTown complimentary showcase grant participate in scheduled server status, live player count, ADM discovery, ADM processing, and dedicated ADM Worker selection. It does not create, update, or infer a customer subscription.

The scheduler entitlement projection is linked-server scoped. An active grant can produce a Pro-equivalent runtime row only for the immutable NukeTown server, owner, Discord account, guild, and Nitrado service identity defined by migration `0069`. Other servers in the same guild remain on their own billing entitlement.

## Safety

- Existing active or trialing subscriptions keep their established scheduler path.
- Active Pro-compatible billing takes precedence over the complimentary grant.
- Missing migration `0069` falls back to the existing paid-only selectors.
- Grant expiry, revocation, owner transfer, identity drift, hidden lifecycle state, or an inactive server removes NukeTown from selection.
- Complimentary selections are revalidated immediately before metadata or ADM external work starts.
- Revocation after selection skips the operation without contacting Nitrado.
- The existing bot-aligned restart schedule, cron cadence, fairness ordering, and per-run budgets are unchanged.

## Verification

The populated local D1 suite covers all five selectors, exact-server isolation, truthful runtime access labels, paid-path preservation, missing migration fallback, billing preservation, grant revocation, and post-selection revocation before external work. The existing scheduler, metadata fairness, ADM runner, metadata runner, automation plan, and automation health suites remain green.

## Release Boundary

This source release does not apply migration `0069`, grant or revoke production access, call Nitrado, change a Cloudflare schedule or feature switch, send a Discord message, or alter billing. Production entitlement state and fresh gameplay proof remain separate controlled checks.
