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

Reads are capped at 128,000 actual UTF-8 bytes, including chunked or falsely sized
responses. The five-second deadline covers both headers and body. Unmount aborts
the request; stale results cannot update the component. Bad responses, denial,
network errors and timeout return to the existing clearly labelled static view.

## Validation

- 27 client tests cover current projection, malformed fields, access/channel mismatch,
  hidden content, disabled-feature assertions, byte limits, UTF-8 boundaries,
  headers/body timeout and unmount cancellation.
- Existing API tests pass the actual public projection through the client parser.
  Private history, support denial, feature-off and no-write behavior remain tested.
- Five feature-off rendered scenarios pass across desktop, mid-width, mobile,
  different timezones and reduced motion, with zero Comms requests.
- Fourteen feature-on loopback rendered scenarios pass at 1440, 900, 390 and
  320px: populated, empty, malformed, wrong-channel, hidden, long text, oversized,
  401, 403, offline and timeout. No page errors, exposed sentinel data, failed
  images, page overflow, external requests, message writes or WebSockets.
- Production builds with the feature off and on pass. Release builds must retain
  the existing feature-off default; the enabled build is a local test only.
- Full lint has zero errors and five existing warnings outside this change.

Rendered tests use synthetic fixtures and a loopback-only static server. They do
not read real chat messages, connect a production database or alter live settings.

## Still Separate

This does not enable live Global Chat, sending, reactions, presence, groups,
support messages or paid AI. It does not implement the old #119 login-only public
history or tie-safe cursor contract. Multi-room interaction and those server-side
requirements remain in the per-request manifest. Website-game XP, gameplay awards,
owner subscriptions, Discord decisions and billing are unchanged.

No database migration is needed for this client correction. The existing Comms
schema and all production feature flags are untouched.
