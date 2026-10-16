import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";

import {
  initialGlobeRotationForPoints,
  shouldRefreshInitialGlobeFocus,
} from "../components/dzn/dzn-operational-globe";

const source = readFileSync("components/dzn/dzn-operational-globe.tsx", "utf8");

assert.deepEqual(initialGlobeRotationForPoints([]), { x: -0.1, y: -0.42 });

const ukRotation = initialGlobeRotationForPoints([
  { lat: 54.3, lng: -2.5, active: true },
]);
assert.equal(ukRotation.x, 0.72, "A northern active node should be brought into the initial view.");
assert.ok(ukRotation.y < -1.5 && ukRotation.y > -1.6, "The United Kingdom node should face the initial camera view.");

const activeNodeWins = initialGlobeRotationForPoints([
  { lat: 39.5, lng: -98.35, active: false },
  { lat: 54.3, lng: -2.5, active: true },
]);
assert.deepEqual(activeNodeWins, ukRotation, "The globe should prioritize an active public node when it opens.");

assert.equal(
  shouldRefreshInitialGlobeFocus("cached-node", "fresh-node", false),
  true,
  "Fresh public node data should replace a cached initial focus before the visitor interacts.",
);
assert.equal(
  shouldRefreshInitialGlobeFocus("same-node", "same-node", false),
  false,
  "A matching refresh should not restart the globe view.",
);
assert.equal(
  shouldRefreshInitialGlobeFocus("cached-node", "fresh-node", true),
  false,
  "A visitor-controlled globe view should not be overwritten by a later refresh.",
);

for (const [lat, lng] of [
  [60, 90],
  [60, -90],
  [-52, 132],
]) {
  const rotation = initialGlobeRotationForPoints([{ lat, lng, active: true }]);
  const phi = THREE.MathUtils.degToRad(90 - lat);
  const theta = THREE.MathUtils.degToRad(lng + 180);
  const point = new THREE.Vector3(
    -Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta),
  );
  const cameraRelativePoint = point.applyEuler(new THREE.Euler(rotation.x, rotation.y, 0, "XYZ"));
  assert.ok(
    cameraRelativePoint.z > 0.85,
    `The ${lat} degree latitude / ${lng} degree longitude node should face the initial camera.`,
  );
}

assert.equal(source.includes("addGlobeGrid(THREE, globeGroup);"), false,
  "The redundant 3D grid must not be layered over the textured globe.");
assert.match(source, /new THREE\.TorusGeometry\(point\.active \? 0\.046 : 0\.03/,
  "The active server marker should remain visible above the terrain texture.");
assert.match(source, /initialGlobeRotationForPoints\(globePoints\)/,
  "The live renderer must apply the initial public-node focus.");
assert.match(source, /shouldRefreshInitialGlobeFocus\(initialFocusKeyRef\.current, focusKey, hasUserAdjustedViewRef\.current\)/,
  "The live renderer must permit fresh server data to replace a cached initial focus.");
assert.match(source, /movementFromOrigin > 2/,
  "Slow pointer movement must accumulate from the drag origin before a refresh can replace the view.");
assert.match(source, /dzn-operational-globe-node-status/,
  "An active public node should have a persistent, non-hover visual label.");
assert.match(source, /featuredNode\.region/,
  "The persistent label must use the aggregate public location label rather than precise coordinates.");

console.log("Operational globe visual and focus contracts passed.");
