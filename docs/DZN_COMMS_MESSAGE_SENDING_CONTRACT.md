# DZN Comms Message-Sending Contract Preflight

Date: 2026-09-06
Status: design only; runtime and production approval NOT granted
Prerequisite: PR #144 at `7d6de24c0f1641727eb9f331d7fb25f031db6e95`

## 1. Scope And Approval Gates

This contract follows the disabled, local/test read-history foundation. It does
not implement a send route, add a migration, enable flags, persist messages or
moderation records, or authorize production. It supersedes ambiguous send-result
choices in the older interaction preflight, not the current read API.

PR #144 must be reviewed/released separately. Applying
`0065_dzn_comms_read_history.sql` to production D1 requires explicit approval.
The new contract PR stays draft and stacked until that prerequisite lands.

The first proposed runtime is a disabled-by-default local/test text-only Global
Chat pilot. HTTPS request/response only; the existing history GET remains the
read transport. No WebSockets, Durable Objects, polling, reactions, attachments,
message editing, public report routes, private sending or AI in that pilot.
Runtime implementation, moderation storage, production migration and production
activation each need a separate approval. Sending cannot be released ahead of
working filtering, warning/timeout enforcement, retention and staff response.

The machine-readable companion is `DZN_COMMS_MESSAGE_SENDING_CONTRACT.json`.
Its values are proposed implementation requirements, not deployed configuration.

## 2. Existing Sources Of Truth

| Concern | Current implementation |
| --- | --- |
| Read route | `functions/api/comms/message-history.ts` |
| Read authorization/redaction | `functions/_lib/dzn-comms-read-history.ts` |
| Discord-backed DZN identity | `getSessionUser` in `functions/_lib/db.ts` |
| Private response headers | `functions/_lib/performance.ts` |
| Read-model schema | `migrations/0065_dzn_comms_read_history.sql` |
| Disabled composer/static fallback | `components/comms/dzn-comms-shell.tsx` |

The existing schema stores channels, messages and active private membership. It
does NOT supply send permission, idempotency, safety state, retention execution
or atomic moderation. `is_readable=1` is never permission to write. A scope value
of `local_test` is operator configuration, not cryptographic proof that a request
is outside production. Future runtime also needs an approved deployment allowlist
and isolated test database binding; the browser cannot select the environment.

## 3. Future Client Request

Proposed route: `POST /api/comms/messages`. It does not exist in this slice.

```json
{
  "channelSlug": "global-chat",
  "clientRequestId": "b065744d-e143-4e36-a370-9c71c2c1a567",
  "body": "Hello DZN."
}
```

- Require an authenticated, nonexpired Discord-backed DZN session. Resolve the
  canonical user on the server; never accept actor/user/Discord ID from the body.
- Require `application/json`, a maximum 12,288-byte actual streamed request body,
  and an object containing exactly the three fields above. Do not trust only
  Content-Length. Reject arrays, duplicate JSON keys and unknown fields.
- `channelSlug`: existing lowercase 2-64 character channel slug grammar.
  First pilot allowlist contains only `global-chat` with kind/visibility public.
- `clientRequestId`: lowercase RFC 4122 UUID v4. Generate once for an explicit
  send intent and retain only in memory while retrying that intent.
- `body`: plain text, Unicode NFC, CRLF normalized to LF, outer whitespace trimmed;
  1-2,000 Unicode code points and at most 8,000 UTF-8 bytes after normalization.
  Reject forbidden control/bidi override characters. Preserve ordinary emoji and
  joiners; run filtering against a separate normalized confusable-aware view.
  Never silently rewrite rejected content into an accepted message.
- No client role labels, display name, timestamps, visibility, expiry, policy
  decision, source labels, profile handles, rewards or entitlement fields.
- For this browser-only cookie route require an exact approved Origin, a valid
  session-bound CSRF token in `X-DZN-CSRF-Token`, and reject cross-site fetch
  metadata when present. Missing/null Origin fails closed. CSRF provisioning is
  a future authenticated contract to approve, not a new endpoint in this slice.
  Existing weaker optional-Origin helpers must not be copied into this route.

## 4. Authorization And Decision Order

1. Check server flag, local/test deployment allowlist, isolated DB and readiness
   of moderation/retention. Disabled returns 404 before auth, parsing or DB work.
2. Enforce method, origin/CSRF, session validity, transport/body bounds and schema.
3. Resolve channel server-side and reject unavailable or inconsistent metadata.
   Future private sends require current active membership for the exact channel.
   Discord guild overlap, saved servers, public handles and server ownership alone
   are NOT group membership proof. Support channels remain denied.
