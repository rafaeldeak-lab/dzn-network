import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { VAULT_CATALOG } from "../lib/vault";

const art = readFileSync("components/vault/collectible-art.tsx", "utf8");
const sceneItems = VAULT_CATALOG.filter((item) => item.kind === "scene");

assert.ok(sceneItems.length > 0, "The Vault catalogue must include its curated scene collection.");
assert.ok(art.includes('const directArtwork = item.artUrl?.match(/^\\/(?:vault|store\\/cards)\\//) ? item.artUrl : null;'), "Only packaged Vault or Store artwork may be used as a collectible image.");
assert.match(art, /backgroundSize: item\.kind === "scene" \? "cover" : "contain"/, "Scenes must fill their collectible frame with their authored artwork.");
assert.doesNotMatch(art, /sceneDoor|sceneFloor|DZN VAULT/, "Vault scenes must not fall back to the old CSS doorway placeholder.");
assert.match(art, /item\.kind === "scene" && motion/, "Scene movement must respect the cabinet's Effects control and reduced-motion preference.");
assert.match(art, /styles\.scenePortalMotion/, "Scene artwork must have a dedicated, clipped portal motion layer rather than rotating the whole 2D card.");

const styles = readFileSync("components/vault/vault-cabinet.module.css", "utf8");
assert.match(styles, /\.scenePortalMotion\s*\{[\s\S]*clip-path:\s*ellipse/, "Portal movement must remain clipped inside the galaxy feature of the artwork.");
assert.match(styles, /\.sceneGalaxySpin\s*\{[\s\S]*nebula-chamber-v1\.png[\s\S]*animation:\s*vaultGalaxySpin/, "The Nebula artwork must provide a real galaxy-motion layer.");
assert.match(styles, /@keyframes vaultGalaxySpin/, "The galaxy motion must have its own bounded animation.");
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/, "Vault animation must honor reduced-motion preferences.");

for (const scene of sceneItems) {
  assert.match(scene.artUrl ?? "", /^\/vault\/scenes\/[a-z0-9-]+-v\d+\.png$/, `${scene.name} must have a versioned packaged scene image.`);
  const file = `public${scene.artUrl}`;
  assert.equal(existsSync(file), true, `${scene.name} artwork must be included in the production build.`);
  assert.ok(statSync(file).size > 100_000, `${scene.name} artwork must be a finished image, not a placeholder.`);
}

console.log("DZN Vault scene artwork contract passed: every scene uses packaged original artwork with no CSS placeholder fallback.");
