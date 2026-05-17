import assert from "node:assert/strict";

import { detectServerModeFromText, parseNitradoPlayerCountPair, resolveLivePlayerCounts } from "../functions/_lib/server-metadata";

assert.equal(detectServerModeFromText(["NukeTown DEATHMATCH"]), "DEATHMATCH");
assert.equal(detectServerModeFromText(["Weekend raids KOS faction wars"]), "PVP");
assert.equal(detectServerModeFromText(["No KOS roleplay survival"]), "PVE");
assert.equal(detectServerModeFromText(["PvP weekdays and PvE safe zones"]), "PVP / PVE");
assert.equal(detectServerModeFromText(["quiet community server"]), "SURVIVAL");

assert.deepEqual(parseNitradoPlayerCountPair("2/10"), { current: 2, max: 10 });
assert.deepEqual(resolveLivePlayerCounts({
  currentPlayers: 2,
  maxPlayers: 10,
  existingCurrentPlayers: 0,
  existingMaxPlayers: 22,
}), {
  current_players: 2,
  max_players: 10,
  currentMissing: false,
  maxMissing: false,
});
assert.deepEqual(resolveLivePlayerCounts({
  currentPlayers: undefined,
  maxPlayers: undefined,
  existingCurrentPlayers: 2,
  existingMaxPlayers: 10,
}), {
  current_players: 2,
  max_players: 10,
  currentMissing: true,
  maxMissing: true,
});
assert.deepEqual(resolveLivePlayerCounts({
  currentPlayers: 0,
  maxPlayers: 10,
  existingCurrentPlayers: 2,
  existingMaxPlayers: 22,
}), {
  current_players: 0,
  max_players: 10,
  currentMissing: false,
  maxMissing: false,
});

console.log("Server metadata mode and live player count tests passed.");
