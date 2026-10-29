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
  assert.match(cabinet, new RegExp(`\\b${futureOnlyCode}\\b`), `Expected future reward blueprint: ${futureOnlyCode}`);
}
assert.match(cabinet, /Future award blueprints/);
assert.match(cabinet, /cannot be earned, bought, or assigned today/);
assert.match(cabinet, /No paid competitive advantage/);
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

const lockerPreview = readFileSync(path.join(root, "components", "store", "locker-preview.tsx"), "utf8");
const lockerArtwork = path.join(root, "public", "store", "catalogue", "rewards-locker-preview-v1.webp");
assert.equal(existsSync(lockerArtwork), true, "The Store locker preview artwork should exist.");
assert.equal(statSync(lockerArtwork).size < 300_000, true, "The Store locker preview artwork should remain web-friendly.");
assert.match(lockerPreview, /Wildcard calling cards/);
assert.match(lockerPreview, /Profile frame collection/);
assert.match(lockerPreview, /Identity loadout previews/);
assert.match(lockerPreview, /Server showcase treatments/);
assert.match(lockerPreview, /Badge vault previews/);
assert.match(lockerPreview, /3D badge/);
assert.match(lockerPreview, /Preview only · no payment/);
assert.match(lockerPreview, /rewards-locker-preview-v1\.webp/);
assert.match(lockerPreview, /role="tablist"/);
assert.match(lockerPreview, /role="tabpanel"/);
assert.equal(lockerPreview.includes("fetch("), false, "The visual Store preview must not start checkout, grants, or Store API activity.");

for (const assetName of ["night-watch-v1.webp", "storm-relay-v1.webp", "outpost-gold-v1.webp", "last-signal-v1.webp"]) {
  const assetPath = path.join(root, "public", "store", "catalogue", "wildcards", assetName);
  assert.equal(existsSync(assetPath), true, `The ${assetName} Wildcard artwork should exist.`);
  assert.equal(statSync(assetPath).size < 250_000, true, `The ${assetName} Wildcard artwork should remain web-friendly.`);
  const metadata = await sharp(assetPath).metadata();
  assert.equal(metadata.width, 1280, `${assetName} should use the intended calling-card width.`);
  assert.equal(metadata.height, 720, `${assetName} should use the intended calling-card height.`);
}

for (const assetName of ["apex-reputation-v1.webp", "warlord-v1.webp", "season-crown-v1.webp", "community-signal-v1.webp"]) {
  const assetPath = path.join(root, "public", "store", "catalogue", "badges", assetName);
  assert.equal(existsSync(assetPath), true, `The ${assetName} 3D badge artwork should exist.`);
  assert.equal(statSync(assetPath).size < 250_000, true, `The ${assetName} 3D badge artwork should remain web-friendly.`);
  const { data, info } = await sharp(assetPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(data[(info.width - 1) * 4 + 3], 0, `${assetName} should retain a transparent badge edge.`);
}

const page = readFileSync(path.join(root, "app", "store", "page.tsx"), "utf8");
assert.match(page, /Reward collections, cosmetics, and fair competition/);

console.log("Store Rewards Cabinet checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
