# NukeTown Complimentary Event Hosting Release

## Scope

This release lets the existing exact-server complimentary showcase grant authorize official event hosting for NukeTown. It does not create, modify, or infer a customer subscription.

The capability remains limited to the immutable server, owner, Discord account, guild, and Nitrado service identity defined by the showcase grant scope. Other servers owned by the same account or connected to the same guild remain subject to their own billing entitlement.

## Authorization

- Existing active or trialing Pro-compatible subscriptions keep their established event-hosting path.
- NukeTown can appear in the official event host inventory only while its exact complimentary grant is active.
- Missing migration `0069`, an absent grant, expiry, revocation, owner transfer, hidden or archived state, and identity drift all fail closed.
- Duplicate billing rows remain an invalid host state and are rechecked inside the event-creation transaction, so a concurrent insert cannot be masked by the complimentary grant.
- Event creation rechecks exact ownership, server lifecycle, visibility, identity scope, and grant activity inside the atomic write batch.
- A failed transaction-time recheck creates no event, registration, activity row, or host update.

## Invariants

- No billing row is inserted or changed.
- No subscription is fabricated and the public billing label remains truthful.
- Competitive scoring, rankings, eligibility formulas, and match outcomes are unchanged.
- The release does not apply migration `0069`, change a production feature switch, schedule a job, send a Discord message, or perform any Nitrado action.

## Verification

The populated showcase suite covers the allowed exact-server path, unrelated-server denial, missing migration behavior, billing preservation, grant revocation between authorization and commit, and full rollback. The shared event governance and event ecosystem suites cover existing paid-host behavior and atomic event creation.

Scheduler eligibility remains a separate follow-up. The status, ADM, and metadata scheduler selectors still require an active or trialing subscription and are not changed by this release.
