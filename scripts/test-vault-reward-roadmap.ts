import assert from "node:assert/strict";
import { VAULT_REWARD_ART_ROADMAP, VAULT_REWARD_ART_ROADMAP_SUMMARY } from "../lib/vault-reward-roadmap";

assert.equal(VAULT_REWARD_ART_ROADMAP.length, 216, "The Vault art roadmap must be sized for hundreds of future editions.");
assert.equal(new Set(VAULT_REWARD_ART_ROADMAP.map((entry) => entry.id)).size, VAULT_REWARD_ART_ROADMAP.length, "Every planned edition needs a unique production identity.");
assert.equal(new Set(VAULT_REWARD_ART_ROADMAP.map((entry) => entry.name)).size, VAULT_REWARD_ART_ROADMAP.length, "Every planned edition needs a unique public name.");
assert.deepEqual(new Set(VAULT_REWARD_ART_ROADMAP.map((entry) => entry.artStatus)), new Set(["briefed"]), "Unproduced art briefs must not be represented as published assets.");
assert.equal(VAULT_REWARD_ART_ROADMAP_SUMMARY.plannedEditions, 216);
assert.equal(VAULT_REWARD_ART_ROADMAP_SUMMARY.producedOpeningCaches, 3);
console.log("DZN Vault reward roadmap passed: 216 distinct, art-briefed future editions with no accidental Store activation.");
