import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

import { getBadgeCabinetArtworkUrl, getBadgeVisualConfig } from "../lib/badges/visuals";

async function main() {
const root = process.cwd();
const cabinetDecoration = path.join(root, "public", "rewards", "cabinet", "player-compass-2d.webp");
assert.equal(existsSync(cabinetDecoration), true, "The Store cabinet decoration should exist.");
assert.equal(statSync(cabinetDecoration).size < 100_000, true, "The Store cabinet decoration should remain compact.");
assert.equal(existsSync(path.join(root, "public", "rewards", "player-compass-2d.png")), false, "An unoptimized source PNG must not ship.");

const cabinet = readFileSync(path.join(root, "components", "store", "rewards-cabinet.tsx"), "utf8");
const globalStyles = readFileSync(path.join(root, "app", "globals.css"), "utf8");
const liveCabinetAssets = new Set<string>();
for (const code of ["bronze", "silver", "gold", "platinum", "diamond", "legendary", "verified_server", "active_server", "death_dealer", "long_shot_legend", "warlord", "trusted_server", "veteran", "legacy_server", "king_of_dzn", "winter_champion"]) {
  assert.match(cabinet, new RegExp(`\\b${code}\\b`), `Expected live reward code: ${code}`);
  const visual = getBadgeVisualConfig(code);
  assert.equal(visual.staticIconUrl?.startsWith("/rewards/icons/compact/"), true, `${code} should use the shared reward artwork library.`);
  assert.equal(existsSync(path.join(root, "public", visual.staticIconUrl!.replace(/^\//, ""))), true, `${code} artwork should exist.`);
  const cabinetArtwork = getBadgeCabinetArtworkUrl(code);
  assert.equal(cabinetArtwork?.startsWith("/rewards/cabinet/"), true, `${code} should use a larger Store cabinet artwork variant.`);
  assert.equal(existsSync(path.join(root, "public", cabinetArtwork!.replace(/^\//, ""))), true, `${code} cabinet artwork should exist.`);
  liveCabinetAssets.add(cabinetArtwork!);
}
for (const assetUrl of liveCabinetAssets) {
  const { data, info } = await sharp(path.join(root, "public", assetUrl.replace(/^\//, ""))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (const [x, y] of [[0, 0], [info.width - 1, 0], [0, info.height - 1], [info.width - 1, info.height - 1]]) {
    assert.equal(data[(y * info.width + x) * 4 + 3], 0, `${assetUrl} must retain a transparent cabinet background.`);
  }
}
for (const futureOnlyCode of ["community_favourite", "headhunter", "hot_streak", "team_player", "loot_master", "event_champion"]) {
  assert.equal(cabinet.includes(futureOnlyCode), false, `Future-only reward must not be presented as a live Store reward: ${futureOnlyCode}`);
}
assert.match(cabinet, /Automatic player medal tracking is not live yet\./);
assert.match(cabinet, /No paid competitive advantage/);
assert.match(cabinet, /player-compass-cutout-2d\.webp/);
assert.match(cabinet, /src=\{cabinetArtwork\}/);
assert.match(cabinet, /dzn-reward-card__art/);
assert.match(cabinet, /dzn-reward-card__copy/);
assert.match(cabinet, /dzn-reward-card__requirement/);
assert.match(cabinet, /loading="lazy"/);
assert.equal(cabinet.includes("ARTWORK_BY_CODE"), false, "The Store must not maintain a stale duplicate reward artwork map.");
assert.equal(cabinet.includes("/rewards/") && cabinet.includes(".png"), false, "Rewards Cabinet must not reference unoptimized PNG artwork.");
assert.equal(cabinet.includes("fetch("), false, "Rewards Cabinet must not initiate a Store API request or checkout.");
assert.match(globalStyles, /\.dzn-reward-card__art/);
assert.match(globalStyles, /@keyframes dznRewardCabinetTurn/);
assert.match(globalStyles, /rotateY\(360deg\)/);
assert.match(globalStyles, /prefers-reduced-motion: no-preference/);
assert.match(globalStyles, /prefers-reduced-motion: reduce/);

const storefront = readFileSync(path.join(root, "components", "store", "storefront.tsx"), "utf8");
assert.match(storefront, /import \{ RewardsCabinet \} from "@\/components\/store\/rewards-cabinet"/);
assert.match(storefront, /<RewardsCabinet \/>/);
assert.ok(storefront.indexOf("<RewardsCabinet />") < storefront.indexOf('aria-labelledby="store-products"'), "Rewards Cabinet must appear before the Store catalogue.");

const page = readFileSync(path.join(root, "app", "store", "page.tsx"), "utf8");
assert.match(page, /Reward collections, cosmetics, and fair competition/);

console.log("Store Rewards Cabinet checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
