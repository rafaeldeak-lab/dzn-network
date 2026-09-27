# Player Link Owner Notification Delivery

## Released source boundary

This slice adds a guarded manual proof for the durable owner notification queue created when a player asks to link a game profile. It does not schedule the queue, send a message during deployment, alter Discord configuration, or change the existing automatic decision-notification runner.

The normal protected owner runner remains capped at five deliveries so restricted-channel permission checks stay within the Cloudflare Worker subrequest budget. The manual proof uses a separate versioned endpoint that hard-codes exactly one due delivery. An older deployment does not have that route, so the mutating request itself fails without side effects instead of falling back to the normal five-job runner.

## Controlled production proof

1. Confirm at least one genuine pending player-link request has an eligible queued owner delivery.
2. Confirm the intended owner has Discord notifications enabled and the linked Discord account is current.
3. If a restricted review channel is configured, confirm it is still private and the DZN bot can post. Otherwise the existing private owner-message fallback is used.
4. Run `DZN Player Link Owner Notification Proof` manually with `APPROVE_ONE_OWNER_PLAYER_LINK_NOTIFICATION_TEST`.
5. Verify the versioned endpoint returns 401 without authentication, then reports `owner_notification_single_delivery_v1` and exactly one delivered job with no retry, failure, or skip.
6. Confirm the matching website alert remains available and the owner received the expected Discord notification.
7. Only after that proof succeeds, add the protected owner runner to the existing Cloudflare every-minute scheduler in a separate reviewed release.

No production migration, feature switch, secret change, Discord message, scheduler change, payment action, customer charge, Nitrado operation, or restart occurred as part of this source slice.
