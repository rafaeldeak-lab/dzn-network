import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const root = process.cwd();
const componentSource = readFileSync(path.join(root, "components/dzn/dzn-landing-page.tsx"), "utf8");
const globalCss = readFileSync(path.join(root, "app/globals.css"), "utf8");
const packageJson = readFileSync(path.join(root, "package.json"), "utf8");
const assetDir = path.join(root, "public/media/homepage-ui");

const requiredAssets = [
  "master-site-background.webp",
  "game-modes-section-background.webp",
  "live-intelligence-section.webp",
  "game-mode-pvp-card.webp",
  "game-mode-deathmatch-card.webp",
  "game-mode-pve-card.webp",
  "game-mode-hybrid-card.webp",
  "stat-players-online.webp",
  "stat-servers-linked.webp",
  "stat-kills.webp",
  "stat-longest-kill.webp",
  "pulse-active-servers.webp",
  "pulse-events-tracked.webp",
  "pulse-top-server.webp",
  "pulse-current-event.webp",
  "icon-pvp.webp",
  "icon-deathmatch.webp",
  "icon-pve.webp",
  "icon-hybrid.webp",
  "icon-players.webp",
  "icon-servers.webp",
  "icon-crosshair.webp",
  "icon-trophy.webp",
  "icon-wifi.webp",
  "icon-events.webp",
  "icon-timer.webp",
  "icon-crown.webp",
];

for (const asset of requiredAssets) {
  const file = path.join(assetDir, asset);
  assert(existsSync(file), `Missing homepage ambient asset: ${asset}`);
  assert(statSync(file).size > 500, `Homepage ambient asset appears empty or truncated: ${asset}`);
}

const componentRequirements = [
  "HOMEPAGE_AMBIENT_ASSETS",
  "HOME_AMBIENT_ICONS",
  "HOMEPAGE_AMBIENT_ASSET_PATHS",
  "preloadHomepageAmbientAssets",
  'HOMEPAGE_UI_ASSET_BASE = "/media/homepage-ui"',
  "master-site-background.webp",
  "dzn-home-floating-icon",
  "--dzn-home-bg",
  "--dzn-section-skin",
  "--mode-skin",
  "--mode-icon",
  "--stat-skin",
  "--stat-icon",
  "--pulse-skin",
  "--pulse-icon",
  "DZN HOMEPAGE AMBIENT UI ASSETS LOADED",
];

for (const marker of componentRequirements) {
  assert(componentSource.includes(marker), `Homepage ambient wiring marker missing: ${marker}`);
}

const cssRequirements = [
  "dzn-home-haze::before",
  "dzn-home-haze::after",
  "dzn-home-floating-icon",
  "dznHomeLightningFlicker",
  "dznHomeEmberGlow",
  "dznHomeAmbientIconFloat",
  "dznHomeCardSkinDrift",
  "dznHomeIconOrbitFloat",
  "var(--mode-skin, none)",
  "var(--mode-icon, none)",
  "var(--stat-skin, none)",
  "var(--stat-icon, none)",
  "var(--pulse-skin, none)",
  "var(--pulse-icon, none)",
];

for (const marker of cssRequirements) {
  assert(globalCss.includes(marker), `Homepage ambient CSS marker missing: ${marker}`);
}

const reducedMotionStart = globalCss.indexOf(
  ".dzn-logo-sparkle,",
  globalCss.indexOf("@media (prefers-reduced-motion: reduce)", globalCss.indexOf("@keyframes dznHomeBgDrift")),
);
assert(reducedMotionStart >= 0, "Reduced-motion homepage guard block was not found");
const reducedMotionBlock = globalCss.slice(reducedMotionStart, reducedMotionStart + 2600);
const reducedMotionRequirements = [
  ".dzn-home-haze::before",
  ".dzn-home-haze::after",
  ".dzn-home-floating-icon",
  ".dzn-game-modes-section::after",
  ".dzn-game-mode-icon::before",
  ".dzn-stat-icon::before",
  ".dzn-network-pulse::after",
  ".dzn-pulse-icon::before",
];

for (const marker of reducedMotionRequirements) {
  assert(reducedMotionBlock.includes(marker), `Reduced-motion guard missing: ${marker}`);
}

const forbiddenRuntimeMarkers = [
  "checkout.sessions.create",
  "DZN_LIVE_CHECKOUT_ENABLED=true",
  "store_orders",
  "supporter_cards",
  "earned_spins",
  "spin_ledger",
  "new WebSocket",
  "new DurableObject",
  "navigator.sendBeacon",
  "trackEvent(",
];

for (const marker of forbiddenRuntimeMarkers) {
  assert(!componentSource.includes(marker), `Homepage visual slice must not introduce runtime marker: ${marker}`);
}

assert(
  packageJson.includes('"test:homepage-ambient-assets"'),
  "package.json must expose test:homepage-ambient-assets",
);

console.log("Homepage ambient asset wiring checks passed.");