4. Apply a bounded request-attempt limiter, including replay attempts, before
   expensive filtering. Look up `(actor_id, channel_id, client_request_id)`.
   Same actor/channel/key with a different normalized body returns 409. Reusing a
   UUID in another channel is a separate scoped intent, still subject to the same
   actor-wide quotas. A completed
   same-intent replay can return only after current session/read access checks.
5. For a new intent check current send permission, safety state, slow mode and
   accepted-message quotas. No client count or plan upgrade can bypass them.
6. Run the versioned local deterministic safety policy. Missing policy, filter
   error, storage uncertainty or unknown decisions return 503; never publish.
7. Recheck membership, channel state, policy version, timeout and quotas in the
   atomic commit boundary. Commit the decision receipt and exactly one message
   OR one safety-state transition, never both for a rejected attempt.
8. Return a sanitized private response only after commit. No response, notification
   or fanout may claim accepted before persistence succeeds.

Authentication resolves identity; it does not grant staff privileges. No paid plan
is needed to participate. None of these decisions reads billing or competitive
tables. A chat timeout affects chat sending only, not other DZN access.

## 5. Exact Response Semantics

All responses use `Cache-Control: private, no-store`, `Vary: Cookie` and the
existing private response-header helper. No response includes raw rejected text,
internal actor IDs, membership lists, safety evidence or payment state.

| HTTP | Code | Message created | Client behavior |
| --- | --- | --- | --- |
| 201 | `ACCEPTED` | Exactly one | Show server message ID/time; clear draft |
| 200 | `REPLAYED` | No additional message | Reconcile an already accepted message ID; clear draft |
| 202 | `IN_PROGRESS` | Unknown until original resolves | Keep same intent; bounded retry |
| 400 | `INVALID_REQUEST` | No | Keep draft; show field-safe error |
| 401 | `AUTH_REQUIRED` | No | Ask to sign in; do not submit automatically |
| 403 | `ACCESS_DENIED` | No | Stop; no private channel details |
| 404 | `UNAVAILABLE` | No | Static fallback; no existence disclosure |
| 405 | `METHOD_NOT_ALLOWED` | No | Stop; `Allow: POST` |
| 409 | `IDEMPOTENCY_CONFLICT` | No | Stop; do not silently generate a new key |
| 413 | `BODY_TOO_LARGE` | No | Keep local draft; ask to shorten |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | No | Stop |
| 422 | `CONTENT_BLOCKED` or `WARNING` | No | Private edit-and-retry guidance |
| 423 | `TIMEOUT_ACTIVE` or `STAFF_REVIEW` | No | Show server expiry/review notice |
| 429 | `RATE_LIMITED` | No | Honor server `Retry-After` and countdown |
| 503 | `TEMPORARILY_UNAVAILABLE` | No claimed success | Keep same intent for bounded retry |

Accepted/replayed shape: `{ code, clientRequestId, message: { id, createdAt } }`.
Pending/rejected shape: `{ code, clientRequestId?, retryAt?, safety? }`.
`safety`, returned only to the actor, contains at most `state`, `warningCount`,
`timeoutUntil`, `policyVersion` and a public-safe reason category.
Never return an old message body from a replay receipt. If an accepted message
has since been hidden/deleted/expired, return only its receipt, not its contents;
if group access is removed, deny instead of returning the receipt.

A replay of a rejected intent keeps the original rejection code/status and adds
`replayed: true`; it never returns a message object or implies acceptance. Actor
safety feedback reflects current state, without restoring an expired timeout or
adding a strike. The attempt limiter can still return 429 before any replay.
Accepted author fields are server-controlled Comms display fields explicitly
approved for that audience, with `DZN Player` as the safe fallback. Do not copy
private profile fields, email, Discord identifiers or raw gameplay evidence into
message author metadata. Posting consent does not change profile visibility.

An uncertain response never justifies automatic resubmission under a new key.
Retries stop after three attempts or 24 hours from the first attempt, whichever
comes first. Do not store drafts or request IDs in browser storage. A reload may
lose the draft; consult authorized read history before offering a new send.

## 6. Filtering, Warnings And Timeouts

Policy is versioned, deterministic and server-side. The initial permitted
decisions are `allow`, `block`, `warn`, `timeout`, `escalate`; unknown is denial.
There is no accepted-with-warning ambiguity: only `allow` publishes a message.

