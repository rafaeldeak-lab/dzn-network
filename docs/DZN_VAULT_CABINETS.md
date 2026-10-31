# DZN Vault: cabinet and showcase foundation

## Purpose and scope

Players need one private home for permanent cosmetics and deliberate control over what visitors see. Server communities need the same distinction, with collectibles owned by the server rather than its current owner. This change delivers those cabinets, explicit publication, a free welcome claim and the first original artwork. It does not enable checkout or reward automation.

The approved visual direction is a dark DZN cabinet with violet light, portrait collectibles, a featured inspection area and six display positions: one hero, four supporting collectibles and one scene. The existing badge rail is separate.

## User journeys

### Player

1. Open **My cabinet** from the Player Hub, or visit `/player/cabinet`.
2. Claim the free welcome set explicitly. It contains **Void Revenant — Origin** and **Nebula Chamber**. Merely visiting the page grants nothing.
3. Inspect owned items, place them in the hero/supporting positions and choose an owned scene.
4. Enable public display and choose **Save showcase**. Changes remain a local draft until the server confirms the save.
5. Visitors to the active public player profile see only the saved, still-owned selection. The overall player-profile privacy control takes precedence.
6. Turn public display off and save to hide the whole Vault showcase. The private collection remains owned.

Existing supporter-card purchases appear through a read-only adapter to the actual store entitlement ledger when its environment can be identified. They retain their original names and use a neutral supporter-card treatment; original Vault artwork is not assigned to old purchases retroactively.

### Server owner

Open `/dashboard/vault` from server settings and choose a linked server. The welcome set contains **Citadel Core — Foundation** and **Nebula Chamber**. The current server owner manages its showcase. Items belong to the stable linked-server identity and therefore stay with that server after a verified transfer. This first release does not introduce curator roles.

Permanent Vault ownership is independent of the server plan. The existing badge/frame/theme system keeps its own plan rules. A Vault item changes no gameplay statistic, ranking, entitlement to a paid server plan, matchmaking result or in-game inventory.

### Future editions

The concept gallery presents Void Revenant, Ember Warden, Biohazard, Frostbite, Ghost Signal and Citadel Core. They are marked as previews. Viewing a concept, clicking artwork or editing the page cannot grant it. No preview price or checkout button is presented.

## Ownership and publication

`lib/vault.ts` holds public-safe catalogue metadata and the shared API contract. Catalogue presence is presentation metadata, never proof of ownership.

Migration `0115_vault_cabinets.sql` adds isolated grants, showcase state and an audit trail. It does not replace or migrate any gameplay, subscriber or financial ledger. Player grants use `users.id`; server grants use `linked_servers.id`. A stable source identifier makes a welcome claim idempotent.

Purchased supporter cards are not copied into the new grant ledger. The adapter verifies the current purchasing user, active entitlement, fulfilled order, issued receipt and live/test environment on each read. The old twelve-card display limit is not applied to the cabinet. Refund/reversal changes are therefore reflected without a second reconciliation ledger.

The private selection contains opaque owned-item references. The public response contains only the selected catalogue display objects, in their saved positions. It excludes grant IDs, purchasing identities, order/receipt data, acquisition timestamps and total inventory size. Public readers revalidate ownership rather than trusting saved references indefinitely.

The persisted showcase is the last saved version. Unsaved edits live in the component state. A save supplies the expected version and is validated atomically with current ownership and server-owner access. A stale version returns a conflict instead of overwriting a newer save. The client retains its draft after a rejected save.

Privacy can always be reduced: an owner can unpublish an unchanged saved selection even if its purchase source is unavailable or a selected entitlement has been reversed. This retains the saved references and still checks the session, owner and version. Publishing again requires full ownership validation.

## API contract

| Route | Methods | Boundary |
| --- | --- | --- |
| `/api/player/vault` | GET, POST, PUT | Current authenticated player only |
| `/api/servers/:serverId/vault` | GET, POST, PUT | Current owner of that linked server |
| `/api/public/players/:handle/vault` | GET | Active, enabled public player profile and explicit Vault publication |
| `/api/public/servers/:serverId/vault` | GET | Eligible public server and explicit Vault publication |

