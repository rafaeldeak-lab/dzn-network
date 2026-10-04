# DZN Comms Private-Group Sending

This source release extends the existing authenticated Comms send route to private-group channels without enabling private groups in production.

## Security contract

- `DZN_COMMS_PRIVATE_GROUPS_ENABLED` defaults to `false` and also requires the existing live Comms flag, scope and secrets.
- A sender must have an active `dzn_comms_private_group_members` row for the exact channel.
- Receipt replay lookup requires active membership for the exact private channel in the same database query, then membership is checked again before subsequent processing and inside the atomic message write.
- A concurrent removal stores no message and no receipt. Its accepted-send quota remains consumed so a revocation race cannot refund rate limits.
- A removed member cannot replay an earlier successful request through the private channel.
- Unknown and inaccessible private-group slugs return the same generic denial, so membership checks do not expose channel existence.
- The only public channel accepted by this route remains the established `global-chat` channel.
- Private reports require active membership before lookup and again when the report is stored; a raced removal stores no report.
- Private reports enter the existing platform-owner moderation queue only while the private-group flag is enabled.
- Only the authenticated platform owner can hide, restore, delete, resolve or dismiss private-group content through the existing moderation route.
- Public Global Chat behavior, reporting, moderation, retention and reaction flags remain unchanged.

## Validation

Run:

```text
npm run test:dzn-comms-live-runtime
npm run test:dzn-comms-message-sending-contract
npm run test:dzn-comms-read-history
```

The runtime suite covers disabled flags, non-members, active members, removal before replay, removal racing the receipt lookup, and removal racing the database write.

## Release boundary

Do not enable the new flag until migrations `0065`, `0071` and `0072`, the private ledger secret, live Comms server flags, retention and authenticated Global Chat proof have passed their separate controlled production operation. Private-group UI, membership administration, invitations and production message delivery remain separate releases.