- Evaluate profanity, targeted harassment/hate, threats, sexual exploitation,
  spam/repetition, impersonation, unsafe links and disclosure of private data.
  Dictionary-only substring checks are insufficient: test word boundaries,
  Unicode obfuscation, innocent name fragments and contextual false positives.
- First mild violation blocks privately with an edit action; second in a rolling
  24-hour safety window gives a friendly warning; third gives a 10-minute send
  timeout. The next qualifying violation in that window after timeout goes to
  staff review and a bounded 24-hour maximum send hold pending review.
- Severe threats, exploitation or private-data exposure bypass the mild ladder:
  block and queue staff review. Do not post a placeholder quoting the rejected
  text. No indefinite automatic ban; a longer sanction needs authorized review.
- No strike for retrying the same intent, network failure, a filter outage,
  invalid JSON, quota denial or a request already blocked by a timeout. Such
  requests remain subject to the request-attempt rate limiter.
- A timeout timestamp and server time drive the UI countdown. Closing the dialog,
  changing device or refreshing cannot clear a timeout. The next send rechecks
  server state even if the displayed countdown has reached zero.
- Users can edit a blocked draft locally and explicitly submit a new intent.
  Provide accessible private status feedback and a staff appeal path when that
  workflow is separately implemented; do not promise a nonexistent action.
- First pilot permits plain text only; reject external URL/invite attempts and
  allow only explicitly configured DZN HTTPS links as text, without fetching,
  unfurling, remote images or automatic navigation. Policy examples are synthetic.

## 7. Rate, Idempotency And Concurrency Requirements

Proposed defaults are equal for free players and paid owners:

- 30 authenticated attempts per actor per rolling minute, across all channels.
- At most one accepted message per actor per five seconds across all channels.
- At most 20 accepted messages per actor per rolling minute across all channels.
- Channels may impose a stricter slow mode but cannot weaken global limits.
- Edge abuse limiting may use transient transport metadata only after separate
  approval; never add IP/device identifiers to DZN analytics or public payloads.

Future decision receipts require a unique actor/channel/request constraint,
server-generated message ID, normalized-request HMAC fingerprint, policy version,
decision, server timestamps and seven-day expiry. No rejected body is retained.
Fingerprint key provisioning requires separate secret approval; none is added now.
Accepted messages use a unique receipt/message association. Replays within seven
days return the existing result and cannot extend expiry, spend quota twice or
increment strikes. This is a bounded replay guarantee, not permanent deduplication
after receipt deletion. The client retry window is deliberately shorter.

Unique constraints alone do not make a multi-step flow atomic. The future D1
implementation must prove one transaction/conditional commit couples authorization,
receipt ownership, quotas, safety updates and message insertion. A failed membership
predicate must abort the entire outcome, not leave a success receipt. Do not use
JavaScript read-count-then-insert as quota enforcement. Membership revocation and
moderator changes must serialize with sends: whichever commits first defines the
outcome. No delayed background job may publish after revocation without rechecking.

Crash-before-commit means no accepted outcome. Crash-after-commit is recovered by
the same-key receipt. A bounded in-progress lease may be taken over only using an
atomic compare-and-set after expiry and reconciliation of the original outcome.
The actual schema, lease duration and database transaction proof are blockers for
the next runtime approval, not assertions that 0065 already implements them.

## 8. Membership And Moderation Authority

| Actor | Future permitted scope |
| --- | --- |
| Anonymous visitor | Existing public read only; no sends/reports/moderation |
| Signed-in player | Public sends if permitted; own private safety response |
| Active private-group member | Exact-group read; future send after separate proof |
| Removed/blocked group member | No group reads, sends, receipts or moderation |
| Group owner/delegated moderator | Explicit group chat safety capability only |
| Server owner | No Global Chat staff authority; no unrelated group access |
| DZN admin with Comms capability | Explicit staff scope, audited safety actions |

Role display labels, a Pro subscription, ownership of a DayZ server, a public
profile or Discord guild admin status cannot confer Comms moderation authority.
No blanket admin bypass is added to the existing private history route. Private
staff investigations need a separately approved, purpose-bound access workflow.
Any future server-linked management tool keeps its existing owner entitlement
boundary; this contract neither changes that boundary nor makes chat participation
dependent on it.

Future report/moderation hooks carry only message ID, scope, actor, reason code,
action and policy version to authorized reviewers. Reports must prove the reporter
could read that message. Reports alone cannot auto-sanction a target. Moderator
actions require current explicit scope, rationale and an append-only reversal
record; unauthorized/cross-owner requests must have zero side effects. No report
route, moderation API, membership-management API or notification is added here.

