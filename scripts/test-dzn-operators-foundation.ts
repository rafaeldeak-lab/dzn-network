import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { DZN_OPERATOR_CATALOG, STARTER_ITEM_IDS_BY_SLOT } from "../lib/operators/catalog";
import { getDznOperatorsFeatureFlags } from "../lib/operators/feature-flags";
import {
  DZN_OPERATORS_DEMO_STORAGE_KEY,
  createPreviewStorageState,
  parseOperatorPreviewStorage,
} from "../lib/operators/local-preview";
import {
  assertNoCompetitiveOperatorFields,
  buildOperatorCardPresentation,
  canSaveOperatorLoadout,
  freeCompetitionParticipation,
  getDefaultOperatorLoadout,
  sanitizeOperatorLoadout,
  validateOperatorLoadout,
} from "../lib/operators/loadout";
import {
  OPERATOR_COSMETIC_SLOTS,
  PROHIBITED_OPERATOR_COMPETITIVE_FIELDS,
  type OperatorLoadout,
} from "../lib/operators/types";

assert.deepEqual(getDznOperatorsFeatureFlags({}), { enabled: false, demoMode: false });
assert.deepEqual(getDznOperatorsFeatureFlags({
  NEXT_PUBLIC_DZN_OPERATORS_ENABLED: "true",
  NEXT_PUBLIC_DZN_OPERATORS_DEMO_MODE: "true",
}), { enabled: true, demoMode: true });

const defaultLoadout = getDefaultOperatorLoadout();
const premiumHead = DZN_OPERATOR_CATALOG.items.find((item) => item.slot === "head" && item.entitlement === "premium");
assert.ok(premiumHead);

const customLoadout: OperatorLoadout = {
  ...defaultLoadout,
  id: "custom-preview",
  displayName: "Custom Preview",
  selections: {
    ...defaultLoadout.selections,
    head: premiumHead.id,
  },
};

assert.deepEqual(sanitizeOperatorLoadout("free", customLoadout), defaultLoadout, "Free users resolve to the starter operator.");
assert.equal(canSaveOperatorLoadout("free", customLoadout), false, "Free users cannot save custom loadouts.");

const freeCustomValidation = validateOperatorLoadout("free", customLoadout);
assert.equal(freeCustomValidation.valid, false);
assert.equal(freeCustomValidation.issues.some((issue) => issue.code === "free_custom_loadout"), true);
assert.equal(freeCustomValidation.issues.some((issue) => issue.code === "premium_required"), true, "Free users cannot equip premium cosmetics.");

const premiumValidation = validateOperatorLoadout("premium", customLoadout);
assert.equal(premiumValidation.valid, true, "Premium users can validate compatible premium cosmetics.");

const unknownItemValidation = validateOperatorLoadout("premium", {
  ...defaultLoadout,
  selections: {
    ...defaultLoadout.selections,
    head: "unknown-item",
  },
});
assert.equal(unknownItemValidation.valid, false);
assert.equal(unknownItemValidation.issues.some((issue) => issue.code === "item_unknown"), true);

const incompatibleSlotValidation = validateOperatorLoadout("premium", {
  ...defaultLoadout,
  selections: {
    ...defaultLoadout.selections,
    feet: premiumHead.id,
  },
});
assert.equal(incompatibleSlotValidation.valid, false);
assert.equal(incompatibleSlotValidation.issues.some((issue) => issue.code === "item_slot_mismatch"), true);

const missingSlots = sanitizeOperatorLoadout("premium", {
  ...defaultLoadout,
  selections: {
    head: premiumHead.id,
  },
});
for (const slot of OPERATOR_COSMETIC_SLOTS) {
  assert.equal(Boolean(missingSlots.selections[slot]), true, `${slot} should have a deterministic selected item.`);
}
assert.equal(missingSlots.selections.pose, STARTER_ITEM_IDS_BY_SLOT.pose);

const malformedPreview = parseOperatorPreviewStorage("{not valid json");
assert.equal(malformedPreview.version, 1);
assert.equal(malformedPreview.note, "preview_only_non_authoritative");
assert.deepEqual(malformedPreview.loadouts, [defaultLoadout]);

const previewState = createPreviewStorageState([customLoadout], customLoadout.id);
assert.equal(previewState.note, "preview_only_non_authoritative");
assert.equal(DZN_OPERATORS_DEMO_STORAGE_KEY, "dzn:operators:demo:v1");
assert.equal(JSON.stringify(previewState).includes("subscription"), false, "Demo persistence must not claim subscription authority.");

