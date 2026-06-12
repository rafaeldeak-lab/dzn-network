import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  assertSameCategoryChallenge,
  assertServerWarCategoryEligible,
  getServerWarRuleset,
  isPublicServerWarsEligibleServer,
} from "../functions/_lib/server-war-categories";
import { getServerWarsAccess } from "../functions/_lib/server-wars";

assert.equal(getServerWarRuleset("deathmatch_war").eligibleCategories.includes("deathmatch"), true);
assert.equal(getServerWarRuleset("pve_builder_cup").eligibleCategories.includes("pve"), true);
assert.equal(getServerWarRuleset("pve_builder_cup").eligibleCategories.includes("pvp_pve"), true);
assert.equal(getServerWarRuleset("longest_kill_cup").eligibleCategories.includes("deathmatch"), true);
assert.deepEqual(getServerWarRuleset("hybrid_war").eligibleCategories, ["pvp_pve"]);
assert.throws(() => assertServerWarCategoryEligible({ server_category: null }, "deathmatch_war"), /Set a server category/);
assert.throws(() => assertServerWarCategoryEligible({ server_category: "pve" }, "deathmatch_war"), /not eligible/);
assert.equal(assertServerWarCategoryEligible({ server_category: "Deathmatch" }, "deathmatch_war"), "deathmatch");
assert.equal(assertSameCategoryChallenge({ server_category: "pvp" }, { server_category: "pvp" }, "pvp_war"), "pvp");
assert.throws(() => assertSameCategoryChallenge({ server_category: "pvp" }, { server_category: "pvp_pve" }, "pvp_war"), /same category/i);

assert.equal(isPublicServerWarsEligibleServer({ status: "live", listing_visibility: "public" }), true);
assert.equal(isPublicServerWarsEligibleServer({ status: "pending", listing_visibility: "public" }), false);
assert.equal(isPublicServerWarsEligibleServer({ status: "live", listing_visibility: "unlisted" }), false);
assert.equal(isPublicServerWarsEligibleServer({ status: "live", listing_visibility: "private" }), false);
assert.equal(isPublicServerWarsEligibleServer({ status: "archived", listing_visibility: "public" }), false);

assert.equal(getServerWarsAccess("free", "active").canCreateChallenge, false);
assert.equal(getServerWarsAccess("starter", "active").canCreateChallenge, false);
assert.equal(getServerWarsAccess("pro", "active").canCreateChallenge, true);
assert.equal(getServerWarsAccess("pro", "trialing").canCreateChallenge, true);
assert.equal(getServerWarsAccess("premium", "active").canCreateChallenge, true);
assert.equal(getServerWarsAccess("premium", "active").canCreateFeatured, true);
for (const inactiveStatus of ["canceled", "cancelled", "past_due", "unpaid", "incomplete", "incomplete_expired", "paused", "expired", null, undefined]) {
  assert.equal(getServerWarsAccess("premium", inactiveStatus).canCreateChallenge, false, `${inactiveStatus} must not unlock Server Wars challenge hosting.`);
  assert.equal(getServerWarsAccess("pro", inactiveStatus).canCreateChallenge, false, `${inactiveStatus} must not unlock Pro Server Wars challenge hosting.`);
}
assert.equal(getServerWarsAccess("network", "active").effectivePlan, "premium");
assert.equal(getServerWarsAccess("partner", "trialing").effectivePlan, "premium");
assert.equal(getServerWarsAccess("network", "past_due").effectivePlan, "free");

const apiSource = readFileSync("functions/_lib/server-wars.ts", "utf8");
assert.match(apiSource, /requireServerOwnerOrDznAdmin/);
assert.match(apiSource, /effectiveEntitlementPlan/);
assert.match(apiSource, /assertSameCategoryChallenge/);
assert.match(apiSource, /isPublicServerWarsEligibleServer/);
assert.match(apiSource, /Plan tier does not affect scoring|Plans affect hosting/);
assert.doesNotMatch(apiSource, /player_stats/i);
assert.doesNotMatch(apiSource, /TOKEN_ENCRYPTION_KEY|NITRADO_TOKEN|STRIPE_SECRET/i);

const ownerRoute = readFileSync("functions/api/servers/[serverId]/wars/index.ts", "utf8");
const challengeRoute = readFileSync("functions/api/servers/[serverId]/wars/challenges/index.ts", "utf8");
assert.match(ownerRoute, /getSessionUser/);
assert.match(ownerRoute, /unauthenticated/);
assert.match(challengeRoute, /getSessionUser/);
assert.match(challengeRoute, /createServerWarChallenge/);
assert.match(challengeRoute, /status: result\.status/);

console.log("Server Wars package/category gating tests passed.");
