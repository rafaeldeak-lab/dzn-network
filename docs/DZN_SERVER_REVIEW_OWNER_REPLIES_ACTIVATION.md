# Server Review Responses: Controlled Activation

This guide applies only after the source release containing migration `0091_server_review_owner_replies.sql` is deployed. Deploying source code does not enable public server-review responses.

## Scope and safety boundary

- The feature permits the linked server owner or a DZN administrator to publish, edit, or remove a response to an approved review for that exact server.
- The reviewer, rating, review body, review status, moderation decision, competition data, entitlement data, and billing data are never changed by this feature.
- Public readers see only the response text, optional response-author display name, and response timestamps. They never receive the internal responder user ID or reply audit records.
- Keep `DZN_SERVER_REVIEW_OWNER_REPLIES_ENABLED` unset or `false` until every verification step below passes. While disabled, the public API returns no reply controls or reply data and the write endpoint returns `404`.

## Production procedure

1. Record the approved recovery bookmark and current migration ledger. Do not combine this with another migration, feature flag, secret, billing, or entitlement operation.
2. Apply only `0091_server_review_owner_replies.sql`.
3. Verify the migration ledger records `0091_server_review_owner_replies.sql` exactly once.
4. Verify `server_reviews` contains the seven added columns: `owner_reply_body`, `owner_reply_author_user_id`, `owner_reply_author_name`, `owner_reply_created_at`, `owner_reply_updated_at`, `owner_reply_version`, and `owner_reply_last_decision_id`.
5. Verify `server_review_owner_reply_audit` exists with the declared `upsert` and `remove` action constraint, both foreign keys, and the review/server indexes.
6. Verify the existing review data remains unchanged. Before the first manual test, all existing response-body values must be `NULL`, all response versions must be `0`, and the new audit table must contain zero rows.
7. Set only `DZN_SERVER_REVIEW_OWNER_REPLIES_ENABLED=true`. Do not enable unrelated review, Store, Comms, notification, billing, or player-link flags as part of this operation.

## Authenticated proof

Run each check against a non-sensitive approved review and record only the resulting IDs and timestamps in the release log.

1. As the exact linked-server owner, publish a constructive response of at least 10 characters. Confirm that the public server page shows the response and no reviewer identity fields beyond the existing public projection.
2. Edit the response. Confirm that the response version advances, the original creation time remains stable, and the update time changes.
3. As a different server owner, attempt the same request and confirm `403` with no update or audit row.
4. As a signed-out visitor, confirm no response controls are presented and a write request is rejected.
5. As a DZN admin, verify the allowed response path only for the target server. Verify no other server becomes writable.
6. Remove the response. Confirm the public response disappears, the audit history records the removal, and the review itself remains approved and unchanged.

## Recovery

If any schema, authorization, public-projection, or audit check fails, set `DZN_SERVER_REVIEW_OWNER_REPLIES_ENABLED=false` immediately and stop. Do not attempt a destructive schema rollback. Preserve the recovery bookmark and investigate from the recorded migration and audit evidence before another activation attempt.
