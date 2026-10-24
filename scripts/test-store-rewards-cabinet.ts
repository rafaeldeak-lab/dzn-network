import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const rewardAssets = [
  "reputation-shield-3d.png",
  "verified-server-2d.png",
  "season-crown-3d.png",
  "player-compass-2d.png",
  "warlord-medal-3d.png",
];

for (const asset of rewardAssets) {
  assert.equal(existsSync(path.join(root, "public", "rewards", asset)), true, `Expected generated reward artwork: ${asset}`);
}

const cabinet = readFileSync(path.join(root, "components", "store", "rewards-cabinet.tsx"), "utf8");
for (const code of ["diamond", "verified_server", "death_dealer", "warlord", "king_of_dzn", "winter_champion"]) {
  assert.match(cabinet, new RegExp(`\\b${code}\\b`), `Expected live reward code: ${code}`);
}
for (const futureOnlyCode of ["community_favourite", "headhunter", "hot_streak", "team_player", "loot_master", "event_champion"]) {
  assert.equal(cabinet.includes(futureOnlyCode), false, `Future-only reward must not be presented as a live Store reward: ${futureOnlyCode}`);
}
assert.match(cabinet, /Automatic player medal tracking is not live yet\./);
assert.match(cabinet, /No paid competitive advantage/);
assert.equal(cabinet.includes("fetch("), false, "Rewards Cabinet must not initiate a Store API request or checkout.");

const storefront = readFileSync(path.join(root, "components", "store", "storefront.tsx"), "utf8");
assert.match(storefront, /import \{ RewardsCabinet \} from "@\/components\/store\/rewards-cabinet"/);
assert.match(storefront, /<RewardsCabinet \/>/);
assert.ok(storefront.indexOf("<RewardsCabinet />") < storefront.indexOf('aria-labelledby="store-products"'), "Rewards Cabinet must appear before the Store catalogue.");

const page = readFileSync(path.join(root, "app", "store", "page.tsx"), "utf8");
assert.match(page, /Reward collections, cosmetics, and fair competition/);

console.log("Store Rewards Cabinet checks passed.");
