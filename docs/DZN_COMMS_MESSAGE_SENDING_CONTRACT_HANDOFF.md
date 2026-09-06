# DZN Comms Message-Sending Contract Handoff

Date: 2026-09-06
Branch: `codex/dzn-comms-message-sending-contract-20260906`
Base: PR #144 head `7d6de24c0f1641727eb9f331d7fb25f031db6e95`
Status: preflight only; draft/stacked review, not released

## Delivered

- `DZN_COMMS_MESSAGE_SENDING_CONTRACT.md`: future payload/response, identity and
  origin checks, exact-group membership, filtering, warning/timeout ladder,
  rate limits, atomic idempotency, retention, moderation scope and rollback.
- JSON companion: machine-checkable proposed defaults, all runtime approvals off.
- Seven dependency-free contract checks, included at the start of `npm test`.
- Master platform specification link, with the PR #144 prerequisite made explicit.

The contract's seven checks, focused ESLint check and diff whitespace check pass.
There is no new route, migration, environment setting, provider call, message write,
moderation action or UI behavior. These tests validate the design artifact and
its inert integration; they do not prove future database concurrency or filtering.

## PR #144 Review Evidence

Reviewed the exact 11-file diff against main
`7d552e68de35bfbe571c82901953a5cfab696cd4`. Its three existing review threads were
resolved; hosted Performance Foundation run `34059652245` succeeded at review time.

Local validation during this task passed:

- Comms read-history, public-access gating, auth return flow, billing plans,
  Stripe live readiness, Stripe activation checklist, metadata fairness and
  Server Wars gating suites. Payment/provider effects are test doubles only.
- Nonincremental TypeScript, lint and static build; lint has four existing warnings
  in public-network, live-server-rail and advanced-stats, none in this new contract.
- PR #144 diff whitespace check.
- Completed security diff scan `7774df0d-ee69-4191-a00e-a125e410f3f2`: all changed
  files reviewed, zero reportable findings in the scoped review. The report's
  initial coverage serialization error was corrected before successful sealing.

Limits: session/channel/membership checks use test fakes; message SQL runs in
in-memory SQLite. Live flags, actual bindings, production schema and host-generated
error responses were not inspected. No fresh rendered-browser QA is claimed here.
The security access advisory was unavailable, but the scan completed successfully.
No measured scan token usage was returned by the completed-scan tool.

Non-blocking follow-ups before broader history use: validate the complete client
response shape; use an ID/time keyset cursor before adding pagination; verify
sanitized/no-store hosting error responses. `local_test` is an operator-controlled
scope label, not an independently verified environment or database boundary.
Future sending must verify deployment isolation and moderation readiness too.

## Safety And Release Boundaries

The PR #144 runtime is unchanged by this branch. Its UI and API flags remain off.
Live checkout remains default-deny; no live checkout activation was performed.
No production D1 apply, merge, deployment, Stripe mutation, Cloudflare config or
secret change, Discord/Nitrado runtime action, AI spend, retained export or issue
#49 change occurred. Existing worktrees and unfinished work were preserved. This
new preflight does not install another dependency tree or generate a build copy.

New changes are limited to documentation, the JSON contract, its test and package
test registration. No app, component, function, migration, worker, environment,
workflow, asset, lockfile or competitive-system implementation change is included.

## Next Order

1. Obtain separate release approval for PR #144 at its verified head. Production
   D1 migration `0065_dzn_comms_read_history.sql` needs explicit approval of its own.
   Deploy only through the normal authorized release path; keep Comms flags off.
2. After #144 lands, retarget this draft to main, verify the diff is still only the
   contract slice, rerun its checks and review the proposed policy defaults.
3. Approve a bounded local/test sending runtime/schema preflight next: exact
   transaction strategy, safety-state/receipt schema, CSRF provisioning, isolated
   database binding, expiry and rollback proof before any new write implementation.
4. Keep private sending, reactions, report/moderation routes, presence, support
   launcher and public-DZN-info-only AI in their separately approved slices. Basic
   working safety enforcement and staff response must precede any real-user sending.

Do not treat approval of this document as authority for runtime or production work.
