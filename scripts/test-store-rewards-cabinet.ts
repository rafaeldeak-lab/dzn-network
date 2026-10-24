import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { getBadgeVisualConfig } from "../lib/badges/visuals";

const root = process.cwd();
const cabinetDecoration = path.join(root, "public", "rewards", "cabinet", "player-compass-2d.webp");
assert.equal(existsSync(cabinetDecoration), true, "The Store cabinet decoration should exist.");
assert.equal(statSync(cabinetDecoration).size < 100_000, true, "The Store cabinet decoration should remain compact.");
assert.equal(existsSync(path.join(root, "public", "rewards", "player-compass-2d.png")), false, "An unoptimized source PNG must not ship.");

const cabinet = readFileSync(path.join(root, "components", "store", "rewards-cabinet.tsx"), "utf8");
for (const code of ["bronze", "silver", "gold", "platinum", "diamond", "legendary", "verified_server", "active_server", "death_dealer", "long_shot_legend", "warlord", "trusted_server", "veteran", "legacy_server", "king_of_dzn", "winter_champion"]) {
  assert.match(cabinet, new RegExp(`\\b${code}\\b`), `Expected live reward code: ${code}`);
  const visual = getBadgeVisualConfig(code);
  assert.equal(visual.staticIconUrl?.startsWith("/rewards/icons/"), true, `${code} should use the shared reward artwork library.`);
  assert.equal(existsSync(path.join(root, "public", visual.staticIconUrl!.replace(/^\//, ""))), true, `${code} artwork should exist.`);
}
for (const futureOnlyCode of ["community_favourite", "headhunter", "hot_streak", "team_player", "loot_master", "event_champion"]) {
  assert.equal(cabinet.includes(futureOnlyCode), false, `Future-only reward must not be presented as a live Store reward: ${futureOnlyCode}`);
}
assert.match(cabinet, /Automatic player medal tracking is not live yet\./);
assert.match(cabinet, /No paid competitive advantage/);
assert.match(cabinet, /src=\{badge\.staticIconUrl\}/);
assert.equal(cabinet.includes("ARTWORK_BY_CODE"), false, "The Store must not maintain a stale duplicate reward artwork map.");
assert.equal(cabinet.includes("/rewards/") && cabinet.includes(".png"), false, "Rewards Cabinet must not reference unoptimized PNG artwork.");
assert.equal(cabinet.includes("fetch("), false, "Rewards Cabinet must not initiate a Store API request or checkout.");

const storefront = readFileSync(path.join(root, "components", "store", "storefront.tsx"), "utf8");
assert.match(storefront, /import \{ RewardsCabinet \} from "@\/components\/store\/rewards-cabinet"/);
assert.match(storefront, /<RewardsCabinet \/>/);
assert.ok(storefront.indexOf("<RewardsCabinet />") < storefront.indexOf('aria-labelledby="store-products"'), "Rewards Cabinet must appear before the Store catalogue.");

const page = readFileSync(path.join(root, "app", "store", "page.tsx"), "utf8");
assert.match(page, /Reward collections, cosmetics, and fair competition/);

console.log("Store Rewards Cabinet checks passed.");
