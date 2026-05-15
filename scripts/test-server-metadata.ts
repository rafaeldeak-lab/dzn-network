import assert from "node:assert/strict";

import { detectServerModeFromText } from "../functions/_lib/server-metadata";

assert.equal(detectServerModeFromText(["NukeTown DEATHMATCH"]), "DEATHMATCH");
assert.equal(detectServerModeFromText(["Weekend raids KOS faction wars"]), "PVP");
assert.equal(detectServerModeFromText(["No KOS roleplay survival"]), "PVE");
assert.equal(detectServerModeFromText(["PvP weekdays and PvE safe zones"]), "PVP / PVE");
assert.equal(detectServerModeFromText(["quiet community server"]), "SURVIVAL");

console.log("Server metadata mode detection tests passed.");
