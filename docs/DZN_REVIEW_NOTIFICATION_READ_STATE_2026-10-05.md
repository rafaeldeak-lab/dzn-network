# Review Moderation Alerts

Reported server reviews now create a private DZN Pulse website alert for each configured platform owner when the third open report moves a review into the moderation queue.

## Runtime Contract

- The report row, pending-state transition, and owner alerts are committed in one D1 batch.
- Reports one and two do not create an alert.
- Alerts contain no reporter identity or report reason and link only to `/owner/reviews`.
- The moderation workspace shows its own unread review count.
- Marking review alerts read changes only `review_moderation_required` rows for the authenticated platform owner. Other Pulse notifications remain unread.
- The read-state endpoint requires the existing platform-owner allowlist and returns private, no-store responses.
- Existing Pulse expiry and cleanup behavior applies to the alerts. No new table or migration is required.

## Release Boundary

This release does not send Discord messages, change production flags, write production data during deployment, alter review scores, rankings, billing, server ownership, or competitive results. DZN Pulse must already be enabled for website alerts to be created.
