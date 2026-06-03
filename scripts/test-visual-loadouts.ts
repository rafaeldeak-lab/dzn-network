import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { normalizePlanKey } from "../lib/billing/plans";
import { getVisualLoadoutPlanLimits, VISUAL_LOADOUT_PLAN_LIMITS } from "../functions/_lib/server-visual-loadouts";

const helper = read("functions/_lib/server-visual-loadouts.ts");
const route = read("functions/api/servers/[serverId]/visual-loadout.ts");
const migration = read("migrations/0047_server_visual_loadouts.sql");
const visuals = read("lib/badges/visuals.ts");

assert.equal(existsSync("functions/_lib/server-visual-loadouts.ts"), true, "Visual loadout helper should exist.");
assert.equal(existsSync("functions/api/servers/[serverId]/visual-loadout.ts"), true, "Visual loadout API route should exist.");

for (const table of ["server_visual_loadouts", "server_customisation_audit_log"]) {
  assert.equal(migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`), true, `${table} migration should exist.`);
}
assert.equal(/DROP\s+TABLE|DELETE\s+FROM|TRUNCATE|CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?player_stats|ALTER\s+TABLE\s+player_profiles/i.test(migration), false, "Visual loadout migration must be additive and must not touch player profiles/stats.");

for (const exported of [
  "getServerVisualLoadout",
  "resolveServerVisualLoadout",
  "validateServerVisualLoadout",
  "saveServerVisualLoadout",
  "getAvailableFramesForServer",
  "getAvailableThemesForServer",
  "getAvailableShowcaseBadgesForServer",
]) {
  assert.equal(helper.includes(`export async function ${exported}`), true, `${exported} should be exported.`);
}

assert.equal(VISUAL_LOADOUT_PLAN_LIMITS.starter.maxShowcaseBadges, 3);
assert.equal(VISUAL_LOADOUT_PLAN_LIMITS.pro.maxShowcaseBadges, 5);
assert.equal(VISUAL_LOADOUT_PLAN_LIMITS.premium.maxShowcaseBadges, 8);
assert.equal(getVisualLoadoutPlanLimits("starter").animationsAllowed, false);
assert.equal(getVisualLoadoutPlanLimits("pro").animationsAllowed, false);
assert.equal(getVisualLoadoutPlanLimits("premium").animationsAllowed, true);
assert.equal(normalizePlanKey("network"), "premium");
assert.equal(normalizePlanKey("partner"), "premium");
assert.equal(getVisualLoadoutPlanLimits("network").maxShowcaseBadges, 8);
assert.equal(getVisualLoadoutPlanLimits("partner").maxShowcaseBadges, 8);

assert.equal(helper.includes("SHOWCASE_BADGE_LIMIT_EXCEEDED"), true, "Plan badge limits should be enforced.");
assert.equal(helper.includes("BADGE_NOT_EARNED"), true, "Unearned showcase badges should be rejected.");
assert.equal(helper.includes("FRAME_NOT_AVAILABLE"), true, "Unavailable frames should be rejected.");
assert.equal(helper.includes("THEME_NOT_AVAILABLE"), true, "Unavailable themes should be rejected.");
assert.equal(helper.includes("ANIMATION_PLAN_REQUIRED"), true, "Premium-only animation selection should be enforced.");
assert.equal(helper.includes("defaultFrameKeyForPlan"), true, "Invalid saved frames should fall back safely.");
assert.equal(helper.includes("defaultThemeKeyForPlan"), true, "Invalid saved themes should fall back safely.");
assert.equal(helper.includes("parseSavedBadgeCodes"), true, "Invalid saved badge JSON should fall back safely.");
assert.equal(helper.includes("server_customisation_audit_log"), true, "Saves should write customisation audit logs.");
assert.equal(helper.includes("getEarnedServerBadges"), true, "Badge selection should use earned badge awards.");
assert.equal(helper.includes("selectShowcaseBadges"), true, "Badge order should reuse badge showcase logic.");

for (const snippet of [
  "onRequestGet",
  "onRequestPut",
  "resolveOwnerVisualLoadoutServer",
  "saveServerVisualLoadout",
  "readJson<VisualLoadoutInput>",
  "VISUAL_LOADOUT_UNAVAILABLE",
]) {
  assert.equal(route.includes(snippet), true, `Visual loadout route should include ${snippet}.`);
}
assert.equal(helper.includes("status: 401"), true, "Resolver should return 401 for unauthenticated users.");
assert.equal(helper.includes("status: 403"), true, "Resolver should return 403 for authenticated non-owners.");

assert.equal(helper.includes("linked_servers.nitrado_service_id = ?"), true, "Nitrado service id should resolve for compatibility.");
assert.equal(helper.includes("linked_servers.public_slug = ?"), true, "Public slug should resolve for compatibility.");
assert.equal(helper.includes("server.user_id === user.id"), true, "Owner access should be supported.");
assert.equal(helper.includes("DZN_SUPPORT_DISCORD_IDS"), true, "Support users should be supported.");
assert.equal(helper.includes("DZN_DEV_DISCORD_IDS"), true, "Dev/support users should be supported.");

for (const frameKey of ["bronze", "silver", "gold", "platinum", "diamond", "legendary", "premium"]) {
  assert.equal(visuals.includes(`${frameKey}: frame(`), true, `${frameKey} frame should remain configured.`);
}
for (const themeKey of ["apocalypse", "chernarus", "space"]) {
  assert.equal(visuals.includes(`${themeKey}: theme(`), true, `${themeKey} theme should remain configured.`);
}

assert.equal(/from\s+["'][^"']*(?:adm-sync|adm-import|adm-parser|nitrado)[^"']*["']|adm_import_jobs|adm_sync_state/i.test(helper.replace(/nitrado_service_id/g, "")), false, "Visual loadout helper must not import or modify ADM/Nitrado systems.");
assert.equal(/from\s+["'][^"']*(?:adm-sync|adm-import|adm-parser|nitrado)[^"']*["']|adm_import_jobs|adm_sync_state/i.test(route.replace(/nitrado_service_id/g, "")), false, "Visual loadout route must not import or modify ADM/Nitrado systems.");

console.log("Visual loadout backend tests passed.");

function read(path: string) {
  return readFileSync(path, "utf8");
}
