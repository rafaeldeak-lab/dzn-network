import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  getAvailableFrameVisuals,
  getAvailableThemeBannerVisuals,
  getBadgeVisualConfig,
  getKnownBadgeVisualCodes,
} from "../lib/badges/visuals";

type BadgeAssetManifestEntry = {
  code: string;
  category: string;
  rarity: string;
  staticIconUrl: string;
  animatedIconUrl: string | null;
  animationType: string;
  glowColour: string;
  imageAlt: string;
};

type FrameAssetManifestEntry = {
  key: string;
  label: string;
  staticOverlayUrl: string;
  animatedOverlayUrl: string;
  animationType: string;
  glowColour: string;
};

type ThemeAssetManifestEntry = {
  key: string;
  label: string;
  backgroundUrl: string;
  animatedBackgroundUrl: string;
  palette: string[];
};

const badgeManifest = readJson<Record<string, BadgeAssetManifestEntry>>("public/badges/badge-assets.json");
const frameManifest = readJson<Record<string, FrameAssetManifestEntry>>("public/frames/frame-assets.json");
const themeManifest = readJson<Record<string, ThemeAssetManifestEntry>>("public/themes/theme-assets.json");

for (const [code, entry] of Object.entries(badgeManifest)) {
  assert.equal(entry.code, code, `Badge manifest code mismatch for ${code}.`);
  assert.equal(Boolean(entry.imageAlt), true, `${code} must include imageAlt.`);
  assertAssetExists(entry.staticIconUrl, `${code} staticIconUrl`);
  if (entry.animatedIconUrl) assertAssetExists(entry.animatedIconUrl, `${code} animatedIconUrl`);
  assertSvgHasTitle(entry.staticIconUrl, `${code} static SVG`);
  if (entry.animatedIconUrl) assertSvgHasTitle(entry.animatedIconUrl, `${code} animated SVG`);
}

for (const [key, entry] of Object.entries(frameManifest)) {
  assert.equal(entry.key, key, `Frame manifest key mismatch for ${key}.`);
  assertAssetExists(entry.staticOverlayUrl, `${key} frame staticOverlayUrl`);
  assertAssetExists(entry.animatedOverlayUrl, `${key} frame animatedOverlayUrl`);
  assertSvgHasTitle(entry.staticOverlayUrl, `${key} frame static SVG`);
  assertSvgHasTitle(entry.animatedOverlayUrl, `${key} frame animated SVG`);
}

for (const [key, entry] of Object.entries(themeManifest)) {
  assert.equal(entry.key, key, `Theme manifest key mismatch for ${key}.`);
  assertAssetExists(entry.backgroundUrl, `${key} theme backgroundUrl`);
  assertAssetExists(entry.animatedBackgroundUrl, `${key} theme animatedBackgroundUrl`);
  assertSvgHasTitle(entry.backgroundUrl, `${key} theme static SVG`);
  assertSvgHasTitle(entry.animatedBackgroundUrl, `${key} theme animated SVG`);
}

for (const code of getKnownBadgeVisualCodes()) {
  const visual = getBadgeVisualConfig(code);
  assert.equal(visual.staticIconUrl?.endsWith(".svg"), true, `${code} staticIconUrl should use SVG.`);
  assertAssetExists(visual.staticIconUrl, `${code} mapped staticIconUrl`);
  if (visual.animatedIconUrl) assertAssetExists(visual.animatedIconUrl, `${code} mapped animatedIconUrl`);
}

for (const [key, frame] of Object.entries(getAvailableFrameVisuals())) {
  assertAssetExists(frame.imageOverlayUrl, `${key} mapped frame imageOverlayUrl`);
  assertAssetExists(frame.animatedImageOverlayUrl, `${key} mapped frame animatedImageOverlayUrl`);
}

for (const [key, theme] of Object.entries(getAvailableThemeBannerVisuals())) {
  assertAssetExists(theme.backgroundUrl, `${key} mapped theme backgroundUrl`);
  assertAssetExists(theme.animatedBackgroundUrl ?? null, `${key} mapped theme animatedBackgroundUrl`);
}

const publicApiSource = readFileSync("functions/api/public/servers.ts", "utf8");
for (const field of ["badges", "profileFrame", "themeBanner", "planVisualTreatment"]) {
  assert.equal(publicApiSource.includes(field), true, `Public server API should emit ${field}.`);
}

const allVisualUrls = [
  ...Object.values(badgeManifest).flatMap((entry) => [entry.staticIconUrl, entry.animatedIconUrl]),
  ...Object.values(frameManifest).flatMap((entry) => [entry.staticOverlayUrl, entry.animatedOverlayUrl]),
  ...Object.values(themeManifest).flatMap((entry) => [entry.backgroundUrl, entry.animatedBackgroundUrl]),
].filter(Boolean);
assert.equal(allVisualUrls.some((url) => String(url).endsWith(".webp")), false, "Phase 4A assets should use SVG paths.");

console.log(`Badge asset validation passed: ${Object.keys(badgeManifest).length * 2} badge files, ${Object.keys(frameManifest).length * 2} frame files, ${Object.keys(themeManifest).length * 2} theme files.`);

function readJson<T>(filePath: string): T {
  assert.equal(existsSync(filePath), true, `${filePath} should exist.`);
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function assertAssetExists(url: string | null | undefined, label: string) {
  assert.equal(Boolean(url), true, `${label} should be configured.`);
  assert.equal(String(url).startsWith("/"), true, `${label} should be a public absolute path.`);
  const filePath = path.join("public", String(url).replace(/^\//, ""));
  assert.equal(existsSync(filePath), true, `${label} missing at ${filePath}.`);
}

function assertSvgHasTitle(url: string, label: string) {
  const filePath = path.join("public", url.replace(/^\//, ""));
  const source = readFileSync(filePath, "utf8");
  assert.equal(source.includes("<title>"), true, `${label} must include a title.`);
  assert.equal(source.includes("role=\"img\""), true, `${label} must include role="img".`);
  assert.equal(/viewBox="0 0 256 256"|viewBox="0 0 1200 420"/.test(source), true, `${label} must use the required viewBox.`);
  assert.equal(/base64|(?:href|src)=["']https?:\/\//i.test(source), false, `${label} must not embed base64 or remote URLs.`);
}
