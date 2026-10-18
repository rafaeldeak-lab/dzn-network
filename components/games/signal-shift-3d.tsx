"use client";

import { useEffect, useRef } from "react";
import * as ThreeModule from "three";
import type { SignalShiftIntensity } from "@/lib/games-signal-shift";

// Three's recursive declaration graph can exceed the TypeScript checker stack in this client bundle.
/* eslint-disable @typescript-eslint/no-explicit-any */
const THREE: any = ThreeModule;

type SignalShift3DProps = {
  tiles: number[];
  gridSize: number;
  intensity: SignalShiftIntensity;
  active: boolean;
  disabled: boolean;
  motionRunning: boolean;
  movableTiles: number[];
  onMove: (tile: number) => void;
  onUnavailable: () => void;
};

const INTENSITY_COLORS: Record<SignalShiftIntensity, { primary: number; alert: number }> = {
  calibration: { primary: 0x59e6ff, alert: 0x9f75ff },
  pressure: { primary: 0xffcc69, alert: 0xff6d82 },
  blackout: { primary: 0xff84bc, alert: 0xb16fff },
};

function labelTexture(label: string, color: string, caption = "SECTOR") {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = `${color}cc`;
  context.lineWidth = 5;
  context.strokeRect(17, 17, 222, 222);
  context.strokeStyle = `${color}66`;
  context.lineWidth = 2;
  context.strokeRect(30, 30, 196, 196);
  context.fillStyle = `${color}cc`;
  context.textAlign = "center";
  context.font = "700 24px monospace";
  context.fillText(caption, 128, 78);
  context.font = "800 92px monospace";
  context.fillStyle = "#edfaff";
  context.fillText(label, 128, 166);
  context.fillStyle = `${color}dd`;
  context.font = "700 18px monospace";
  context.fillText("DZN RELAY", 128, 208);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function SignalShift3D({ tiles, gridSize, intensity, active, disabled, motionRunning, movableTiles, onMove, onUnavailable }: SignalShift3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const moveRef = useRef(onMove);
  const disabledRef = useRef(disabled);
  const unavailableRef = useRef(onUnavailable);

  useEffect(() => { moveRef.current = onMove; }, [onMove]);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);
  useEffect(() => { unavailableRef.current = onUnavailable; }, [onUnavailable]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    if (typeof WebGLRenderingContext === "undefined") {
      unavailableRef.current();
      return;
    }

    const palette = INTENSITY_COLORS[intensity];
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070914);
    scene.fog = new THREE.FogExp2(0x070914, 0.044);
    const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 100);
    camera.position.set(6.2, 6.8, 8.1);
    camera.lookAt(0, 0.38, 0);
    let renderer: any;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: true });
    } catch {
      unavailableRef.current();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.55;
    renderer.domElement.dataset.dznSignalShiftCanvas = "true";
    renderer.domElement.dataset.dznSignalShiftIntensity = intensity;
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);

    const geometries: any[] = [];
    const materials: any[] = [];
    const textures: any[] = [];
    const dispose = () => {
      geometries.forEach(item => item.dispose());
      materials.forEach(item => item.dispose());
      textures.forEach(item => item.dispose());
      renderer.dispose();
    };

    scene.add(new THREE.HemisphereLight(0xc8edff, 0x090713, 2.65));
    const keyLight = new THREE.DirectionalLight(0x91e7ff, 4.2);
    keyLight.position.set(-4, 9, 5);
    scene.add(keyLight);
    const primaryLight = new THREE.PointLight(palette.primary, 26, 17, 1.8);
    primaryLight.position.set(-4.6, 3.3, 2.2);
    scene.add(primaryLight);
    const alertLight = new THREE.PointLight(palette.alert, 21, 19, 1.7);
    alertLight.position.set(4.2, 2.6, -3.6);
    scene.add(alertLight);

    const chamber = new THREE.Group();
    chamber.rotation.y = -0.08;
    scene.add(chamber);

    const floorGeometry = new THREE.CylinderGeometry(4.78, 5.08, 0.4, 12);
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x101a32, emissive: 0x0a1732, emissiveIntensity: 1.12, metalness: 0.72, roughness: 0.38 });
    geometries.push(floorGeometry); materials.push(floorMaterial);
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.position.y = -0.45;
    chamber.add(floor);
    const rimGeometry = new THREE.TorusGeometry(4.45, 0.055, 8, 72);
    const rimMaterial = new THREE.MeshBasicMaterial({ color: palette.primary, transparent: true, opacity: 0.78 });
    geometries.push(rimGeometry); materials.push(rimMaterial);
    const rim = new THREE.Mesh(rimGeometry, rimMaterial);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -0.22;
    chamber.add(rim);

    const gridGroup = new THREE.Group();
    const tileGeometry = new THREE.BoxGeometry(1.12, 0.34, 1.12);
    const topGeometry = new THREE.PlaneGeometry(0.84, 0.84);
    const edgeGeometry = new THREE.EdgesGeometry(tileGeometry);
    const clampGeometry = new THREE.BoxGeometry(0.14, 0.05, 0.14);
    const coreGeometry = new THREE.CylinderGeometry(0.14, 0.14, 0.08, 12);
    const emptyCoreGeometry = new THREE.CylinderGeometry(0.22, 0.3, 0.62, 16);
    const emptyCoreRingGeometry = new THREE.TorusGeometry(0.31, 0.026, 6, 32);
    geometries.push(tileGeometry, topGeometry, edgeGeometry, clampGeometry, coreGeometry, emptyCoreGeometry, emptyCoreRingGeometry);
    const hitboxes: any[] = [];
    const glowRings: any[] = [];
    const moduleCores: any[] = [];
    const coreRings: any[] = [];
    const activeModules: any[] = [];
    const half = (gridSize - 1) / 2;
    for (let index = 0; index < tiles.length; index++) {
      const tile = tiles[index];
      const row = Math.floor(index / gridSize);
      const column = index % gridSize;
      const x = (column - half) * 1.23;
      const z = (row - half) * 1.23;
      const movable = active && tile !== 0 && movableTiles.includes(tile);
      const group = new THREE.Group();
      group.position.set(x, tile === 0 ? -0.05 : 0, z);
      const baseMaterial = new THREE.MeshStandardMaterial({
        color: tile === 0 ? 0x0b2635 : movable ? palette.primary : 0x263358,
        emissive: tile === 0 ? palette.primary : movable ? palette.primary : 0x112455,
        emissiveIntensity: tile === 0 ? 1.45 : movable ? 1.02 : 0.62,
        metalness: 0.75,
        roughness: 0.28,
      });
      materials.push(baseMaterial);
      const base = new THREE.Mesh(tileGeometry, baseMaterial);
      group.add(base);
      const edgeMaterial = new THREE.LineBasicMaterial({ color: tile === 0 ? palette.primary : movable ? palette.primary : 0x41557f, transparent: true, opacity: movable ? 0.96 : 0.56 });
      materials.push(edgeMaterial);
      const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
      group.add(edges);
      if (tile === 0) {
        const coreMaterial = new THREE.MeshStandardMaterial({ color: palette.primary, emissive: palette.primary, emissiveIntensity: 2.15, transparent: true, opacity: 0.88, metalness: 0.22, roughness: 0.14 });
        const ringMaterial = new THREE.MeshBasicMaterial({ color: palette.primary, transparent: true, opacity: 0.88, side: THREE.DoubleSide, depthWrite: false });
        materials.push(coreMaterial, ringMaterial);
        const core = new THREE.Mesh(emptyCoreGeometry, coreMaterial);
        core.position.y = 0.24;
        const ring = new THREE.Mesh(emptyCoreRingGeometry, ringMaterial);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.3;
        group.add(core, ring);
        moduleCores.push(core); coreRings.push(ring); glowRings.push(ring);
      } else {
        const clampMaterial = new THREE.MeshStandardMaterial({ color: 0x627298, emissive: movable ? palette.primary : 0x162344, emissiveIntensity: movable ? 0.75 : 0.3, metalness: 0.82, roughness: 0.31 });
        const coreMaterial = new THREE.MeshStandardMaterial({ color: movable ? 0xd7fff8 : 0x7195d4, emissive: movable ? palette.primary : 0x254a9d, emissiveIntensity: movable ? 1.8 : 0.86, metalness: 0.64, roughness: 0.18 });
        materials.push(clampMaterial, coreMaterial);
        for (const [cornerX, cornerZ] of [[-0.43, -0.43], [0.43, -0.43], [-0.43, 0.43], [0.43, 0.43]]) {
          const clamp = new THREE.Mesh(clampGeometry, clampMaterial);
          clamp.position.set(cornerX, 0.19, cornerZ);
          group.add(clamp);
        }
        const core = new THREE.Mesh(coreGeometry, coreMaterial);
        core.position.y = 0.205;
        group.add(core);
        moduleCores.push(core);
        if (movable) activeModules.push(group);
        const texture = labelTexture(String(tile).padStart(2, "0"), movable ? "#b7fff2" : "#91b8ff");
        textures.push(texture);
        const labelMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: movable ? 1 : 0.87, depthWrite: false });
        materials.push(labelMaterial);
        const label = new THREE.Mesh(topGeometry, labelMaterial);
        label.rotation.x = -Math.PI / 2;
        label.position.y = 0.215;
        group.add(label);
      }
      const hitboxGeometry = new THREE.BoxGeometry(1.25, 0.76, 1.25);
      const hitboxMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
      geometries.push(hitboxGeometry); materials.push(hitboxMaterial);
      const hitbox = new THREE.Mesh(hitboxGeometry, hitboxMaterial);
      hitbox.position.y = 0.22;
      hitbox.userData = { tile, movable, group };
      group.add(hitbox);
      hitboxes.push(hitbox);
      gridGroup.add(group);
    }
    chamber.add(gridGroup);

    const traceGeometry = new THREE.BufferGeometry();
    const tracePoints: number[] = [];
    for (let index = 0; index < tiles.length; index++) {
      const tile = tiles[index];
      if (!tile || tile === 15) continue;
      const next = tiles.indexOf(tile + 1);
      if (next < 0) continue;
      const row = Math.floor(index / gridSize); const column = index % gridSize;
      const nextRow = Math.floor(next / gridSize); const nextColumn = next % gridSize;
      if (Math.abs(row - nextRow) + Math.abs(column - nextColumn) !== 1) continue;
      tracePoints.push((column - half) * 1.23, 0.25, (row - half) * 1.23, (nextColumn - half) * 1.23, 0.25, (nextRow - half) * 1.23);
    }
    traceGeometry.setAttribute("position", new THREE.Float32BufferAttribute(tracePoints, 3));
    const traceMaterial = new THREE.LineBasicMaterial({ color: palette.primary, transparent: true, opacity: 0.78 });
    geometries.push(traceGeometry); materials.push(traceMaterial);
    chamber.add(new THREE.LineSegments(traceGeometry, traceMaterial));

    const beaconGeometry = new THREE.CylinderGeometry(0.13, 0.22, 1.5, 8);
    const beaconBaseGeometry = new THREE.CylinderGeometry(0.32, 0.38, 0.18, 10);
    const beaconRingGeometry = new THREE.TorusGeometry(0.22, 0.025, 6, 24);
    const beaconMaterial = new THREE.MeshStandardMaterial({ color: palette.primary, emissive: palette.primary, emissiveIntensity: 1.8, metalness: 0.66, roughness: 0.24 });
    const beaconBaseMaterial = new THREE.MeshStandardMaterial({ color: 0x22345a, emissive: 0x0b1d43, emissiveIntensity: 0.7, metalness: 0.78, roughness: 0.3 });
    const beaconRingMaterial = new THREE.MeshBasicMaterial({ color: palette.alert, transparent: true, opacity: 0.82, depthWrite: false });
    geometries.push(beaconGeometry, beaconBaseGeometry, beaconRingGeometry); materials.push(beaconMaterial, beaconBaseMaterial, beaconRingMaterial);
    const beacons: any[] = [];
    const beaconRings: any[] = [];
    for (const [index, position] of [[-3.92, -3.92], [3.92, -3.92], [3.92, 3.92], [-3.92, 3.92]].entries()) {
      const base = new THREE.Mesh(beaconBaseGeometry, beaconBaseMaterial);
      base.position.set(position[0], -0.13, position[1]);
      const beacon = new THREE.Mesh(beaconGeometry, beaconMaterial);
      beacon.position.set(position[0], 0.32, position[1]);
      beacon.rotation.y = index * Math.PI / 4;
      const ring = new THREE.Mesh(beaconRingGeometry, beaconRingMaterial);
      ring.position.set(position[0], 0.88, position[1]);
      ring.rotation.x = Math.PI / 2;
      chamber.add(base, beacon, ring);
      const glow = new THREE.PointLight(index % 2 ? palette.alert : palette.primary, 3.2, 5.5, 2);
      glow.position.set(position[0], 0.85, position[1]);
      chamber.add(glow);
      beacons.push(beacon); beaconRings.push(ring);
    }

    const gantryGeometry = new THREE.BoxGeometry(0.22, 1.75, 0.22);
    const gantryBraceGeometry = new THREE.BoxGeometry(1.42, 0.08, 0.12);
    const gantryMaterial = new THREE.MeshStandardMaterial({ color: 0x273153, emissive: 0x0d1733, emissiveIntensity: 0.68, metalness: 0.8, roughness: 0.32 });
    geometries.push(gantryGeometry, gantryBraceGeometry); materials.push(gantryMaterial);
    for (const [x, z, rotation] of [[0, -4.35, 0], [4.35, 0, Math.PI / 2], [0, 4.35, 0], [-4.35, 0, Math.PI / 2]] as const) {
      const gantry = new THREE.Group();
      const left = new THREE.Mesh(gantryGeometry, gantryMaterial);
      const right = new THREE.Mesh(gantryGeometry, gantryMaterial);
      const brace = new THREE.Mesh(gantryBraceGeometry, gantryMaterial);
      left.position.x = -0.74; right.position.x = 0.74; brace.position.y = 0.76;
      gantry.add(left, right, brace); gantry.position.set(x, 0.25, z); gantry.rotation.y = rotation;
      chamber.add(gantry);
    }

    const particleGeometry = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(270);
    for (let index = 0; index < particlePositions.length; index += 3) {
      const sample = index / 3;
      particlePositions[index] = ((sample * 31) % 21) * 0.5 - 5;
      particlePositions[index + 1] = 0.35 + ((sample * 13) % 26) * 0.11;
      particlePositions[index + 2] = ((sample * 19) % 21) * 0.5 - 5;
    }
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
    const particleMaterial = new THREE.PointsMaterial({ color: palette.primary, size: 0.035, transparent: true, opacity: 0.54, depthWrite: false });
    geometries.push(particleGeometry); materials.push(particleMaterial);
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particles);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hovered: any = null;
    let pointerX = 0;
    let pointerY = 0;
    let pointerDown: { id: number; tile: number; x: number; y: number; moved: boolean } | null = null;
    let frame = 0;
    const setPointer = (event: PointerEvent) => {
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
      pointerX = pointer.x;
      pointerY = pointer.y;
      raycaster.setFromCamera(pointer, camera);
    };
    const hitTile = (event: PointerEvent) => {
      setPointer(event);
      return raycaster.intersectObjects(hitboxes, false)[0]?.object as any;
    };
    const onPointerMove = (event: PointerEvent) => {
      if (pointerDown && pointerDown.id === event.pointerId && Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 8) pointerDown.moved = true;
      const next = hitTile(event) ?? null;
      if (hovered !== next) {
        if (hovered?.userData.group) hovered.userData.group.scale.setScalar(1);
        hovered = next;
        if (hovered?.userData.movable) hovered.userData.group.scale.setScalar(1.08);
      }
      renderer.domElement.style.cursor = hovered?.userData.movable && !disabledRef.current ? "pointer" : "default";
    };
    const onPointerLeave = () => {
      if (hovered?.userData.group) hovered.userData.group.scale.setScalar(1);
      hovered = null;
      renderer.domElement.style.cursor = "default";
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || disabledRef.current) { pointerDown = null; return; }
      const hit = hitTile(event);
      pointerDown = hit?.userData.movable ? { id: event.pointerId, tile: hit.userData.tile, x: event.clientX, y: event.clientY, moved: false } : null;
      if (pointerDown && renderer.domElement.setPointerCapture) renderer.domElement.setPointerCapture(event.pointerId);
    };
    const onPointerUp = (event: PointerEvent) => {
      const started = pointerDown;
      pointerDown = null;
      if (event.button !== 0 || disabledRef.current || !started || started.id !== event.pointerId || started.moved) return;
      const hit = hitTile(event);
      if (hit?.userData.movable && hit.userData.tile === started.tile) moveRef.current(hit.userData.tile);
    };
    const onPointerCancel = () => { pointerDown = null; };
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerCancel);

    const resize = new ResizeObserver(entries => {
      const width = Math.max(1, entries[0]?.contentRect.width ?? mount.clientWidth);
      const height = Math.max(1, entries[0]?.contentRect.height ?? mount.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    });
    resize.observe(mount);
    if (!motionRunning) {
      renderer.render(scene, camera);
      return () => {
        resize.disconnect();
        renderer.domElement.removeEventListener("pointermove", onPointerMove);
        renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
        renderer.domElement.removeEventListener("pointerdown", onPointerDown);
        renderer.domElement.removeEventListener("pointerup", onPointerUp);
        renderer.domElement.removeEventListener("pointercancel", onPointerCancel);
        mount.removeChild(renderer.domElement);
        dispose();
      };
    }
    const startedAt = performance.now();
    const render = (time: number) => {
      const elapsed = (time - startedAt) / 1_000;
      chamber.rotation.y += ((-0.08 + pointerX * 0.12) - chamber.rotation.y) * 0.03;
      chamber.rotation.x += ((pointerY * -0.045) - chamber.rotation.x) * 0.025;
      rim.rotation.z = elapsed * 0.12;
      primaryLight.intensity = 15 + Math.sin(elapsed * 2.5) * 2.6;
      alertLight.intensity = 11 + Math.sin(elapsed * 2.1 + 1.6) * 2.1;
      glowRings.forEach((ring, index) => { ring.rotation.z = elapsed * 1.45 + index; ring.material.opacity = 0.52 + Math.sin(elapsed * 3.4) * 0.22; });
      coreRings.forEach((ring, index) => { ring.rotation.z = elapsed * (1.2 + index * 0.1); ring.scale.setScalar(1 + Math.sin(elapsed * 2.4 + index) * 0.08); });
      moduleCores.forEach((core, index) => { core.scale.y = 1 + Math.sin(elapsed * 2.2 + index * 0.7) * 0.13; });
      activeModules.forEach((module, index) => { module.position.y = Math.sin(elapsed * 2.6 + index) * 0.045; });
      beacons.forEach((beacon, index) => { beacon.position.y = 0.32 + Math.sin(elapsed * 2 + index) * 0.06; });
      beaconRings.forEach((ring, index) => { ring.rotation.z = elapsed * (0.8 + index * 0.12); });
      particles.rotation.y = elapsed * 0.048;
      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(render);
    };
    frame = window.requestAnimationFrame(render);
    return () => {
      window.cancelAnimationFrame(frame);
      resize.disconnect();
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerCancel);
      mount.removeChild(renderer.domElement);
      dispose();
    };
  }, [active, gridSize, intensity, motionRunning, movableTiles, tiles]);

  return <div ref={mountRef} className="dzn-signal-shift-3d" aria-hidden="true" />;
}
