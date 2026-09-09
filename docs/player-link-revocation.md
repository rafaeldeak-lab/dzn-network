# Player Link Revocation

This slice adds owner-scoped link management and platform-owner support revocation using existing migrations 0052 and 0064. No new migration or configuration is required. No real account decisions are part of release validation.

## Authority and Data

- New approvals write only the dedicated exact server/profile/game verified link. They no longer copy Discord attribution into player_profiles. All existing trusted profile and leaderboard readers already support active verified links; legacy direct attribution remains read-compatible.
- Only the current server owner or the numeric platform-owner allowlist can revoke. Generic DZN admins, mock auth and paid plans do not grant this new authority. Signed-in route sessions, same-origin mutation, bounded JSON, explicit confirmation and a nonblank player-visible reason are required.
- The guarded transaction rechecks current owner/lifecycle, exact link identity, active state and the absence of any direct attribution for the exact profile or server/game account. A legacy attribution blocks revocation. No broad cleanup, guessed provenance or clearing of independently valid older links is implemented.
- Link transition, audit, cancellation/audits of pending requests for that exact profile and the player's private website notification share one D1 batch. A failure rolls back the entire operation. The unique link identity and decision audit fence dependent writes. Replayed or stale requests do not send another notification.
- Original approved claims remain historical approvals. The platform-owner request timeline includes later events for the link created by that claim, including revocation. Players see recent revoked links and the player-visible reason in their private profile, with the existing support email link.
- No gameplay rows, competitive outcomes, subscription records, Discord membership, provider tokens or unrelated server links are changed. Restoring or reassigning a revoked account requires a fresh claim and current proof, never reactivating an old link.

## Limits

Legacy attribution reconciliation remains deliberately blocked until its provenance can be established. Revocation notifications use existing private website storage, not Discord and not a new external delivery queue. Website notifications can be dismissed through existing notification controls; the decision audit remains the source of recorded history. No complete delivery/read archive, staff-only evidence store, needs-information state or Discord decisions are claimed.

API: GET /api/owner/player-game-identity-links, optional exact link or keyset after filter; PATCH /api/owner/player-game-identity-links/[linkId]. List responses are bounded to 25 and private/no-store. The same action is available from the existing owner claims page and the platform-owner support case.

SQL transaction semantics: https://developers.cloudflare.com/d1/worker-api/d1-database/#batch

Validation: real in-memory SQLite exercises interruption at every statement, wrong owners/admin/mock access, exact link and ownership races, duplicate decisions, legacy attribution preservation, pending cancellation, private notice deduplication, read-model removal, independent attribution and private route bounds. Browser QA uses synthetic data only at 1440, 900, 390 and 320 pixels. A populated live customer decision remains a separate operation, never a smoke test.
# Review Correction

Revocation notices are private account messages and do not retain a restrictive server foreign key. Account deletion removes that recipient's notifications before deleting their user row, without touching other recipients. Foreign-key-enabled tests cover revoke followed by player deletion, owner server deletion, wrong-owner rejection and preservation of unrelated notices. Existing broader deletion behavior is not redesigned by this correction.
