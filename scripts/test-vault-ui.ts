import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  VAULT_CATALOG, emptyVaultSlots, legacySupporterCatalog,
  type VaultCabinetResponse, type VaultOwnedItem, type VaultShowcase,
} from "../lib/vault";
import {
  addVaultItem, draftFromShowcase, featureVaultItem, isVaultDraftChanged, mergeVaultOwnershipRefresh,
  ownedShowcaseProjection, removeVaultItem,
} from "../components/vault/vault-state";

const card = VAULT_CATALOG.find((item) => item.id === "void-revenant-origin")!;
const scene = VAULT_CATALOG.find((item) => item.id === "nebula-chamber")!;
const items: VaultOwnedItem[] = Array.from({ length: 6 }, (_, index) => ({
  id: `grant:owned-${index}`, catalog: { ...card, id: `catalog-${index}`, name: `Collectible ${index}` },
  acquiredAt: "2026-10-31T00:00:00Z", source: "welcome",
}));
const ownedScene: VaultOwnedItem = { id: "grant:scene-1", catalog: scene, acquiredAt: "2026-10-31T00:00:00Z", source: "welcome" };

const saved: VaultShowcase = { version: 4, published: false, slots: emptyVaultSlots(), updatedAt: null };
const draft = draftFromShowcase(saved);
draft.slots.hero = items[0].id;
assert.equal(saved.slots.hero, null, "Draft changes must never mutate the last saved snapshot.");
assert.equal(isVaultDraftChanged(draft, saved), true);
assert.equal(ownedShowcaseProjection(items, saved.slots).slots.hero, null, "Saved preview must remain unchanged while a draft is edited.");

const cabinet: VaultCabinetResponse = {
  ok: true, scope: "player", displayName: "Player", items: [items[0]], showcase: saved,
  welcomeAvailable: true, purchaseSource: "ready", publicProfileEnabled: true, publicProfilePath: "/players/player",
};
const claimed: VaultCabinetResponse = {
  ...cabinet, items: [...items, ownedScene], welcomeAvailable: false,
  showcase: { ...saved, version: 5, published: true, slots: { ...emptyVaultSlots(), hero: items[1].id } },
};
const refreshed = mergeVaultOwnershipRefresh(cabinet, claimed);
assert.equal(refreshed.items.length, 7, "Claiming must refresh the actual owned collection.");
assert.equal(refreshed.welcomeAvailable, false);
assert.equal(refreshed.showcase.version, 4, "A claim must not advance the version behind an existing draft and bypass save conflict detection.");
assert.deepEqual(refreshed.showcase, saved, "A claim must preserve the last reviewed saved showcase.");
assert.equal(draft.slots.hero, items[0].id, "A concurrent ownership refresh must preserve the local draft.");
assert.equal(claimed.showcase.version, 5, "The response must remain immutable so the caller can detect a concurrent save.");

let slots = emptyVaultSlots();
for (const item of items.slice(0, 5)) slots = addVaultItem(slots, item)!;
assert.equal(slots.hero, items[0].id, "Slots must store the backend-owned item ID, not the catalogue ID.");
assert.deepEqual(slots.supporting, items.slice(1, 5).map((item) => item.id));
assert.equal(addVaultItem(slots, items[5]), null, "A sixth collectible cannot occupy the scene position.");
assert.deepEqual(addVaultItem(slots, items[0]), slots, "Repeated selection must not create duplicates.");

const withScene = addVaultItem(slots, ownedScene)!;
assert.equal(withScene.scene, ownedScene.id);
assert.equal(withScene.hero, slots.hero);
assert.deepEqual(withScene.supporting, slots.supporting, "A scene must not displace a collectible.");
assert.equal(featureVaultItem(withScene, ownedScene), null, "Scenes cannot be featured as collectible cards.");

const featured = featureVaultItem(withScene, items[2])!;
assert.equal(featured.hero, items[2].id);
assert.equal(featured.supporting[1], items[0].id, "Featuring a displayed item swaps the previous hero into its position.");
assert.equal(new Set([featured.hero, ...featured.supporting]).size, 5);
assert.equal(featureVaultItem(featured, items[5]), null, "Featuring an extra unselected item must respect capacity.");
assert.deepEqual(slots.supporting, items.slice(1, 5).map((item) => item.id), "State transitions must not mutate input snapshots.");

const removed = removeVaultItem(featured, items[2].id);
assert.equal(removed.hero, null);
assert.equal(removed.scene, ownedScene.id);
assert.equal(items.length, 6, "Removing an item from display must not remove ownership.");

const projection = ownedShowcaseProjection([...items, ownedScene], featured);
assert.equal(projection.slots.hero?.id, items[2].catalog.id);
assert.equal(projection.slots.scene?.id, scene.id);
assert.equal(JSON.stringify(projection).includes("grant:"), false, "Public presentation must not contain private grant IDs.");
assert.equal(JSON.stringify(projection).includes("acquiredAt"), false, "Public presentation must not copy private ownership metadata.");
assert.equal(JSON.stringify(projection).includes('"source"'), false, "Public presentation must not reveal acquisition sources.");

const missingOwnership = ownedShowcaseProjection([ownedScene], featured);
assert.equal(missingOwnership.slots.hero, null, "Revoked or unverifiable items cannot appear in the owner saved preview.");
assert.deepEqual(missingOwnership.slots.supporting, [null, null, null, null]);
const wrongKinds = ownedShowcaseProjection([...items, ownedScene], { hero: ownedScene.id, supporting: [null, null, null, null], scene: items[0].id });
assert.equal(wrongKinds.slots.hero, null);
assert.equal(wrongKinds.slots.scene, null);

const duplicateEdition = { ...items[0], id: "store:another-owned-copy" };
const distinctOwnedCopies = ownedShowcaseProjection([items[0], duplicateEdition], {
  ...emptyVaultSlots(), supporting: [items[0].id, duplicateEdition.id, null, null],
});
assert.deepEqual(distinctOwnedCopies.slots.supporting.slice(0, 2), [card.id, card.id].map(() => items[0].catalog), "Two independently owned copies must keep their separate showcase positions even when their public catalogue IDs match.");

const legacy = legacySupporterCatalog("existing-supporter", "Original Supporter");
assert.equal(legacy.artIndex, null, "Existing supporter purchases must not be assigned unrelated new art.");
assert.equal(legacy.availability, "legacy");

const publicComponent = readFileSync("components/vault/public-vault-showcase.tsx", "utf8");
assert.doesNotMatch(publicComponent, /["'`]\/api\/(?:player\/|servers\/)/, "Public showcases must never request a private cabinet endpoint.");
assert.match(publicComponent, /credentials:\s*"omit"/, "Anonymous showcase reads must not reuse the owner session.");
assert.match(publicComponent, /cache:\s*"no-store"/, "Privacy changes must not be hidden by a browser cache.");

console.log("DZN Vault UI state and public request boundary tests passed.");
