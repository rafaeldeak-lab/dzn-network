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

export function SignalShift3D({ tiles, gridSize, intensity, active, disabled, motionRunning, movableTiles, onMove }: SignalShift3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const moveRef = useRef(onMove);
  const disabledRef = useRef(disabled);

  useEffect(() => { moveRef.current = onMove; }, [onMove]);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || typeof WebGLRenderingContext === "undefined") return;

    const palette = INTENSITY_COLORS[intensity];
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050713);
    scene.fog = new THREE.FogExp2(0x050713, 0.062);
    const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 100);
    camera.position.set(7.4, 7.9, 10.6);
    camera.lookAt(0, 0.55, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
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

    scene.add(new THREE.HemisphereLight(0xc8edff, 0x090713, 2.2));
    const keyLight = new THREE.DirectionalLight(0x91e7ff, 3.5);
    keyLight.position.set(-4, 9, 5);
    scene.add(keyLight);
    const primaryLight = new THREE.PointLight(palette.primary, 18, 17, 1.8);
    primaryLight.position.set(-4.6, 3.3, 2.2);
    scene.add(primaryLight);
    const alertLight = new THREE.PointLight(palette.alert, 14, 19, 1.7);
    alertLight.position.set(4.2, 2.6, -3.6);
    scene.add(alertLight);

    const chamber = new THREE.Group();
    chamber.rotation.y = -0.08;
    scene.add(chamber);

    const floorGeometry = new THREE.CylinderGeometry(5.65, 5.95, 0.36, 8);
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x0b1020, emissive: 0x071226, emissiveIntensity: 0.8, metalness: 0.72, roughness: 0.38 });
    geometries.push(floorGeometry); materials.push(floorMaterial);
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.position.y = -0.45;
    chamber.add(floor);
    const rimGeometry = new THREE.TorusGeometry(5.2, 0.045, 8, 64);
    const rimMaterial = new THREE.MeshBasicMaterial({ color: palette.primary, transparent: true, opacity: 0.64 });
    geometries.push(rimGeometry); materials.push(rimMaterial);
    const rim = new THREE.Mesh(rimGeometry, rimMaterial);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -0.22;
    chamber.add(rim);

    const gridGroup = new THREE.Group();
    const tileGeometry = new THREE.BoxGeometry(1.13, 0.28, 1.13);
    const topGeometry = new THREE.PlaneGeometry(0.92, 0.92);
    const edgeGeometry = new THREE.EdgesGeometry(tileGeometry);
    geometries.push(tileGeometry, topGeometry, edgeGeometry);
    const hitboxes: any[] = [];
    const glowRings: any[] = [];
    const half = (gridSize - 1) / 2;
    for (let index = 0; index < tiles.length; index++) {
      const tile = tiles[index];
      const row = Math.floor(index / gridSize);
      const column = index % gridSize;
      const x = (column - half) * 1.34;
      const z = (row - half) * 1.34;
      const movable = active && tile !== 0 && movableTiles.includes(tile);
      const group = new THREE.Group();
      group.position.set(x, tile === 0 ? -0.05 : 0, z);
      const baseMaterial = new THREE.MeshStandardMaterial({
        color: tile === 0 ? 0x091c28 : movable ? palette.primary : 0x192343,
        emissive: tile === 0 ? palette.primary : movable ? palette.primary : 0x071127,
        emissiveIntensity: tile === 0 ? 1.15 : movable ? 0.8 : 0.38,
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
        const ringGeometry = new THREE.RingGeometry(0.25, 0.39, 40);
        const ringMaterial = new THREE.MeshBasicMaterial({ color: palette.primary, transparent: true, opacity: 0.78, side: THREE.DoubleSide, depthWrite: false });
        geometries.push(ringGeometry); materials.push(ringMaterial);
        const ring = new THREE.Mesh(ringGeometry, ringMaterial);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.16;
        group.add(ring);
        glowRings.push(ring);
      } else {
        const texture = labelTexture(String(tile).padStart(2, "0"), movable ? "#b7fff2" : "#91b8ff");
        textures.push(texture);
        const labelMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: movable ? 1 : 0.87, depthWrite: false });
        materials.push(labelMaterial);
        const label = new THREE.Mesh(topGeometry, labelMaterial);
        label.rotation.x = -Math.PI / 2;
        label.position.y = 0.16;
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
      tracePoints.push((column - half) * 1.34, 0.23, (row - half) * 1.34, (nextColumn - half) * 1.34, 0.23, (nextRow - half) * 1.34);
    }
    traceGeometry.setAttribute("position", new THREE.Float32BufferAttribute(tracePoints, 3));
    const traceMaterial = new THREE.LineBasicMaterial({ color: palette.primary, transparent: true, opacity: 0.52 });
    geometries.push(traceGeometry); materials.push(traceMaterial);
    chamber.add(new THREE.LineSegments(traceGeometry, traceMaterial));

    const beaconGeometry = new THREE.CylinderGeometry(0.11, 0.19, 1.38, 8);
    const beaconMaterial = new THREE.MeshStandardMaterial({ color: palette.primary, emissive: palette.primary, emissiveIntensity: 1.5, metalness: 0.66, roughness: 0.24 });
    geometries.push(beaconGeometry); materials.push(beaconMaterial);
    const beacons: any[] = [];
    for (const [index, position] of [[-4.55, -4.55], [4.55, -4.55], [4.55, 4.55], [-4.55, 4.55]].entries()) {
      const beacon = new THREE.Mesh(beaconGeometry, beaconMaterial);
      beacon.position.set(position[0], 0.32, position[1]);
      beacon.rotation.y = index * Math.PI / 4;
      chamber.add(beacon);
      const glow = new THREE.PointLight(index % 2 ? palette.alert : palette.primary, 3.2, 5.5, 2);
      glow.position.set(position[0], 0.85, position[1]);
      chamber.add(glow);
      beacons.push(beacon);
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
    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0 || disabledRef.current) return;
      const hit = hitTile(event);
      if (hit?.userData.movable) moveRef.current(hit.userData.tile);
    };
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

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
        renderer.domElement.removeEventListener("pointerup", onPointerUp);
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
      beacons.forEach((beacon, index) => { beacon.position.y = 0.32 + Math.sin(elapsed * 2 + index) * 0.06; });
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
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      mount.removeChild(renderer.domElement);
      dispose();
    };
  }, [active, gridSize, intensity, motionRunning, movableTiles, tiles]);

  return <div ref={mountRef} className="dzn-signal-shift-3d" aria-hidden="true" />;
}
