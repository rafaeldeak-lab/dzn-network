import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { formatPublicServerName } from "../lib/public-display-text";

assert.equal(formatPublicServerName("NUKETOWN DEATHMATCH- HTTPS://DAYZ-NETWORK.COM"), "NukeTown Deathmatch");
assert.equal(formatPublicServerName("Example server | www.example.net"), "Example server");
assert.equal(formatPublicServerName("https://dayz-network.com"), "DZN Server");
assert.equal(formatPublicServerName("DZN PvP EU"), "DZN PvP EU");

const publicServers = readFileSync("functions/api/public/servers.ts", "utf8");
const publicLeaderboards = readFileSync("functions/_lib/public-leaderboards.ts", "utf8");
const publicNetwork = readFileSync("components/network/public-network.tsx", "utf8");

assert.equal(publicServers.includes('import { formatPublicServerName } from "../../../lib/public-display-text";'), true);
assert.equal((publicServers.match(/server_name: formatPublicServerName\(row\.server_name\)/g) ?? []).length >= 3, true);
assert.equal((publicServers.match(/nitrado_service_name: formatPublicServerName\(row\.nitrado_service_name/g) ?? []).length >= 2, true);
assert.equal(publicLeaderboards.includes('import { formatPublicServerName } from "../../lib/public-display-text";'), true);
assert.equal((publicLeaderboards.match(/formatPublicServerName\(/g) ?? []).length >= 5, true);
assert.equal(publicNetwork.includes('title="Achievement Vault"'), true);
assert.equal(publicNetwork.includes('title="Earned rewards"'), true);
assert.equal(publicNetwork.includes("function uniquePublicBadges"), true);
assert.equal(publicNetwork.includes("Visual Showcase"), false);

console.log("Public server presentation tests passed.");
