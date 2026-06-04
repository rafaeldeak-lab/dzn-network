import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const section = read("components/onboarding/visual-loadout-section.tsx");
const settingsPage = read("components/onboarding/server-settings-page.tsx");

assert.equal(existsSync("components/onboarding/visual-loadout-section.tsx"), true, "Visual loadout dashboard section should exist.");
assert.equal(settingsPage.includes("VisualLoadoutSection"), true, "Server Settings should render the visual loadout section.");

for (const text of [
  "Server Visual Loadout",
  "Current public card preview",
  "Current profile header preview",
  "Showcase badge selector",
  "Frame selector",
  "Theme selector",
  "Animation level selector",
  "Premium unlocks 8 slots",
  "full visual loadout benefits",
  "earned badges can be selected",
  "Earned competitive badges still cannot be faked",
  "Save Visual Loadout",
]) {
  assert.equal(section.includes(text), true, `Visual loadout UI should include ${text}.`);
}

for (const component of ["BadgeIcon", "ServerCardBadges", "ServerProfileFrame", "ServerThemeBanner", "SaveProgressButton", "useSaveProgress"]) {
  assert.equal(section.includes(component), true, `Visual loadout UI should reuse ${component}.`);
}

assert.equal(section.includes("/visual-loadout"), true, "Visual loadout UI should call the visual loadout endpoint.");
assert.equal(section.includes('method: "PUT"'), true, "Visual loadout save should use PUT.");
assert.equal(section.includes("selectedBadgeCodes.length >= limits.maxShowcaseBadges"), true, "Badge selector should respect plan limits.");
assert.equal(section.includes("LOCKED_BADGE_PREVIEWS"), true, "Locked badge previews should be shown.");
assert.equal(section.includes("disabled={locked}"), true, "Locked frames/themes should not be selectable.");
assert.equal(section.includes("availableFrameKeys.has"), true, "Frame availability should come from API availability.");
assert.equal(section.includes("availableThemeKeys.has"), true, "Theme availability should come from API availability.");
assert.equal(section.includes("ANIMATION_PLAN_REQUIRED") || section.includes("limits.animationsAllowed"), true, "Animation selector should respect plan limits.");
assert.equal(section.includes("prefers-reduced-motion"), false, "Reduced motion is handled by existing badge CSS, not duplicated in this component.");
assert.equal(section.includes("Unable to save visual loadout"), true, "Validation/API errors should be shown.");

assert.equal(/from\s+["'][^"']*(?:adm-sync|adm-import|adm-parser|nitrado)[^"']*["']|adm_import_jobs|adm_sync_state/i.test(section), false, "Visual loadout dashboard must not import ADM/Nitrado systems.");
assert.equal(/window\.location\.reload|location\.reload/i.test(section), false, "Visual loadout save must not hard-refresh the browser.");

console.log("Visual loadout dashboard tests passed.");

function read(path: string) {
  return readFileSync(path, "utf8");
}