## 9. Retention, Support And Logging

Proposed ceilings, requiring approval before real-user persistence:

| Data | Maximum retention / access |
| --- | --- |
| Accepted messages, including hidden/quarantined bodies | 30 days; authorized readers only, hidden bodies staff-only if approved |
| Deleted message body | Remove immediately; bounded metadata tombstone only |
| Decision/idempotency receipts | 7 days; actor/scoped operator only |
| Safety audit metadata, no rejected body | 30 days; scoped moderators/admins |
| Active warnings/holds | Rolling policy window / explicit expiry; no permanent shadow sanction |
| Rejected text and filter input | Request memory only; never persisted or logged |
| Drafts, typing state, delivery UI | Page memory only |

Expiry applies at read time AND via an approved bounded purge job. Jobs must be
idempotent, do no cross-system deletion and never reset competitive/player data.
Expired audit data cannot extend sanctions. Define backup/platform recovery
retention and deletion lag before launch; database deletion alone does not prove
erasure from backups. No retained exports, downloadable chat history or public
sharing links. Access to a chat is not consent to an export or AI training.

Operational logs contain only coarse result, duration bucket and policy version;
no content, request fingerprint, persistent actor identifier, IP, cookie, token,
invite, Discord ID or private channel name. Restricted safety metadata is separate
from general logs. No analytics events, tracking, DZN Pulse hook or provider calls.

DZN Assist remains blocked. Its future approved sources are reviewed public DZN
help pages only: never messages, group history, profiles, billing, moderation,
credentials, ADM evidence or private account context. Public text is untrusted
input, not bot instructions. No prompt, vector store, AI credentials or metered
calls are introduced. Setup guidance cannot perform setup or bypass `/pricing`
and canonical owner entitlement checks.

## 10. Rollout, Rollback And Security Proof

Future flags (not added to env/config here): `DZN_COMMS_MESSAGE_SEND_ENABLED=false`,
`DZN_COMMS_MESSAGE_SEND_SCOPE=local_test`,
`NEXT_PUBLIC_DZN_COMMS_MESSAGE_SEND_UI_ENABLED=false`. Client flag is presentation
only; server checks all gates. Default/read-only deployments must issue no POST.

Before any runtime approval, demonstrate:

1. A new numbered, isolated migration and reviewed atomic-write strategy with
   constraints, expiry indexes and a tested local rollback. Do not repurpose 0065.
2. Real local database concurrency tests for equal/conflicting keys, 100 concurrent
   attempts, cross-channel quotas, membership removal races, policy changes,
   simultaneous warnings and every crash/retry boundary. In-memory mocks alone
   cannot establish transaction or quota guarantees.
3. Anonymous/expired-session denial, missing/foreign Origin and CSRF denial,
   role spoofing, cross-group denial, removed-member replay denial and no-store
   error/success responses, with zero forbidden writes on every denial path.
4. Text/XSS/Unicode/size boundaries, filter false positives, privacy-data handling,
   outages, timeouts and rate-limit countdown accessibility. No network operation
   except the approved same-origin read/send/CSRF contracts in a future pilot.
5. Exact bounded message/receipt/safety table write allowlist and byte-identical
   snapshots of all protected data before/after, across user and plan variants.
   Chat behavior must not consult or alter billing, owner entitlement/ownership,
   scoring, rankings, discovery formulas, reviews, badges, seasons, events,
   Server Wars, CTF, XP/calling-card awards, public profile visibility, retained
   exports or competitive eligibility. No XP/reward hook for sending or reports.
6. Proof that retention purges, moderator reversals and account removal preserve
   audit boundaries without exporting private data or changing protected systems.
7. Rendered desktop/mobile/keyboard/screen-reader checks for accepted, pending,
   rejected, timed out, revoked access, offline and static fallback states.

Rollback sequence: disable server send first, reject new commits, reconcile any
already committed receipts without re-sending, disable UI, preserve authorized
read-only history and timed expiry. Keep cleanup available; do not drop message
tables or delete unrelated records to roll back code. Reverse schema only after a
separate approved data-preservation plan. Global emergency disable must be checked
at commit time, not just while rendering the composer.

No live checkout, Stripe/Nitrado/Discord runtime mutations, Cloudflare config or
secret changes, production D1 writes, deployments or issue #49 changes are included.
