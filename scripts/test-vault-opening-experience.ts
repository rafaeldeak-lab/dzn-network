import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";

const opening = readFileSync("components/vault/vault-opening-experience.tsx", "utf8");
const cabinet = readFileSync("components/vault/vault-cabinet.tsx", "utf8");
const styles = readFileSync("components/vault/vault-cabinet.module.css", "utf8");

assert.match(opening, /type OpeningStage = "select" \| "charging" \| "ready" \| "revealed"/, "The opening must have an explicit select, unlock, reveal lifecycle.");
assert.match(opening, /setStage\("charging"\)/, "Opening a free cache must begin with a visual unlocking state.");
assert.match(opening, /setTimeout\([\s\S]*?2600\)/, "The cache needs a paced unlock moment before final reveal.");
assert.match(opening, /await onClaim\(\)/, "The final reveal must explicitly verify the collection instead of granting it during selection.");
assert.match(opening, /setStage\("revealed"\)/, "A verified collection must finish on the reward reveal state.");
assert.match(opening, /Future edition · locked/, "Unavailable cache concepts must be visually labelled as unavailable.");
assert.doesNotMatch(opening, /\/api\/(?:checkout|store|stripe)|paymentIntent|createCheckout/i, "The welcome flow must not introduce commerce into the Vault.");
assert.match(cabinet, /onClaim=\{\(\) => mutate\("claim"\)\}/, "The existing protected welcome-claim route must remain the only grant path.");
assert.match(cabinet, /showWelcomeFlow/, "The cache journey must be shown before an unclaimed cabinet.");

assert.match(styles, /@keyframes cacheSmoke/, "Elite cache effects need a smoke animation layer.");
assert.match(styles, /@keyframes rewardParticle/, "Reward reveals need a particle animation layer.");
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/, "The opening must retain an accessible reduced-motion fallback.");
assert.doesNotMatch(styles, /rotateY\(/, "Flat card artwork must never be rotated edge-on as fake 3D.");

for (const asset of ["public/vault/caches/signal-cache-v1.png", "public/vault/caches/cinder-reliquary-v1.png", "public/vault/caches/sovereign-vault-v1.png"]) {
  assert.equal(existsSync(asset), true, `${asset} must be packaged with the opening experience.`);
  assert.ok(statSync(asset).size > 100_000, `${asset} must be a full artwork asset, not a placeholder.`);
}

console.log("DZN Vault cache-opening contract passed: staged reveal, protected claim, no commerce, no flat-card spin, motion fallback and packaged art.");
