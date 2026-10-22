import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pageSource = readFileSync("app/games/page.tsx", "utf8");
const maintenanceSource = readFileSync("components/games/games-hub-maintenance.tsx", "utf8");
const updatesSource = readFileSync("lib/dzn-updates.ts", "utf8");

assert.match(pageSource, /GamesHubMaintenance/, "The public Games route must render the maintenance state.");
assert.doesNotMatch(pageSource, /import\s+\{\s*GamesHub\s*\}/, "The public Games route must not mount the playable Games Hub during maintenance.");
assert.match(pageSource, /DZN Games Hub Maintenance/, "Maintenance metadata must accurately describe the public route.");

assert.match(maintenanceSource, /Games Hub is under maintenance\./, "Visitors need an unambiguous maintenance heading.");
assert.match(maintenanceSource, /Existing verified player records remain protected\./, "The maintenance notice must state that records are not being reset.");
assert.match(maintenanceSource, /href="\/community"/, "Maintenance visitors must have a direct Community route.");
assert.match(maintenanceSource, /href="\/updates"/, "Maintenance visitors must have a direct official-updates route.");
assert.doesNotMatch(maintenanceSource, /\/login\?returnTo=%2Fgames/, "Maintenance mode must not encourage visitors to sign in and play.");
assert.doesNotMatch(maintenanceSource, /game catalogue/i, "Maintenance mode must not display a playable-mode catalogue.");

assert.match(updatesSource, /games-hub-maintenance-window/, "The official update feed must record the Games Hub maintenance window.");
assert.match(updatesSource, /Games Hub is temporarily closed for maintenance/, "The official update feed must describe the public Games state accurately.");

console.log("Games Hub maintenance checks passed.");
