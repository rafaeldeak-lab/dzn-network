# DZN Current Backlog Reconciliation

## State And Evidence

The initial 73 older requests are #50 through #122. Their original heads and
individual dispositions are recorded in `dzn-legacy-request-dispositions-2026-09-13.json`.
This supersedes the open-count wording in the September 12 snapshot, which is
retained as historical evidence. A disposition is not implementation or live proof.

Seven requests were verified against current source and closed as superseded:
#52, #63, #64, #83, #84, #85 and #115. Each has an individual GitHub comment with
replacement releases and evidence. Their original branches and history remain.
The remaining 66 older requests are still open because their unique requirements
have not all been implemented. No blind old-stack merge or migration was performed.
Each of those 66 descriptions now begins with a current, request-specific
reconciliation note linking replacement work and this record. Every original
description is retained below it, and every original head was checked before the
update. The seven verified closures plus 66 updated descriptions account for all 73.

Current source comparison: `d36da3945241ed38a6115ebb212d0569fbad0ee6`.
Board UI release: PR #185, merge `ee43f3f1f445af92ffd423409441b42d9e7b257d`.
The board release passed 23 rendered checks and independent review. It removes the
header pause button, adds DZN field-board styling, and keeps a Display setting
accessible on every state. No rules, rewards, migration or payment settings changed.

## Active Work

The first recovered unique Comms work, released in PR #186 at
`e3b98f405c870c475637018fae33f6d98b7c2a5e`, is #120-#122's response validation and
rendered QA, adapted to the current #144 API rather than its incompatible old
payload. It remains disabled by the existing production flags. This is not live
chat, support delivery, presence or message sending. See
`DZN_COMMS_HISTORY_CLIENT_HANDOFF_2026-09-13.md` for implementation and validation.

The next implementation repairs Discord discovery/status in the owner dashboard.
Live read-only onboarding verification on September 13 found the DZN bot and 26
postable channels, while the dashboard's saved-destination-only read could not
establish bot installation and offered no usable initial recheck. This is a
dashboard verification defect, not evidence that the installed bot must be
reinstalled. See `DZN_DISCORD_DISCOVERY_RECOVERY_2026-09-13.md`. Message delivery,
automatic-post configuration and owner approval notifications remain separate.

The following bounded implementation connects the exact NukeTown showcase grant
to owner dashboard health, Advanced Showcase and advertising/bump reads. The UI
separates `Pro Listing (complimentary)` from account billing, loads the read-only
summary only when visible, and flags a past date on an otherwise active billing
record for review. It does not rewrite a subscription, renewal date or account
server allowance. Scheduler, event-host and Discord-publishing consumers remain
separate work. The exact lifetime event total remains unavailable until a
dedicated durable aggregate exists; partial durable counters are not presented as
that total. Other headline metrics use `server_stats` when present and a
hard-bounded fallback otherwise. Player, build, travel and exploration boards
are bounded, locked accounts skip raw event reconstruction, and owner analytics
responses use `no-store`.
Complimentary bumps revalidate the exact grant inside the write so a concurrent
revocation cannot consume the old cadence.

## Remaining Work Groups

| Requests | Remaining work | Important boundary |
| --- | --- | --- |
| #50-#51 | Reconcile old owner-access rules and Player Hub dependencies | Preserve Free player access, current per-server capabilities and exact-server complimentary grants |
| #53 | Pricing comparison artwork | Do not alter current prices or checkout behavior |
| #54-#57 | Review reports/replies, moderation queue, bulk actions, notification state | Server-owner scope, per-item authorization, audit and current-user read state |
| #58-#62 | Genuine gameplay challenges, XP, calling cards and award audit | Separate from website-game XP; verified source and identity required |
| #65-#68 | Missing profile discovery/attribution controls, CTF and event provenance | Explicit public opt-in; no name-only account linking |
| #69-#81 | Public community directory, trusted member imports, audit and private exports | Private Discord guild matching is not a public member directory; no retained export activation |
| #82, #86-#90 | Profile visuals, per-profile social metadata and crawler/image QA | Public-safe projections and private/missing-profile fallback |
| #91-#95 | Multi-room Comms/support design, interaction/runtime contracts and presence | Existing read-only shell is not a live chat service |
| #96-#114 | Store catalog, test orders/receipts/fulfilment, purchases and supporter cards | Separate financial review; no automatic live Stripe or customer mutations |
| #116-#119 | Reactions, authenticated public history intent and tie-safe pagination | Current read API is not equivalent to every older contract |
| #120-#122 | Remaining multi-room/runtime contracts beyond current-model response handling and rendered regression checks released in #186 | No production flags or schema changed; live Comms remains separate |

## Wider User Requests Retained

- NukeTown service 18765761: durable exact-server Pro-equivalent access without a fake paid subscription, no grants to other servers, and preserve the user's normal bot-aligned restart schedule. Reverify live entitlement/protected-feature payloads before reporting current status.
- Nitrado: genuine automatic import was proved on September 12 by two persisted kill rows and five joins in one `scheduled_nitrado` job, matched to its exact server, service and stored source lines. This corrects the previous unproved-first-event wording. Sustained recovery remains open: the inspected lifecycle was still degraded, Discord queueing warned, and event timestamp normalization/hash coverage need review. Recheck current health; that point-in-time proof is not continuous-sync certification.
- Bot host: September 13 read-only inspection found the working `pandora.service` active and the latest hourly reset completed, with the existing Europe/London schedule unchanged. A separate obsolete `pandora-bot.service` repeatedly fails because its virtualenv Python is missing. Root storage had only 202 MB free. Disabling only the obsolete unit was presented for specific approval; no service action or disk deletion accompanied this website change.
- Dashboard: selected-server plan labels, bump details and Advanced Showcase are implemented for the exact complimentary grant in the current bounded release. Complete rendered and live post-release verification before closing; account billing verification remains separate because the source record still reports an active plan with a past period end.
- FED & FERAL: real owner setup/recovery, current token association, verification, lifecycle, scheduled import and continuing sync proof.
- Genuine player account linking: exact server/player provenance, owner approval/decline with reason, server-scoped revocation, player notice and preserved history.
- Discord and website notifications: show who is requesting what for which server; authorized owner decisions and restricted channels only. Platform-owner console needs searchable audited request/decision/support timelines.
- Customer billing: real seller/receipt details and current account/subscription/webhook checks remain a distinct verification task. Do not charge a customer to manufacture proof.
- Mobile/public UI: leaderboard availability, readable tables, record artwork, beta-banner clearance, correct Chernarus/Livonia/Sakhal map and aggregate-only privacy, understandable plan/map labels and named eligible Server Wars opponents.
- DZN Games Hub: Discord access, original DZN animated artwork and homepage link, stronger badges/insignia, additional games, streaks, earned parts, long-term builds/prestige, player and server challenges and moderated global chat.
- Spin/reward economy: paid spins, redeemable funds, transfers, cash-equivalent prizes and paid competitive advantages are not enabled. Any proposed monetised random rewards need their own business/compliance/payment-processor decision; the website-game XP/parts ledger must remain separate from DayZ stats and owner subscriptions.
- Session inactivity/resume UX remains tracked by #141's released backlog; it is not implemented by this change.

No request above is marked complete merely because a document, disabled control,
local fixture or historical branch exists. Implementation, tests, review, merge,
production activation and real-account verification must be tracked separately.
