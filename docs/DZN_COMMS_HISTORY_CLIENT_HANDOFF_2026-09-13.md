# Comms History Client Recovery

## Scope

Recover the useful response-handling and rendered-QA requirements from old
#120-#122 against the current #144 API. Do not merge their incompatible payload,
channel list, migrations, Store code or old owner-access rules.

The client now accepts only the explicit public `global-chat` projection with
read-only flags and disabled mutations. It validates every rendered field,
rejects duplicate message IDs, strips unknown properties and substitutes canonical
safe text/author details for non-visible messages. Long message/name strings wrap
inside phone layouts. Loading results are announced by the existing status area.

Reads are capped at 512 KiB of actual UTF-8 bytes, including chunked or falsely sized
responses. The five-second deadline covers both headers and body. Unmount aborts
the request; stale results cannot update the component. Bad responses, denial,
network errors and timeout return to the existing clearly labelled static view.

The current API now returns a bounded opaque cursor containing the message timestamp
and ID. Its SQL comparison uses both fields in the same order as the query, so rows
that share a timestamp are not skipped between pages. The old timestamp-only
`before` parameter remains temporarily supported for compatibility, but callers
cannot combine it with the opaque cursor.

Public Global Chat history remains deliberately readable without login because its
projection contains only public-safe fields and moderation placeholders. Responses
remain private/no-store and vary by cookie because signed-in reaction state can be
included. Sending, reactions, reports and moderation still require authentication;
private groups still require a current authenticated membership check.

## Validation

- 34 client tests cover current projection, malformed fields, access/channel mismatch,
  hidden content, disabled-feature assertions, byte limits, UTF-8 boundaries,
  headers/body timeout, unmount cancellation, full Unicode pages and worst-case
  JSON-escaped text. The byte cap fits the maximum valid 30-message projection.
- Existing API tests pass the actual public projection through the client parser.
  Private history, support denial, feature-off and no-write behavior remain tested.
- Five feature-off rendered scenarios pass across desktop, mid-width, mobile,
  different timezones and reduced motion, with zero Comms requests.
- Fifteen feature-on loopback rendered scenarios pass at 1440, 900, 390 and
  320px: populated, empty, malformed, wrong-channel, hidden, long text, oversized,
  401, 403, offline, timeout and a full 30-message Unicode page. No page errors, exposed sentinel data, failed
  images, page overflow, external requests, message writes or WebSockets.
- Production builds with the feature off and on pass. Release builds must retain
  the existing feature-off default; the enabled build is a local test only.
- Full lint has zero errors and five existing warnings outside this change.

Rendered tests use synthetic fixtures and a loopback-only static server. They do
not read real chat messages, connect a production database or alter live settings.

## Still Separate

This does not enable live Global Chat, sending, reactions, presence, groups,
support messages or paid AI. The old login-only public-history proposal is retired
in favor of the explicit public-safe Global Chat read policy above; tie-safe opaque
pagination is implemented and tested. Multi-room interaction remains separate.
Website-game XP, gameplay awards,
owner subscriptions, Discord decisions and billing are unchanged.

No database migration is needed for this client correction. The existing Comms
schema and all production feature flags are untouched.