const presentation = buildOperatorCardPresentation(customLoadout);
assertNoCompetitiveOperatorFields(presentation);
const serializedPresentation = JSON.stringify(presentation);
for (const prohibited of PROHIBITED_OPERATOR_COMPETITIVE_FIELDS) {
  assert.equal(serializedPresentation.includes(prohibited), false, `Presentation must not contain ${prohibited}.`);
}
assert.equal(serializedPresentation.includes("score"), false, "Operator presentation contains no scoring modifier.");
assert.equal(serializedPresentation.includes("eligibility"), false, "Operator presentation contains no eligibility modifier.");
assert.equal(serializedPresentation.includes("ranking"), false, "Operator presentation contains no ranking modifier.");
assert.equal(serializedPresentation.includes("voteMultiplier"), false, "Operator presentation contains no voting modifier.");
assert.equal(serializedPresentation.includes("matchmaking"), false, "Operator presentation contains no matchmaking modifier.");
assert.equal(serializedPresentation.includes("rewardMultiplier"), false, "Operator presentation contains no reward-odds modifier.");

assert.deepEqual(freeCompetitionParticipation(), {
  competitions: true,
  publicStatistics: true,
  leaderboards: true,
  votingRights: true,
  progression: true,
  badgesAndTrophies: true,
  contracts: true,
});

const serializedCatalog = JSON.stringify(DZN_OPERATOR_CATALOG);
assert.equal(/loot\s*box|lootbox|randomReward|paidRandom|gambling|winChance|statBoost/i.test(serializedCatalog), false, "No paid randomized loot-box or boost model exists.");

const ids = new Set<string>();
for (const item of DZN_OPERATOR_CATALOG.items) {
  assert.equal(ids.has(item.id), false, `Catalog ID must be unique: ${item.id}`);
  ids.add(item.id);
  assert.equal(typeof item.accessibilityLabel, "string");
  assert.equal(item.accessibilityLabel.trim().length > 0, true, `${item.id} needs an accessibility label.`);
  assert.equal("scoreMultiplier" in item, false);
}

assert.equal(DZN_OPERATOR_CATALOG.operators.length, 1);
assert.equal(DZN_OPERATOR_CATALOG.items.filter((item) => item.entitlement === "free").length >= 2, true);
assert.equal(DZN_OPERATOR_CATALOG.items.filter((item) => item.entitlement === "premium").length >= 10, true);
assert.equal(DZN_OPERATOR_CATALOG.items.filter((item) => item.slot === "pose").length >= 3, true);
assert.equal(DZN_OPERATOR_CATALOG.items.filter((item) => item.slot === "background").length >= 3, true);
assert.equal(DZN_OPERATOR_CATALOG.items.filter((item) => item.slot === "frame").length >= 3, true);
assert.equal(DZN_OPERATOR_CATALOG.items.filter((item) => item.slot === "entrance_animation").length >= 2, true);
assert.equal(DZN_OPERATOR_CATALOG.items.filter((item) => item.slot === "victory_animation").length >= 2, true);

const premiumPresentation = buildOperatorCardPresentation(customLoadout);
const defaultPresentation = buildOperatorCardPresentation(defaultLoadout);
assert.deepEqual(freeCompetitionParticipation(), freeCompetitionParticipation(), "Premium status changes cosmetics only.");
assert.notEqual(premiumPresentation.selectedItems.head.id, defaultPresentation.selectedItems.head.id);
assert.equal(premiumPresentation.fairnessNotice, defaultPresentation.fairnessNotice);

assert.doesNotThrow(() => assertNoCompetitiveOperatorFields(JSON.parse(JSON.stringify(customLoadout))));
assert.throws(
  () => assertNoCompetitiveOperatorFields({ loadout: customLoadout, scoreMultiplier: 2 }),
  /Prohibited competitive operator field/,
);

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
assert.equal(packageJson.scripts["test:dzn-operators"], "tsx scripts/test-dzn-operators-foundation.ts");
assert.equal(packageJson.scripts.test.includes("npm run test:dzn-operators"), true, "Full local test aggregation should include DZN Operators.");

const siteHeader = readFileSync("components/site-header.tsx", "utf8");
assert.equal(siteHeader.includes("isDznOperatorsEnabled()"), true, "Operators nav must be feature-flag gated.");
assert.equal(siteHeader.includes('href="/operators"'), true, "Operators nav route should exist only behind the flag.");

console.log("DZN Operators foundation tests passed.");
