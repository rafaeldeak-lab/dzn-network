import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { getBillingPlanSummaries } from "../functions/_lib/plans";
import { getVisualLoadoutPlanLimits } from "../functions/_lib/server-visual-loadouts";
import type { Env } from "../functions/_lib/types";

const loadouts = read("functions/_lib/server-visual-loadouts.ts");
const publicServers = read("functions/api/public/servers.ts");
const publicNetwork = read("components/network/public-network.tsx");
const globals = read("app/globals.css");

assert.equal(loadouts.includes("resolvePublicServerVisualLoadout"), true, "Public visual loadout resolver should exist.");
assert.equal(loadouts.includes("PublicServerVisualLoadoutFallback"), true, "Public resolver should accept automatic visual fallbacks.");
assert.equal(loadouts.includes("savedBadgeSelectionIsInvalid"), true, "Invalid saved badge selections should fall back safely.");
assert.equal(loadouts.includes("publicFrameVisualsForPlan"), true, "Public frames should be plan validated.");
assert.equal(loadouts.includes("publicThemeBannerVisualsForPlan"), true, "Public themes should be plan validated.");
assert.equal(loadouts.includes('if (planKey === "premium") return Object.values(frames);'), true, "Premium should have premium visual access.");
assert.equal(loadouts.includes("REPUTATION_FRAME_KEYS"), true, "Pro should use reputation frames.");
assert.equal(loadouts.includes("[DEFAULT_FRAME_KEY]"), true, "Starter should be limited to default frames.");
assert.equal(loadouts.includes("[DEFAULT_THEME_KEY]"), true, "Starter should be limited to default themes.");
assert.equal(loadouts.includes("limits.animationsAllowed"), true, "Animation output should be plan gated.");

assert.equal(publicServers.includes("resolvePublicServerVisualLoadout"), true, "Public server API should resolve saved loadouts.");
for (const field of ["visualLoadout", "showcaseBadgeCodes", "profileFrameKey", "themeBannerKey", "cardStyle", "accentColour"]) {
  assert.equal(publicServers.includes(field), true, `Public API should expose ${field}.`);
}
assert.equal(publicServers.includes("badgeCollection.showcaseBadges.length ? badgeCollection.showcaseBadges : visualShowcase.badges"), true, "Automatic strongest badges should remain the fallback.");
assert.equal(publicServers.includes("availableShowcaseBadges.length ? availableShowcaseBadges : automaticShowcaseBadges"), true, "Saved badge selections should be checked against earned/available badges.");
assert.equal(publicServers.includes("sortPublicServersForDiscovery(servers)"), true, "Existing discovery sorting should remain in place.");
assert.equal(publicServers.includes("cardStyle") && publicServers.includes("rankA") && publicServers.includes("scoreDiff"), true, "Visual styling fields must not replace competitive rank/score sorting.");

assert.equal(publicNetwork.includes("server.showcaseBadges ?? server.badges"), true, "Public cards/profile should use selected showcase badges.");
assert.equal(publicNetwork.includes("ServerProfileFrame frame={server.profileFrame}"), true, "Public UI should render selected profile frames.");
assert.equal(publicNetwork.includes("ServerThemeBanner theme={server.themeBanner}"), true, "Public profile should render selected theme banners.");
assert.equal(publicNetwork.includes("dzn-server-card--visual-"), true, "Public cards should apply visual card style.");
assert.equal(publicNetwork.includes("--dzn-card-accent"), true, "Public cards should apply selected accent colour.");
assert.equal(publicNetwork.includes("--dzn-profile-accent"), true, "Public profile should apply selected accent colour.");
assert.equal(globals.includes(".dzn-server-card--visual-premium"), true, "Premium card treatment CSS should exist.");
assert.equal(globals.includes(".dzn-profile-header--visual-premium"), true, "Premium profile treatment CSS should exist.");

assert.equal(getVisualLoadoutPlanLimits("starter").maxShowcaseBadges, 3);
assert.equal(getVisualLoadoutPlanLimits("pro").maxShowcaseBadges, 5);
assert.equal(getVisualLoadoutPlanLimits("premium").maxShowcaseBadges, 8);
assert.equal(getVisualLoadoutPlanLimits("network").maxShowcaseBadges, 8);
assert.equal(getVisualLoadoutPlanLimits("partner").maxShowcaseBadges, 8);

const planNames = getBillingPlanSummaries({} as Env).map((plan) => plan.name).join(" ");
assert.equal(/DZN Network|DZN Partner/.test(planNames), false, "Network/Partner must not be public billing plans.");

for (const source of [loadouts, publicNetwork]) {
  assert.equal(/from\s+["'][^"']*(?:adm-sync|adm-import|adm-parser|nitrado)[^"']*["']|adm_import_jobs|adm_sync_state/i.test(source.replace(/nitrado_service_id/g, "")), false, "Public visual loadout work must not import or modify ADM/Nitrado systems.");
}

console.log("Public visual loadout rendering tests passed.");

function read(path: string) {
  return readFileSync(path, "utf8");
}
