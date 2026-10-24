import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const rewardArtwork = [
  "reputation-shield-3d",
  "verified-server-2d",
  "season-crown-3d",
  "player-compass-2d",
  "warlord-medal-3d",
];

for (const asset of rewardArtwork) {
  const icon = path.join(root, "public", "rewards", "icons", `${asset}.webp`);
  const cabinet = path.join(root, "public", "rewards", "cabinet", `${asset}.webp`);
  assert.equal(existsSync(icon), true, `Expected optimized icon artwork: ${asset}`);
  assert.equal(existsSync(cabinet), true, `Expected optimized cabinet artwork: ${asset}`);
  assert.equal(statSync(icon).size < 20_000, true, `Badge icon should remain compact: ${asset}`);
  assert.equal(statSync(cabinet).size < 100_000, true, `Cabinet artwork should remain compact: ${asset}`);
  assert.equal(existsSync(path.join(root, "public", "rewards", `${asset}.png`)), false, `Unoptimized source PNG must not ship: ${asset}`);
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
assert.match(cabinet, /\/rewards\/cabinet\/.*\.webp/);
assert.equal(cabinet.includes("/rewards/") && cabinet.includes(".png"), false, "Rewards Cabinet must not reference unoptimized PNG artwork.");
assert.equal(cabinet.includes("fetch("), false, "Rewards Cabinet must not initiate a Store API request or checkout.");

const storefront = readFileSync(path.join(root, "components", "store", "storefront.tsx"), "utf8");
assert.match(storefront, /import \{ RewardsCabinet \} from "@\/components\/store\/rewards-cabinet"/);
assert.match(storefront, /<RewardsCabinet \/>/);
assert.ok(storefront.indexOf("<RewardsCabinet />") < storefront.indexOf('aria-labelledby="store-products"'), "Rewards Cabinet must appear before the Store catalogue.");

const page = readFileSync(path.join(root, "app", "store", "page.tsx"), "utf8");
assert.match(page, /Reward collections, cosmetics, and fair competition/);

console.log("Store Rewards Cabinet checks passed.");