Private GET and successful mutation responses follow `VaultCabinetResponse`: owned items, saved showcase/version, welcome eligibility, purchase-source availability and public-profile availability/path. POST accepts only `{ "action": "claim_welcome" }`. PUT accepts `expectedVersion`, `published` and `slots` with one hero, a four-element supporting tuple and one scene. Ownership references cannot be repeated in multiple positions; a scene belongs only in the scene position.

Mutations require an authenticated session, bounded JSON and a same-origin request. No request accepts an owner, grant source or payment state from the browser. Read routes do not create tables or grant items. All Vault responses are uncached so publication and privacy changes take effect immediately.

Relevant responses are 401 for missing authentication, 403 for an inaccessible server or an invalid mutation origin, 409 for an outdated version, 404 when the feature is disabled and 503 when its required data is unavailable. The client must not turn an unavailable purchase source into a claim that purchased items were lost.

The existing `sections.calling_cards` public-profile section remains a separate legacy feature with its existing broad privacy control. Vault publication does not rewrite that control or expand its response. New original collectibles are never inserted as legacy supporter-card purchases.

## Runtime controls and release boundary

| Setting | Default | Purpose |
| --- | --- | --- |
| `DZN_VAULT_ENABLED` | Off / absent | Enables private cabinet APIs, welcome claims, saved showcases and public projections |
| `DZN_VAULT_STORE_MODE` | Absent | Explicit `live` or `test` environment for read-only existing purchase lookup |

When an explicit store mode is absent, the existing recognised Stripe key prefix may identify the mode. This performs no Stripe request. An invalid or unavailable mode must fail closed for the paid source. The Vault does not depend on checkout being enabled, so pausing new sales does not remove acquired cosmetics.

This branch adds optional type declarations only. It does not enable production flags, deploy the application or apply a production migration. Activation is a separate reviewed release after the additive migration and built assets are available in the target environment. Do not use production credentials or D1 bindings for local QA.

If a release needs to be paused, disabling the flag hides the feature and stops mutations without deleting grants, selections or audit history. Re-enable against the same database to restore access. A temporary flag disable is an availability control, not revocation of ownership.

## Artwork and motion

`public/vault/dzn-atlas.webp` is the original six-panel concept atlas approved for this project, arranged in three columns and two rows. Cards share the one image asset. The source artwork was created for the DZN design session; no Counter-Strike or DayZ skin assets were imported.

This first implementation uses 2D artwork with CSS lighting/motion and inspection treatment. It does not claim to contain production 3D meshes, rigging or Meshy/Rosebud integrations. Reduced-motion preferences must suppress decorative animation. Real future meshes should be separately reviewed for art quality, licensing, download size and mobile rendering cost before being added to the manifest.

## Validation and next stages

The new tests exercise real database behaviour for ownership, idempotent claims, stale-version conflicts, current-owner changes, publication privacy, refunds/reversals, mode isolation and disabled/missing-schema environments. Existing private supporter-card, public-profile, store and badge/loadout regressions remain relevant. The UI must also be checked in a browser for an empty cabinet, welcome claim, save/reload, unpublished vs published output, conflicting saves, inspection, keyboard behaviour, reduced motion and a narrow layout.

Run `npm run test:vault` for the three new API, independent security and UI-state suites. `npm run test` also includes them. For a disposable browser session, first build/export the application, then run `npm run dev:vault` and visit `/__local-login`. This creates synthetic players and a server in memory, uses the real Vault handlers and serves the exported UI. `/__local-mobile` embeds the real cabinet at a 390px iframe width for responsive checks. The fixture resets when the process stops.

Normal fixture serving binds to `127.0.0.1`. A separate explicit `--managed-preview` flag allows a managed container's preview proxy to reach its synthetic fixture; it must never be used with production data or credentials. The fixture does not load real environment bindings or proxy missing APIs. Its minimal public-profile wrapper is synthetic; the Vault public projection itself uses the real implementation.

Further work remains deliberately separate:

- Daily check-ins, cumulative loyalty milestones and streak protection.
- An optional, narrowly eligible streak repair purchase with a 30-day cooldown.
- Weekly visible reward choices and verified free mission qualification.
- Team contribution projects and earned server trophies.
- Premium SKU publication, checkout/fulfilment and purchase reversal reconciliation for new Vault products.
- Optimised 3D asset production and any additional curator permissions.

Each future earning or purchase path must create server-validated, idempotent ownership. Client animation, a checkout redirect or a mission-complete button is never sufficient evidence.
