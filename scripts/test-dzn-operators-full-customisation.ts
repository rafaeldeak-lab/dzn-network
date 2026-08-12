import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { FULL_OPERATOR_CATALOG, FULL_OPERATOR_STUDIO_RAIL, getFullOperatorCatalogItems, getFullOperatorItem } from "../lib/operators/full-customisation/catalog";
import { FULL_OPERATOR_DEMO_PLAYERS, getFullOperatorPlayer, getFullOperatorServer } from "../lib/operators/full-customisation/demo-profiles";
import {
  DZN_OPERATORS_FULL_STUDIO_STORAGE_KEY,
  applyFullOperatorColourTheme,
  assertNoFullOperatorCompetitiveFields,
  buildOperatorMasterySummary,
  buildWeaponMasterySummary,
  createFullOperatorLoadout,
  createFullStudioStorageState,
  deleteFullOperatorLoadout,
  deterministicFullOperatorRandomise,
  duplicateFullOperatorLoadout,
  equipFullOperatorLoadout,
  getDefaultFullOperatorLoadout,
  isFullOperatorItemCompatible,
  migrateLegacyOperatorStudioState,
  parseFullStudioStorage,
  renameFullOperatorLoadout,
  resetFullOperatorCategory,
  resetFullOperatorLoadout,
  sanitizeFullOperatorLoadout,
  selectFullOperatorItem,
} from "../lib/operators/full-customisation/loadouts";
import {
  FULL_OPERATOR_BODY_GROUPS,
  FULL_OPERATOR_BODY_PRESETS,
  FULL_OPERATOR_CATEGORIES,
  FULL_OPERATOR_POWER_SLOTS,
  FULL_OPERATOR_PROHIBITED_COMPETITIVE_FIELDS,
} from "../lib/operators/full-customisation/types";
import { getDznOperatorsFeatureFlags } from "../lib/operators/feature-flags";
import { freeCompetitionParticipation } from "../lib/operators/loadout";

const defaultFlags = getDznOperatorsFeatureFlags({});
assert.deepEqual(defaultFlags, { enabled: false, demoMode: false });
assert.equal(defaultFlags.fullStudioEnabled, false, "Full Studio flag defaults off.");
assert.equal(getDznOperatorsFeatureFlags({ NEXT_PUBLIC_DZN_OPERATORS_ENABLED: "true" }).enabled, true, "Phase 1 still works when full Studio is off.");
assert.equal(getDznOperatorsFeatureFlags({ NEXT_PUBLIC_DZN_OPERATORS_ENABLED: "true", NEXT_PUBLIC_DZN_OPERATORS_ENGAGEMENT_ENABLED: "true" }).engagementEnabled, true, "Phase 2 still works when full Studio is off.");
assert.equal(getDznOperatorsFeatureFlags({ NEXT_PUBLIC_DZN_OPERATORS_FULL_STUDIO_ENABLED: "true" }).fullStudioEnabled, true);

for (const route of [
  "app/operators/studio/page.tsx",
  "app/operators/page.tsx",
  "app/operators/player/page.tsx",
  "app/operators/server/page.tsx",
  "app/operators/challenges/page.tsx",
  "app/operators/rank/page.tsx",
  "app/operators/leaderboards/page.tsx",
]) {
  assert.equal(existsSync(route), true, `Required route builds: ${route}`);
}

const studioSource = readFileSync("components/operators/full-studio/full-operator-studio.tsx", "utf8");
const canvasSource = readFileSync("components/operators/three/operator-3d-canvas.tsx", "utf8");
const viewerSource = readFileSync("components/operators/three/operator-3d-viewer.tsx", "utf8");
const cardSource = readFileSync("components/operators/full-studio/full-operator-card.tsx", "utf8");
assert.equal(studioSource.includes("OperatorAvatar"), false, "Current placeholder avatar implementation is no longer used in full mode.");
assert.equal(cardSource.includes("rounded-[40%]"), true, "Full card uses procedural tactical layered operator composition.");
assert.equal(viewerSource.includes("ssr: false"), true, "3D renderer is dynamic client-only.");
assert.equal(canvasSource.includes("WebGLRenderer"), true);
assert.equal(canvasSource.includes("PerspectiveCamera"), true);
assert.equal(canvasSource.includes("IntersectionObserver"), true, "Offscreen animation pause exists.");
assert.equal(canvasSource.includes("disposeOperatorModel"), true, "Resource disposal exists.");
assert.equal(readFileSync("components/operators/three/operator-webgl-fallback.tsx", "utf8").includes("WebGL is unavailable"), true, "WebGL fallback exists.");

for (const group of ["pelvis", "torso", "neck", "head", "upper_arms", "forearms", "hands", "thighs", "lower_legs", "feet", "clothing_layers", "armour_layers", "equipment_attachment_points", "weapon_attachment_points", "backpack_attachment", "headgear_attachment", "face_attachment", "hair_attachment", "emblem_attachment"]) {
  assert.equal(FULL_OPERATOR_BODY_GROUPS.includes(group as never), true, `Procedural rig exposes body group ${group}.`);
}

