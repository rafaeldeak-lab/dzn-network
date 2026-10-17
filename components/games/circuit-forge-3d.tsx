"use client";

import { useEffect, useRef } from "react";
import * as ThreeModule from "three";
import type { CircuitForgeTile } from "@/lib/games-circuit-forge";

// Three's recursive declaration graph can exceed the TypeScript checker stack in this client bundle.
/* eslint-disable @typescript-eslint/no-explicit-any */
const THREE: any = ThreeModule;

type CircuitForge3DProps = {
  tiles: CircuitForgeTile[];
  gridSize: number;
  active: boolean;
  disabled: boolean;
  motionRunning: boolean;
  onRotate: (index: number) => void;
  onUnavailable: () => void;
};

const NORTH = 1;
const EAST = 2;
const SOUTH = 4;
const WEST = 8;

export function CircuitForge3D({ tiles, gridSize, active, disabled, motionRunning, onRotate, onUnavailable }: CircuitForge3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rotateRef = useRef(onRotate);
  const disabledRef = useRef(disabled);
  const unavailableRef = useRef(onUnavailable);

  useEffect(() => { rotateRef.current = onRotate; }, [onRotate]);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);
  useEffect(() => { unavailableRef.current = onUnavailable; }, [onUnavailable]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    if (typeof WebGLRenderingContext === "undefined") {
      unavailableRef.current();
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x090907);
    scene.fog = new THREE.FogExp2(0x090907, 0.075);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(6.7, 7.6, 8.8);
    camera.lookAt(0, 0.15, 0);
    let renderer: any;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    } catch {
      unavailableRef.current();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.domElement.dataset.dznCircuitForgeCanvas = "true";
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);

    const geometries: any[] = [];
    const materials: any[] = [];
    const dispose = () => {
      geometries.forEach(item => item.dispose());
      materials.forEach(item => item.dispose());
      renderer.dispose();
    };

    scene.add(new THREE.HemisphereLight(0xfff1c3, 0x060807, 2.4));
    const keyLight = new THREE.DirectionalLight(0xffe5a1, 3.6);
    keyLight.position.set(-3, 8, 5);
    scene.add(keyLight);
    const cyanLight = new THREE.PointLight(0x58e6d1, 18, 14, 1.8);
    cyanLight.position.set(-3.7, 3.2, 3.7);
    scene.add(cyanLight);
    const amberLight = new THREE.PointLight(0xffbf58, 15, 14, 1.8);
    amberLight.position.set(3.6, 2.6, -3.1);
    scene.add(amberLight);

    const table = new THREE.Group();
    table.rotation.y = -0.11;
    scene.add(table);
    const floorGeometry = new THREE.CylinderGeometry(5.3, 5.65, 0.38, 8);
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x16150e, emissive: 0x0c100c, emissiveIntensity: 0.85, metalness: 0.76, roughness: 0.3 });
    geometries.push(floorGeometry); materials.push(floorMaterial);
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.position.y = -0.43;
    table.add(floor);
    const rimGeometry = new THREE.TorusGeometry(4.72, 0.05, 8, 72);
    const rimMaterial = new THREE.MeshBasicMaterial({ color: 0xe8c867, transparent: true, opacity: 0.72 });
    geometries.push(rimGeometry); materials.push(rimMaterial);
    const rim = new THREE.Mesh(rimGeometry, rimMaterial);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -0.22;
    table.add(rim);

    const tileGeometry = new THREE.BoxGeometry(0.99, 0.2, 0.99);
    const edgeGeometry = new THREE.EdgesGeometry(tileGeometry);
    const horizontalGeometry = new THREE.BoxGeometry(0.54, 0.075, 0.1);
    const verticalGeometry = new THREE.BoxGeometry(0.1, 0.075, 0.54);
    const nodeGeometry = new THREE.SphereGeometry(0.13, 14, 10);
    geometries.push(tileGeometry, edgeGeometry, horizontalGeometry, verticalGeometry, nodeGeometry);
    const hitboxes: any[] = [];
    const poweredNodes: any[] = [];
    const coreRings: any[] = [];
    const half = (gridSize - 1) / 2;
    const gap = 1.12;
    for (let index = 0; index < tiles.length; index++) {
      const tile = tiles[index];
      const row = Math.floor(index / gridSize);
      const column = index % gridSize;
      const group = new THREE.Group();
      group.position.set((column - half) * gap, 0, (row - half) * gap);
      const lit = tile.powered;
      const isCore = tile.core;
      const tileMaterial = new THREE.MeshStandardMaterial({
        color: isCore ? 0x5f4819 : lit ? 0x133a34 : 0x222016,
        emissive: isCore ? 0x5f4413 : lit ? 0x0b5b4d : 0x11100b,
        emissiveIntensity: isCore ? 1.15 : lit ? 0.98 : 0.24,
        metalness: 0.78,
        roughness: 0.3,
      });
      materials.push(tileMaterial);
      group.add(new THREE.Mesh(tileGeometry, tileMaterial));
      const edgeMaterial = new THREE.LineBasicMaterial({ color: isCore ? 0xffdc72 : lit ? 0x71eedb : 0x706743, transparent: true, opacity: lit || isCore ? 0.96 : 0.53 });
      materials.push(edgeMaterial);
      group.add(new THREE.LineSegments(edgeGeometry, edgeMaterial));
      const cableMaterial = new THREE.MeshStandardMaterial({ color: isCore ? 0xffdf7a : lit ? 0x7af2df : 0x756d50, emissive: isCore ? 0xf4ad2b : lit ? 0x27c4ad : 0x17160f, emissiveIntensity: lit || isCore ? 1.3 : 0.2, metalness: 0.58, roughness: 0.2 });
      materials.push(cableMaterial);
      const cable = (geometry: any, x: number, z: number) => {
        const mesh = new THREE.Mesh(geometry, cableMaterial);
        mesh.position.set(x, 0.14, z);
        group.add(mesh);
      };
      if (tile.mask & NORTH) cable(verticalGeometry, 0, -0.27);
      if (tile.mask & EAST) cable(horizontalGeometry, 0.27, 0);
      if (tile.mask & SOUTH) cable(verticalGeometry, 0, 0.27);
      if (tile.mask & WEST) cable(horizontalGeometry, -0.27, 0);
      const nodeMaterial = new THREE.MeshStandardMaterial({ color: isCore ? 0xffecae : lit ? 0xc9fff5 : 0x908869, emissive: isCore ? 0xffc34d : lit ? 0x4bf0d7 : 0x272519, emissiveIntensity: isCore ? 1.9 : lit ? 1.25 : 0.12, metalness: 0.5, roughness: 0.22 });
      materials.push(nodeMaterial);
      const node = new THREE.Mesh(nodeGeometry, nodeMaterial);
      node.position.y = 0.17;
      group.add(node);
      if (lit || isCore) poweredNodes.push(node);
      if (isCore) {
        const ringGeometry = new THREE.TorusGeometry(0.31, 0.03, 6, 34);
        const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffdb69, transparent: true, opacity: 0.86 });
        geometries.push(ringGeometry); materials.push(ringMaterial);
        const ring = new THREE.Mesh(ringGeometry, ringMaterial);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.21;
        group.add(ring);
        coreRings.push(ring);
      }
      const hitboxGeometry = new THREE.BoxGeometry(1.05, 0.6, 1.05);
      const hitboxMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
      geometries.push(hitboxGeometry); materials.push(hitboxMaterial);
      const hitbox = new THREE.Mesh(hitboxGeometry, hitboxMaterial);
      hitbox.position.y = 0.24;
      hitbox.userData = { index, rotatable: active && !isCore, group };
      group.add(hitbox);
      hitboxes.push(hitbox);
      table.add(group);
    }

    const beaconGeometry = new THREE.CylinderGeometry(0.08, 0.15, 1.1, 8);
    const beaconMaterial = new THREE.MeshStandardMaterial({ color: 0xf5ce6b, emissive: 0xe8a73d, emissiveIntensity: 1.45, metalness: 0.63, roughness: 0.2 });
    geometries.push(beaconGeometry); materials.push(beaconMaterial);
    const beacons: any[] = [];
    for (const [index, position] of [[-4.2, -4.2], [4.2, -4.2], [4.2, 4.2], [-4.2, 4.2]].entries()) {
      const beacon = new THREE.Mesh(beaconGeometry, beaconMaterial);
      beacon.position.set(position[0], 0.22, position[1]);
      table.add(beacon);
      beacons.push(beacon);
      const glow = new THREE.PointLight(index % 2 ? 0x58e6d1 : 0xffbf58, 2.5, 4.5, 2);
      glow.position.set(position[0], 0.75, position[1]);
      table.add(glow);
    }

    const particleGeometry = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(216);
    for (let index = 0; index < particlePositions.length; index += 3) {
      const sample = index / 3;
      particlePositions[index] = ((sample * 19) % 20) * 0.48 - 4.8;
      particlePositions[index + 1] = 0.28 + ((sample * 11) % 20) * 0.1;
      particlePositions[index + 2] = ((sample * 29) % 20) * 0.48 - 4.8;
    }
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
    const particleMaterial = new THREE.PointsMaterial({ color: 0xffd66d, size: 0.032, transparent: true, opacity: 0.52, depthWrite: false });
    geometries.push(particleGeometry); materials.push(particleMaterial);
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particles);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hovered: any = null;
    let pointerX = 0;
    let pointerY = 0;
    let pointerDown: { id: number; index: number; x: number; y: number; moved: boolean } | null = null;
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
        if (hovered?.userData.rotatable) hovered.userData.group.scale.setScalar(1.075);
      }
      renderer.domElement.style.cursor = hovered?.userData.rotatable && !disabledRef.current ? "pointer" : "default";
    };
    const onPointerLeave = () => {
      if (hovered?.userData.group) hovered.userData.group.scale.setScalar(1);
      hovered = null;
      renderer.domElement.style.cursor = "default";
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || disabledRef.current) { pointerDown = null; return; }
      const hit = hitTile(event);
      pointerDown = hit?.userData.rotatable ? { id: event.pointerId, index: hit.userData.index, x: event.clientX, y: event.clientY, moved: false } : null;
      if (pointerDown && renderer.domElement.setPointerCapture) renderer.domElement.setPointerCapture(event.pointerId);
    };
    const onPointerUp = (event: PointerEvent) => {
      const started = pointerDown;
      pointerDown = null;
      if (event.button !== 0 || disabledRef.current || !started || started.id !== event.pointerId || started.moved) return;
      const hit = hitTile(event);
      if (hit?.userData.rotatable && hit.userData.index === started.index) rotateRef.current(hit.userData.index);
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
    const cleanUp = () => {
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
    if (!motionRunning) {
      renderer.render(scene, camera);
      return cleanUp;
    }
    const startedAt = performance.now();
    const render = (time: number) => {
      const elapsed = (time - startedAt) / 1_000;
      table.rotation.y += ((-0.11 + pointerX * 0.1) - table.rotation.y) * 0.03;
      table.rotation.x += ((pointerY * -0.04) - table.rotation.x) * 0.025;
      rim.rotation.z = elapsed * 0.13;
      cyanLight.intensity = 15 + Math.sin(elapsed * 2.4) * 2;
      amberLight.intensity = 12 + Math.sin(elapsed * 2 + 1.4) * 1.8;
      poweredNodes.forEach((node, index) => { node.scale.setScalar(1 + Math.sin(elapsed * 2.8 + index * 0.45) * 0.06); });
      coreRings.forEach(ring => { ring.rotation.z = elapsed * 1.15; ring.material.opacity = 0.68 + Math.sin(elapsed * 3.2) * 0.18; });
      beacons.forEach((beacon, index) => { beacon.position.y = 0.22 + Math.sin(elapsed * 2.1 + index) * 0.05; });
      particles.rotation.y = elapsed * 0.05;
      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(render);
    };
    frame = window.requestAnimationFrame(render);
    return cleanUp;
  }, [active, gridSize, motionRunning, tiles]);

  return <div ref={mountRef} className="dzn-circuit-forge-3d" aria-hidden="true" />;
}
