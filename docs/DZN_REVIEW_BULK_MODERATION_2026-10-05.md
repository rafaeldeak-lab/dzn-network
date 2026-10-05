# Review Bulk Moderation

The private platform-owner review workspace supports deliberate group decisions for 2 to 20 explicitly selected reviews.

## Safety Contract

- The route requires the existing platform-owner allowlist.
- Each request carries the current moderation version for every selected review.
- Duplicate, malformed, stale, missing, deleted, or oversized selections fail closed.
- A database-side all-match fence makes the group update all-or-nothing if any review changes concurrently.
- Every successful review change receives its own decision identifier and immutable moderation audit row.
- Open reports are resolved only after the matching review decision is written.
- One required reason is recorded against every selected review.
- Responses are private and no-store.

## Product Boundary

The action can approve or hide review visibility only. It does not change review ratings, leaderboard rank, discovery score, gameplay statistics, billing, entitlements, server ownership, events, badges, XP, or competitive results. It sends no Discord message and requires no migration or production feature-switch change.