assert.equal(FULL_OPERATOR_BODY_PRESETS.length >= 6, true);
assert.equal(getFullOperatorCatalogItems("skin").length >= 10, true);
assert.equal(getFullOperatorCatalogItems("face").length >= 8, true);
assert.equal(getFullOperatorCatalogItems("hair").length >= 12, true);
assert.equal(getFullOperatorCatalogItems("facial_hair").length >= 8, true);
assert.equal(getFullOperatorCatalogItems("eyes").length >= 6, true);
assert.equal(getFullOperatorCatalogItems("scars").length + getFullOperatorCatalogItems("face_paint").length >= 8, true);

for (const category of FULL_OPERATOR_CATEGORIES) {
  assert.equal(FULL_OPERATOR_CATALOG.some((item) => item.category === category), true, `Category exists: ${category}`);
}
assert.equal(FULL_OPERATOR_STUDIO_RAIL.some((group) => group.group === "Appearance"), true, "Wardrobe categories exist.");
assert.equal(FULL_OPERATOR_STUDIO_RAIL.some((group) => group.group === "Weapons"), true, "Weapon categories exist.");
assert.equal(FULL_OPERATOR_POWER_SLOTS.length, 4, "Four power slots exist.");

assert.equal(FULL_OPERATOR_CATALOG.length >= 180, true, `Catalog contains ${FULL_OPERATOR_CATALOG.length} entries.`);
const ids = new Set<string>();
for (const item of FULL_OPERATOR_CATALOG) {
  assert.equal(ids.has(item.id), false, `No duplicate catalog ID: ${item.id}`);
  ids.add(item.id);
  assert.equal(item.accessibilityLabel.trim().length > 0, true, `${item.id} has accessibility label.`);
  assert.equal(item.unlockCondition.description.trim().length > 0, true, `${item.id} has fixed unlock condition.`);
  assert.equal(item.fixedUnlockSource.trim().length > 0, true, `${item.id} has fixed unlock source.`);
  assert.equal(/^https?:\/\//.test(JSON.stringify(item)), false, `${item.id} has no external image or model URL.`);
}

const defaultLoadout = getDefaultFullOperatorLoadout();
let loadout = createFullOperatorLoadout("Alpha Loadout");
assert.equal(loadout.displayName, "Alpha Loadout", "Loadout create works.");
loadout = renameFullOperatorLoadout(loadout, "Bravo Loadout");
assert.equal(loadout.displayName, "Bravo Loadout", "Loadout rename works.");
const duplicate = duplicateFullOperatorLoadout(loadout, [loadout]);
assert.notEqual(duplicate.id, loadout.id, "Loadout duplicate works.");
assert.equal(deleteFullOperatorLoadout([loadout, duplicate], duplicate.id).some((entry) => entry.id === duplicate.id), false, "Loadout delete works.");
const state = createFullStudioStorageState([loadout, duplicate], loadout.id, duplicate);
assert.equal(equipFullOperatorLoadout(state, duplicate.id).equippedLoadoutId, duplicate.id, "Loadout equip works.");
assert.deepEqual(resetFullOperatorLoadout(), defaultLoadout, "Loadout reset works.");
assert.equal(resetFullOperatorCategory(loadout, "helmet").selectedItemIds.helmet, defaultLoadout.selectedItemIds.helmet, "Reset one category works.");
assert.deepEqual(sanitizeFullOperatorLoadout(loadout, "free"), defaultLoadout, "Free loadouts sanitise safely.");
assert.equal(createFullStudioStorageState([loadout]).note, "preview_only_non_authoritative", "Premium demo remains non-authoritative.");
assert.equal(DZN_OPERATORS_FULL_STUDIO_STORAGE_KEY, "dzn:operators:studio:demo:v2");
const migrated = migrateLegacyOperatorStudioState(JSON.stringify({ version: 1, note: "preview_only_non_authoritative", loadouts: [{ id: "legacy-1", displayName: "Legacy Preview" }] }));
assert.equal(migrated.version, 2, "V1 local data migrates to V2 safely.");
assert.equal(parseFullStudioStorage("{broken").draftLoadout.id, defaultLoadout.id, "Malformed V2 data resets safely.");
assert.equal(sanitizeFullOperatorLoadout({ ...loadout, selectedItemIds: { ...loadout.selectedItemIds, helmet: "unknown" } }).selectedItemIds.helmet, defaultLoadout.selectedItemIds.helmet, "Unknown item IDs fall back safely.");
assert.equal(selectFullOperatorItem(loadout, "helmet", getFullOperatorCatalogItems("helmet")[0].id).selectedItemIds.helmet, getFullOperatorCatalogItems("helmet")[0].id);
const restrictedPlate = getFullOperatorCatalogItems("chest_plate").find((item) => !item.compatibleBodyPresets.includes("standard"));
assert.ok(restrictedPlate, "Catalog includes a body-preset compatibility guard.");
assert.equal(isFullOperatorItemCompatible(defaultLoadout, restrictedPlate.id), false, "Incompatible items are rejected.");
assert.equal(
  sanitizeFullOperatorLoadout({ ...defaultLoadout, selectedItemIds: { ...defaultLoadout.selectedItemIds, chest_plate: restrictedPlate.id } }).selectedItemIds.chest_plate,
  defaultLoadout.selectedItemIds.chest_plate,
  "Incompatible item IDs fall back safely.",
);

assert.equal(FULL_OPERATOR_CATALOG.filter((item) => item.kind === "weapon").length >= 23, true);
assert.equal(getFullOperatorItem("primary_weapon-dzn-ar-4-assault-rifle")?.displayName, "DZN AR-4 Assault Rifle");
for (const weapon of FULL_OPERATOR_CATALOG.filter((item) => item.kind === "weapon")) {
  assert.doesNotThrow(() => assertNoFullOperatorCompetitiveFields(weapon), `${weapon.id} has no gameplay-stat fields.`);
}
for (const power of FULL_OPERATOR_CATALOG.filter((item) => item.kind === "power")) {
  assert.doesNotThrow(() => assertNoFullOperatorCompetitiveFields(power), `${power.id} has no competitive-modifier fields.`);
}
assert.equal(JSON.stringify(defaultLoadout.identity.body).match(/damage|health|speed|score|modifier/), null, "Operator body settings contain no gameplay modifiers.");

assert.deepEqual(freeCompetitionParticipation(), {
  competitions: true,
  publicStatistics: true,
  leaderboards: true,
  votingRights: true,
  progression: true,
  badgesAndTrophies: true,
  contracts: true,
});
assertNoFullOperatorCompetitiveFields(FULL_OPERATOR_CATALOG);
assertNoFullOperatorCompetitiveFields(buildOperatorMasterySummary(1000, []));
assertNoFullOperatorCompetitiveFields(buildWeaponMasterySummary(defaultLoadout.weapon.primaryWeaponItemId, 1000));
assert.doesNotThrow(() => assertNoFullOperatorCompetitiveFields(applyFullOperatorColourTheme(defaultLoadout, "theme")));
assert.doesNotThrow(() => assertNoFullOperatorCompetitiveFields(deterministicFullOperatorRandomise(defaultLoadout, "seed")));
assert.throws(() => assertNoFullOperatorCompetitiveFields({ damage: 1 }), /Prohibited full operator/);

const serializedFull = [
  JSON.stringify(FULL_OPERATOR_CATALOG),
  readFileSync("lib/operators/full-customisation/loadouts.ts", "utf8"),
  readFileSync("components/operators/full-studio/full-operator-studio.tsx", "utf8"),
].join("\n");
for (const prohibited of FULL_OPERATOR_PROHIBITED_COMPETITIVE_FIELDS) {
  assert.equal(new RegExp(`\"${prohibited}\"\\s*:`).test(serializedFull), false, `No ${prohibited} field exists.`);
}
assert.equal(/photo upload|selfie|face scan|camera capture|biometric|image-recognition/i.test(serializedFull), false, "No photo-upload or biometric feature exists.");
assert.equal(/loot box|lootbox|spin wheel|paid random|gambling|cash prize|purchasable XP/i.test(serializedFull), false, "No paid random reward or spin wheel exists.");
assert.equal(/Math\.random/.test(serializedFull), false, "No Math.random is used in rewards or unlocks.");

const player = getFullOperatorPlayer("rafael");
assert.ok(player);
assert.equal(player.equippedLoadout.id.includes("rafael"), true, "Player profile uses equipped loadout.");
const server = getFullOperatorServer("pandora-dayz");
assert.ok(server);
assert.equal(server.topOperators.every((entry) => entry.equippedLoadout.id.startsWith("full-")), true, "Server page uses player Operator thumbnails.");
assert.equal(cardSource.includes("loadout.weapon.primaryWeaponItemId"), true, "Operator Card uses equipped selections.");
assert.equal(getFullOperatorPlayer("unknown"), null);
assert.equal(getFullOperatorServer("unknown"), null);

const profileSource = readFileSync("components/operators/full-studio/full-operator-player-profile.tsx", "utf8");
const serverSource = readFileSync("components/operators/full-studio/full-operator-server-dashboard.tsx", "utf8");
assert.equal(/raw coordinates|private Discord ID|internal database ID/.test(profileSource), true, "Privacy copy remains visible.");
assert.equal(JSON.stringify(FULL_OPERATOR_DEMO_PLAYERS).match(/coordinates|discord|database|session|auth/), null, "No private identity data in seeded players.");
assert.equal(serverSource.includes("No arbitrary XP grants"), true, "Server owner cannot grant XP in Phase 3.");

for (const source of [
  studioSource,
  cardSource,
  profileSource,
  serverSource,
  canvasSource,
]) {
  assert.equal(/https?:\/\//.test(source), false, "No external image or model dependency in full Studio source.");
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
assert.equal(packageJson.scripts["test:dzn-operators-full-customisation"], "tsx scripts/test-dzn-operators-full-customisation.ts");
assert.equal(packageJson.scripts.test.includes("npm run test:dzn-operators-full-customisation"), true, "Full test aggregation includes Phase 3.");

console.log("DZN Operators full customisation tests passed.");
