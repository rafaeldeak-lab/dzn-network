# Profile Empty State and Navigation

Base: main `e74030a95d902a953f83f5f77059e95f96eba102`, after #171 and #172.

## Scope

- Public gameplay metrics and the private visitor preview share one presentation helper. Unlinked records show --, real linked zero scores remain 0/0m, hidden sections stay Hidden even if a populated payload is supplied, and unavailable data has distinct wording.
- Initial navigation/reload to profile fragments waits for signed-in hub rendering. Profile settings also wait for the preceding game-link panel to finish loading. Only known profile fragment IDs are handled. The one-shot correction respects scroll margin and uses no animation; user interaction cancels a pending correction. Event handlers, animation frames and the narrow loading-attribute observer are cleaned up.
- Loading attributes are the only changes to game-link and privacy-setting forms. Their submissions, permissions and persistence are unchanged.

## Evidence

- The pre-change production export reproduced missing-data numeric placeholders; the new expectation failed with 0 rather than four missing-value markers.
- The initial implementation's delayed settings-navigation test exposed a further late-panel layout shift. Loading-aware alignment corrected it; the test was retained.
- Full npm test passed. Targeted identity-link, privacy, public-viewer and owner-preview tests passed again after the loading-attribute changes.
- Production Webpack export/typecheck passed. Full lint: zero errors, five existing warnings. AutoDev audit and whitespace checks passed.
- Twenty built scenarios cover public and private visitor previews across empty, genuine zero, populated, hidden and unavailable states at 320/390/900/1440 widths. Hidden test payloads deliberately include totals; they remain concealed.
- Four additional navigation scenarios cover delayed first cross-page links/reload to game-account and profile-settings, normal no-fragment visits, unknown fragments and cancellation when the user moves to the top before a late response. All passed with no page errors or mutation requests. Screenshots were visually inspected.
- Existing broader hub/privacy-save regression also passed: 24 scenarios across two routes each, including saved-state refresh and failed-save behavior. Live proof and fresh CI are release gates, not established by local fixtures.

## Manual Safety Review

No endpoint, query, auth, billing, migration, claim approval, score or entitlement changes. Both public views still use the public-safe endpoint with omitted credentials. Hidden visibility takes precedence over populated totals. Fragment IDs are allowlisted and no user-controlled selector is constructed. No secrets or production fixtures are added. This is a manual scoped review, not an independent security-tool attestation.

## Release Boundary

The user authorized continuing, merging and releasing reviewed fixes. Use the normal PR/CI/exact-head merge path and verify the resulting Pages deployment. No D1 migration is needed. No Stripe mutation, customer charge, live-setting change, Worker restart, real claim approval or proof substitution is part of this release.

After release, verify the real /player, /player/profile and existing public profile, including first-click fragment navigation and the visitor preview. Genuine game-account linking still requires a verified server-specific account and approved proof. Global advanced boards, remaining legacy labels and the historical trophy-cabinet message are separate follow-ups.
